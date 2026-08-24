import { ipcMain } from 'electron'
import { sendEmail, testEmail, invoiceEmailHtml, installmentReminderHtml, lowStockAlertHtml } from '../services/emailService'
import { sendSms, testSms, installmentDueMessage, installmentOverdueMessage, lowStockMessage } from '../services/smsService'
import { sendWhatsApp, testWhatsApp } from '../services/whatsappService'
import { getDb } from '../database'
import { createNotification } from './notifications'
import { runChitPaymentDueSweep, runChitSchemeClosingSweep, notificationAllowed } from '../services/chitNotifications'
import Store from 'electron-store'
import { safeHandle } from './ipcHandler'

const store = new Store<Record<string, unknown>>()

// Settings are persisted as one nested blob under 'app_settings' (see
// electron/ipc/settings.ts's settings:update) — a flat store.get('email_enabled')
// reads a key that's never written and always falls back to its default.
function appSettings(): Record<string, unknown> {
  return (store.get('app_settings') as Record<string, unknown>) || {}
}

export function registerCommunicationHandlers() {

  // ── Email ──────────────────────────────────────────────────────────────────
  safeHandle(ipcMain, 'comm:email:test', async (_e, testTo: string, overrideConfig?: Record<string, unknown>) => testEmail(testTo, overrideConfig))

  safeHandle(ipcMain, 'comm:email:sendInvoice', async (_e, payload: {
    to: string
    customerName: string
    invoiceNumber: string
    invoiceDate: string
    totalAmount: string
    currency: string
    items: { name: string; qty: number; price: string; total: string }[]
  }) => {
    const companyName = String(appSettings().company_name ?? 'POS System')
    return sendEmail({
      to: payload.to,
      subject: `Invoice #${payload.invoiceNumber} from ${companyName}`,
      html: invoiceEmailHtml({ ...payload, companyName }),
    })
  })

  // ── SMS ────────────────────────────────────────────────────────────────────
  safeHandle(ipcMain, 'comm:sms:test', async (_e, testTo: string) => testSms(testTo))

  safeHandle(ipcMain, 'comm:sms:send', async (_e, payload: { to: string | string[]; message: string }) => {
    return sendSms(payload)
  })

  // ── WhatsApp ───────────────────────────────────────────────────────────────
  safeHandle(ipcMain, 'comm:whatsapp:test', async (_e, testTo: string) => testWhatsApp(testTo))

  safeHandle(ipcMain, 'comm:whatsapp:send', async (_e, payload: { to: string; message: string }) => {
    return sendWhatsApp(payload)
  })

  // ── Manual Reminder for a specific installment ─────────────────────────────
  safeHandle(ipcMain, 'comm:sendInstallmentReminder', async (_e, installmentId: string) => {
    const db = getDb()
    const inst = db.prepare(`
      SELECT i.*, c.name as customer_name, c.phone as customer_phone, c.email as customer_email
      FROM installments i
      JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
    `).get(installmentId) as Record<string, unknown> | undefined

    if (!inst) return { success: false, error: 'Installment not found' }

    const settings = appSettings()
    const cfg = {
      companyName: String(settings.company_name ?? 'POS System'),
      currency:    String(settings.currency_symbol ?? 'Rs.'),
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
      results.sms = await sendSms({ to: String(inst.customer_phone), message: msg, event: isOverdue ? 'installment_overdue' : 'installment_due' })
    }

    return { success: true, results }
  })

  // ── Send Low Stock alert (manual trigger) ──────────────────────────────────
  safeHandle(ipcMain, 'comm:sendLowStockAlert', async (_e, adminEmail?: string) => {
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

    const settings = appSettings()
    const companyName = String(settings.company_name ?? 'POS System')
    const toEmail = adminEmail || String(settings.company_email ?? '')
    const adminPhone = String(settings.company_phone ?? '')
    const results: Record<string, unknown> = {}

    if (toEmail) {
      results.email = await sendEmail({
        to: toEmail,
        subject: `⚠ Low Stock Alert — ${items.length} items need restocking`,
        html: lowStockAlertHtml({ companyName, items }),
      })
    }

    if (adminPhone) {
      results.sms = await sendSms({ to: adminPhone, message: lowStockMessage(items.length, companyName), event: 'low_stock' })
    }

    return { success: true, results, count: items.length }
  })
}

// ── Daily Reminder Scheduler ─────────────────────────────────────────────────
// Called once on startup; schedules itself to run every 24 hours at 9 AM

export function startReminderScheduler() {
  const runReminders = async () => {
    try {
      const db = getDb()
      const settings = appSettings()
      const companyName = String(settings.company_name ?? 'POS System')
      const currency    = String(settings.currency_symbol ?? 'Rs.')
      // Automatic (scheduler-driven) sends — gated per-event by the
      // Notification Triggers settings (Issue 24a). Manual sends
      // (comm:sendInstallmentReminder / comm:sendLowStockAlert, an admin
      // explicitly clicking "send now") are intentionally NOT gated by these
      // toggles, same as the "Send Test Email" button.
      const installmentEmailAllowed = notificationAllowed(settings, 'installment', 'email')
      const installmentSmsAllowed   = notificationAllowed(settings, 'installment', 'sms')
      const lowStockEmailAllowed    = notificationAllowed(settings, 'low_stock', 'email')
      const lowStockSmsAllowed      = notificationAllowed(settings, 'low_stock', 'sms')

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

      // Smart Buy: pre-redemption contribution due reminders + final-cycle
      // "scheme closing" heads-up — sends to customers via whichever of
      // email/SMS/WhatsApp is configured, and always logs an admin-facing
      // in-app summary (own channels checked internally, so this must run
      // even when only WhatsApp — not email/SMS — is enabled).
      try {
        const { dueCount, schemeCount } = await runChitPaymentDueSweep(db)
        if (dueCount && !notedToday('chit_payment_due')) {
          createNotification('chit_payment_due', 'Smart Buy Payments Due',
            `${dueCount} member(s) across ${schemeCount} scheme(s) haven't paid this month's Smart Buy installment yet.`,
            { dueCount, schemeCount })
        }
        const closingSchemes = await runChitSchemeClosingSweep(db)
        if (closingSchemes.length && !notedToday('chit_scheme_closing')) {
          const names = closingSchemes.map(s => s.schemeName).join(', ')
          createNotification('chit_scheme_closing', 'Smart Buy Scheme(s) Closing',
            `${closingSchemes.length} scheme(s) entering their final cycle: ${names}.`,
            { schemes: closingSchemes })
        }
      } catch { /* Smart Buy sweep must never break the rest of the scheduler */ }

      // Branch performance alert — a branch with zero SmartBuy collections
      // so far this month, once past the configured day-of-month (gives
      // collection time to start before flagging it as a concern).
      try {
        const savedSettings = (store.get('app_settings') as Record<string, unknown> | undefined) || {}
        const alertDay = Number(savedSettings.smartbuy_branch_alert_day ?? 15) || 15
        const dayOfMonth = new Date().getDate()
        if (dayOfMonth >= alertDay) {
          const quietBranches = db.prepare(`
            SELECT b.id, b.name FROM branches b
            WHERE b.is_active = 1
              AND EXISTS (SELECT 1 FROM chit_schemes cs WHERE cs.branch_id = b.id AND cs.status = 'active')
              AND NOT EXISTS (
                SELECT 1 FROM chit_contributions cc
                WHERE cc.branch_id = b.id AND cc.status = 'approved'
                  AND strftime('%Y-%m', cc.paid_at) = strftime('%Y-%m', 'now')
              )
          `).all() as { id: string; name: string }[]
          if (quietBranches.length && !notedToday('branch_performance_alert')) {
            const names = quietBranches.map(b => b.name).join(', ')
            createNotification('branch_performance_alert', 'Branch Performance Alert',
              `${quietBranches.length} branch(es) have zero SmartBuy collections this month: ${names}.`,
              { branches: quietBranches }, { roleScope: 'owner' })
          }
        }
      } catch { /* Branch alert sweep must never break the rest of the scheduler */ }

      // Customer email / SMS reminders — only if configured.
      if (installmentEmailAllowed || installmentSmsAllowed) {
        for (const inst of overdue) {
          const amount = Number(Number(inst.due_amount) - Number(inst.paid_amount)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
          const dueDate = String(inst.next_due_date)
          if (inst.email && installmentEmailAllowed) {
            await sendEmail({
              to: String(inst.email),
              subject: `⚠ Overdue Payment — ${companyName}`,
              html: installmentReminderHtml({ companyName, customerName: String(inst.customer_name), dueDate, dueAmount: amount, currency, overdue: true }),
            }).catch(() => {})
          }
          if (inst.phone && installmentSmsAllowed) {
            await sendSms({ to: String(inst.phone), message: installmentOverdueMessage(String(inst.customer_name), amount, currency, dueDate, companyName), event: 'installment_overdue' }).catch(() => {})
          }
        }

        for (const inst of [...dueToday, ...due1Day, ...dueSoon]) {
          const amount = Number(Number(inst.due_amount) - Number(inst.paid_amount)).toLocaleString(undefined, { maximumFractionDigits: 2, minimumFractionDigits: 2 })
          const dueDate = String(inst.next_due_date)
          if (inst.email && installmentEmailAllowed) {
            await sendEmail({
              to: String(inst.email),
              subject: `Installment Reminder — ${companyName}`,
              html: installmentReminderHtml({ companyName, customerName: String(inst.customer_name), dueDate, dueAmount: amount, currency }),
            }).catch(() => {})
          }
          if (inst.phone && installmentSmsAllowed) {
            await sendSms({ to: String(inst.phone), message: installmentDueMessage(String(inst.customer_name), amount, currency, dueDate, companyName), event: 'installment_due' }).catch(() => {})
          }
        }
      }

      // Low stock email/SMS once a day
      if (lowStockEmailAllowed || lowStockSmsAllowed) {
        const lowItems = db.prepare(`
          SELECT p.name, p.sku, pi.quantity as current, p.min_stock_level as min
          FROM product_inventory pi
          JOIN products p ON p.id = pi.product_id
          WHERE pi.quantity <= p.min_stock_level AND pi.quantity >= 0
          LIMIT 30
        `).all() as { name: string; sku: string; current: number; min: number }[]

        if (lowItems.length > 0) {
          const adminEmail = String(settings.company_email ?? '')
          const adminPhone = String(settings.company_phone ?? '')
          if (adminEmail && lowStockEmailAllowed) {
            await sendEmail({
              to: adminEmail,
              subject: `⚠ Low Stock Alert — ${lowItems.length} items`,
              html: lowStockAlertHtml({ companyName, items: lowItems }),
            }).catch(() => {})
          }
          if (adminPhone && lowStockSmsAllowed) {
            await sendSms({ to: adminPhone, message: lowStockMessage(lowItems.length, companyName), event: 'low_stock' }).catch(() => {})
          }
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
