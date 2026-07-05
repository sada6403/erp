import { ipcMain } from 'electron'
import { sendEmail, testEmail, invoiceEmailHtml, installmentReminderHtml, lowStockAlertHtml } from '../services/emailService'
import { sendSms, testSms, installmentDueMessage, installmentOverdueMessage, lowStockMessage } from '../services/smsService'
import { sendWhatsApp, testWhatsApp } from '../services/whatsappService'
import { getDb } from '../database'
import { createNotification } from './notifications'
import Store from 'electron-store'

const store = new Store<Record<string, unknown>>()

export function registerCommunicationHandlers() {

  // ── Email ──────────────────────────────────────────────────────────────────
  ipcMain.handle('comm:email:test', async (_e, testTo: string) => testEmail(testTo))

  ipcMain.handle('comm:email:sendInvoice', async (_e, payload: {
    to: string
    customerName: string
    invoiceNumber: string
    invoiceDate: string
    totalAmount: string
    currency: string
    items: { name: string; qty: number; price: string; total: string }[]
  }) => {
    const companyName = String(store.get('company_name', 'POS System'))
    return sendEmail({
      to: payload.to,
      subject: `Invoice #${payload.invoiceNumber} from ${companyName}`,
      html: invoiceEmailHtml({ ...payload, companyName }),
    })
  })

  // ── SMS ────────────────────────────────────────────────────────────────────
  ipcMain.handle('comm:sms:test', async (_e, testTo: string) => testSms(testTo))

  ipcMain.handle('comm:sms:send', async (_e, payload: { to: string | string[]; message: string }) => {
    return sendSms(payload)
  })

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  ipcMain.handle('comm:whatsapp:test', async (_e, testTo: string) => testWhatsApp(testTo))

  ipcMain.handle('comm:whatsapp:send', async (_e, payload: { to: string; message: string }) => {
    return sendWhatsApp(payload)
  })

  // ── Manual Reminder for a specific installment ─────────────────────────────
  ipcMain.handle('comm:sendInstallmentReminder', async (_e, installmentId: string) => {
    try {
      const db = getDb()
      const inst = db.prepare(`
        SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
        FROM installments i
        JOIN customers c ON c.id = i.customer_id
        WHERE i.id = ?
      `).get(installmentId) as Record<string, unknown> | undefined

      if (!inst) return { success: false, error: 'Installment not found' }

      const cfg = {
        companyName: String(store.get('company_name', 'POS System')),
        currency:    String(store.get('currency_symbol', 'Rs.')),
      }
      const isOverdue = new Date(String(inst.next_due_date)) < new Date()
      const dueDate   = String(inst.next_due_date)
      const amount    = Number(Number(inst.due_amount) - Number(inst.paid_amount)).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      const results: Record<string, unknown> = {}

      // Email
      if (inst.customer_email) {
        results.email = await sendEmail({
          to: String(inst.customer_email),
          subject: isOverdue
            ? `⚠ Overdue Payment — ${cfg.companyName}`
            : `Installment Reminder — ${cfg.companyName}`,
          html: installmentReminderHtml({
            companyName:  cfg.companyName,
            customerName: String(inst.customer_name),
            dueDate,
            dueAmount:    amount,
            currency:     cfg.currency,
            overdue:      isOverdue,
          }),
        })
      }

      // SMS
      if (inst.customer_phone) {
        const msg = isOverdue
          ? installmentOverdueMessage(String(inst.customer_name), amount, cfg.currency, dueDate, cfg.companyName)
          : installmentDueMessage(String(inst.customer_name), amount, cfg.currency, dueDate, cfg.companyName)
        results.sms = await sendSms({ to: String(inst.customer_phone), message: msg })
      }

      return { success: true, results }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // ── Send Low Stock alert (manual trigger) ──────────────────────────────────
  ipcMain.handle('comm:sendLowStockAlert', async (_e, adminEmail?: string) => {
    try {
      const db = getDb()
      const items = db.prepare(`
        SELECT p.name, p.sku, pi.quantity as current, p.min_stock_level as min
        FROM product_inventory pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.quantity <= p.min_stock_level AND pi.quantity >= 0
        ORDER BY pi.quantity ASC
        LIMIT 30
      `).all() as { name: string; sku: string; current: number; min: number }[]

      if (!items.length) return { success: true, message: 'No low stock items' }

      const companyName = String(store.get('company_name', 'POS System'))
      const toEmail = adminEmail || String(store.get('company_email', ''))
      const adminPhone = String(store.get('company_phone', ''))
      const results: Record<string, unknown> = {}

      if (toEmail) {
        results.email = await sendEmail({
          to: toEmail,
          subject: `⚠ Low Stock Alert — ${items.length} items need restocking`,
          html: lowStockAlertHtml({ companyName, items }),
        })
      }

      if (adminPhone) {
        results.sms = await sendSms({ to: adminPhone, message: lowStockMessage(items.length, companyName) })
      }

      return { success: true, results, count: items.length }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })
}

// ── Daily Reminder Scheduler ─────────────────────────────────────────────────
// Called once on startup; schedules itself to run every 24 hours at 9 AM

export function startReminderScheduler() {
  const runReminders = async () => {
    try {
      const db = getDb()
      const companyName = String(store.get('company_name', 'POS System'))
      const currency    = String(store.get('currency_symbol', 'Rs.'))
      const emailEnabled = Boolean(store.get('email_enabled', false))
      const smsEnabled   = Boolean(store.get('sms_enabled', false))

      const pick = (cond: string) => db.prepare(`
        SELECT i.id, i.next_due_date, i.due_amount, i.paid_amount,
               c.name as customer_name, c.phone, c.email
        FROM installments i
        JOIN customers c ON c.id = i.customer_id
        WHERE i.status = 'active' AND i.due_amount > i.paid_amount AND ${cond}
      `).all() as Record<string, unknown>[]

      const overdue  = pick(`i.next_due_date < date('now')`)
      const dueToday = pick(`i.next_due_date = date('now')`)
      const due1Day  = pick(`i.next_due_date = date('now', '+1 day')`)   // 1-day reminder
      const dueSoon  = pick(`i.next_due_date = date('now', '+3 days')`)  // 3-day reminder

      // In-app notification for admins & managers — always, even without email/SMS.
      // Deduped to at most once per calendar day.
      const today = new Date().toISOString().slice(0, 10)
      const notedToday = (type: string) => Boolean(db.prepare(
        `SELECT 1 FROM notifications WHERE type=? AND date(created_at)=? LIMIT 1`
      ).get(type, today))
      if (overdue.length && !notedToday('installment_overdue')) {
        createNotification('installment_overdue', 'Overdue Installments',
          `${overdue.length} installment${overdue.length > 1 ? 's are' : ' is'} overdue and need follow-up.`,
          { count: overdue.length })
      }
      const upcoming = dueToday.length + due1Day.length + dueSoon.length
      if (upcoming && !notedToday('installment_due')) {
        createNotification('installment_due', 'Installment Payments Due',
          `${dueToday.length} due today, ${due1Day.length} due tomorrow, ${dueSoon.length} due in 3 days.`,
          { today: dueToday.length, in1: due1Day.length, in3: dueSoon.length })
      }

      // Customer email / SMS reminders — only if configured.
      if (!emailEnabled && !smsEnabled) return
      for (const inst of overdue) {
        const amount = Number(Number(inst.due_amount) - Number(inst.paid_amount)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
        const dueDate = String(inst.next_due_date)
        if (inst.email && emailEnabled) {
          await sendEmail({
            to: String(inst.email),
            subject: `⚠ Overdue Payment — ${companyName}`,
            html: installmentReminderHtml({ companyName, customerName: String(inst.customer_name), dueDate, dueAmount: amount, currency, overdue: true }),
          }).catch(() => {})
        }
        if (inst.phone && smsEnabled) {
          await sendSms({ to: String(inst.phone), message: installmentOverdueMessage(String(inst.customer_name), amount, currency, dueDate, companyName) }).catch(() => {})
        }
      }

      for (const inst of [...dueToday, ...due1Day, ...dueSoon]) {
        const amount = Number(Number(inst.due_amount) - Number(inst.paid_amount)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
        const dueDate = String(inst.next_due_date)
        if (inst.email && emailEnabled) {
          await sendEmail({
            to: String(inst.email),
            subject: `Installment Reminder — ${companyName}`,
            html: installmentReminderHtml({ companyName, customerName: String(inst.customer_name), dueDate, dueAmount: amount, currency }),
          }).catch(() => {})
        }
        if (inst.phone && smsEnabled) {
          await sendSms({ to: String(inst.phone), message: installmentDueMessage(String(inst.customer_name), amount, currency, dueDate, companyName) }).catch(() => {})
        }
      }

      // Low stock email/SMS once a day
      const lowItems = db.prepare(`
        SELECT p.name, p.sku, pi.quantity as current, p.min_stock_level as min
        FROM product_inventory pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.quantity <= p.min_stock_level AND pi.quantity >= 0
        LIMIT 30
      `).all() as { name: string; sku: string; current: number; min: number }[]

      if (lowItems.length > 0) {
        const adminEmail = String(store.get('company_email', ''))
        const adminPhone = String(store.get('company_phone', ''))
        if (adminEmail && emailEnabled) {
          await sendEmail({
            to: adminEmail,
            subject: `⚠ Low Stock Alert — ${lowItems.length} items`,
            html: lowStockAlertHtml({ companyName, items: lowItems }),
          }).catch(() => {})
        }
        if (adminPhone && smsEnabled) {
          await sendSms({ to: adminPhone, message: lowStockMessage(lowItems.length, companyName) }).catch(() => {})
        }
      }

    } catch { /* scheduler must never crash the app */ }
  }

  // Schedule: run once after 30s (give DB time to init), then every 24h
  setTimeout(() => {
    runReminders()
    setInterval(runReminders, 24 * 60 * 60 * 1000)
  }, 30_000)
}
