import type Database from 'better-sqlite3'
import Store from 'electron-store'
import { sendEmail } from './emailService'
import { sendSms } from './smsService'
import { sendWhatsApp } from './whatsappService'

const store = new Store<Record<string, unknown>>()

// Settings are persisted as one nested blob under 'app_settings' (see
// electron/ipc/settings.ts's settings:update) — a flat store.get('email_enabled')
// reads a key that's never written and always falls back to its default.
function appSettings(): Record<string, unknown> {
  return (store.get('app_settings') as Record<string, unknown>) || {}
}

export function channelsEnabled() {
  const s = appSettings()
  return {
    email: Boolean(s.email_enabled ?? false),
    sms: Boolean(s.sms_enabled ?? false),
    whatsapp: Boolean(s.whatsapp_enabled ?? false),
  }
}

function companyName() {
  return String(appSettings().company_name ?? 'POS System')
}

// Per-event, per-channel notification triggers (Settings → Communications →
// Notification Triggers). A send only happens when BOTH the channel is
// globally enabled (email_enabled/sms_enabled/whatsapp_enabled) AND this
// specific event×channel toggle is on — matches electron/ipc/settings.ts's
// DEFAULTS, whose comment there explains why each default is true/false.
const EVENT_CHANNEL_DEFAULTS: Record<string, boolean> = {
  notif_bill_email: true, notif_bill_sms: false, notif_bill_whatsapp: false,
  notif_quotation_email: false, notif_quotation_sms: false, notif_quotation_whatsapp: false,
  notif_installment_email: true, notif_installment_sms: true, notif_installment_whatsapp: false,
  notif_chit_email: true, notif_chit_sms: true, notif_chit_whatsapp: true,
  notif_low_stock_email: true, notif_low_stock_sms: true, notif_low_stock_whatsapp: false,
}

export function notificationAllowed(
  settings: Record<string, unknown>,
  event: 'bill' | 'quotation' | 'installment' | 'chit' | 'low_stock',
  channel: 'email' | 'sms' | 'whatsapp'
): boolean {
  if (!(settings[`${channel}_enabled`] ?? false)) return false
  const eventKey = `notif_${event}_${channel}`
  return Boolean(settings[eventKey] ?? EVENT_CHANNEL_DEFAULTS[eventKey] ?? false)
}

// Best-effort, non-blocking send across whichever channels are configured
// and the customer has contact info for — a missing/failed channel never
// blocks the others or the caller's transaction. Returns which channels were
// actually attempted and which succeeded, so an on-demand caller (unlike the
// sweep functions below, which don't need to know) can record a delivery
// outcome — e.g. the payment reminder log.
export async function notifyCustomer(
  customer: { phone?: unknown; email?: unknown } | undefined, subject: string, message: string
): Promise<{ attempted: string[]; sent: string[] }> {
  if (!customer) return { attempted: [], sent: [] }
  const settings = appSettings()
  const attempted: string[] = []
  const jobs: Promise<{ channel: string; ok: boolean }>[] = []
  if (notificationAllowed(settings, 'chit', 'email') && customer.email) {
    attempted.push('email')
    jobs.push(sendEmail({
      to: String(customer.email), subject,
      html: `<div style="font-family:sans-serif;max-width:480px;margin:auto"><h2 style="color:#4f46e5">${companyName()}</h2><p>${message.replace(/\n/g, '<br/>')}</p></div>`,
    }).then(r => ({ channel: 'email', ok: Boolean(r?.success) })).catch(() => ({ channel: 'email', ok: false })))
  }
  if (notificationAllowed(settings, 'chit', 'sms') && customer.phone) {
    attempted.push('sms')
    jobs.push(sendSms({ to: String(customer.phone), message, event: 'chit' }).then(r => ({ channel: 'sms', ok: Boolean(r?.success) })).catch(() => ({ channel: 'sms', ok: false })))
  }
  if (notificationAllowed(settings, 'chit', 'whatsapp') && customer.phone) {
    attempted.push('whatsapp')
    jobs.push(sendWhatsApp({ to: String(customer.phone), message }).then(r => ({ channel: 'whatsapp', ok: Boolean(r?.success) })).catch(() => ({ channel: 'whatsapp', ok: false })))
  }
  const results = await Promise.all(jobs)
  return { attempted, sent: results.filter(r => r.ok).map(r => r.channel) }
}

// Winner Selected + Product Ready — sent right after a draw settles a
// member (regular cycle winner or final-batch settlement). Combined into
// one message since in this system a winner's product is ready for
// collection the moment they're drawn, not at some later separate step.
export async function notifyWinnerSelected(
  db: Database.Database,
  member: { customer_id: unknown },
  scheme: { name: unknown; scheme_number: unknown; chit_value: unknown }
): Promise<void> {
  const customer = db.prepare('SELECT name, phone, email FROM customers WHERE id=?')
    .get(member.customer_id) as { name?: string; phone?: string; email?: string } | undefined
  if (!customer) return
  const message = `Congratulations ${customer.name || ''}! You've been selected in this cycle's Smart Buy draw for "${scheme.name}" (${scheme.scheme_number}). Your product (worth Rs.${scheme.chit_value}) is ready for collection — visit your branch to choose your product.`
  await notifyCustomer(customer, `You Won! — ${scheme.name}`, message)
}

// Payment Due — sent to active members of an active scheme who have not
// made an approved contribution yet this calendar month. This is the
// pre-redemption equivalent of the installment due-date reminders
// (which only cover POST-redemption repayment) — there is no per-member
// due-date column for pre-redemption contributions, so "due this month, not
// yet paid" is used as the practical due/late signal.
export async function runChitPaymentDueSweep(db: Database.Database): Promise<{ dueCount: number; schemeCount: number }> {
  const enabled = channelsEnabled()
  const dueMembers = db.prepare(`
    SELECT m.id, m.customer_id, m.contributions_paid, cs.name as scheme_name, cs.scheme_number, cs.contribution_amount
    FROM chit_members m
    JOIN chit_schemes cs ON cs.id = m.scheme_id
    WHERE m.status = 'active' AND cs.status = 'active' AND cs.frequency = 'monthly'
      AND date(cs.start_date) <= date('now')
      AND NOT EXISTS (
        SELECT 1 FROM chit_contributions cc
        WHERE cc.member_id = m.id AND cc.status = 'approved'
          AND strftime('%Y-%m', cc.paid_at) = strftime('%Y-%m', 'now')
      )
  `).all() as Record<string, unknown>[]

  // Customer-facing messages only go out on a few fixed days of the month
  // (not every scheduler run) so members aren't messaged daily for the same
  // unpaid installment — the admin summary below still reflects live state
  // every day regardless.
  const REMINDER_DAYS_OF_MONTH = [1, 10, 20, 25]
  const dayOfMonth = new Date().getDate()
  if ((enabled.email || enabled.sms || enabled.whatsapp) && REMINDER_DAYS_OF_MONTH.includes(dayOfMonth)) {
    for (const m of dueMembers) {
      const customer = db.prepare('SELECT name, phone, email FROM customers WHERE id=?').get(m.customer_id) as { name?: string; phone?: string; email?: string } | undefined
      if (!customer) continue
      const amount = m.contribution_amount ? `Rs.${m.contribution_amount}` : 'this month\'s installment'
      const message = `Hi ${customer.name || ''}, ${amount} is due this month for your Smart Buy scheme "${m.scheme_name}" (${m.scheme_number}). Please make your payment to stay eligible for this cycle's draw.`
      await notifyCustomer(customer, `Payment Due — ${m.scheme_name}`, message)
    }
  }

  const schemeIds = new Set(dueMembers.map(m => m.scheme_number))
  return { dueCount: dueMembers.length, schemeCount: schemeIds.size }
}

// Scheme Closing — remaining active members of a scheme entering its final
// cycle (all of them settle together next draw) get a heads-up.
export async function runChitSchemeClosingSweep(db: Database.Database): Promise<Array<{ schemeId: string; schemeName: string; remaining: number }>> {
  const enabled = channelsEnabled()
  const closingSchemes = db.prepare(`
    SELECT cs.id, cs.name, cs.scheme_number, cs.cycle_count,
      (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_done,
      (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status = 'active') as remaining
    FROM chit_schemes cs
    WHERE cs.status = 'active'
  `).all() as Record<string, unknown>[]

  const results: Array<{ schemeId: string; schemeName: string; remaining: number }> = []
  for (const s of closingSchemes) {
    const nextCycle = Number(s.cycles_done || 0) + 1
    if (nextCycle < Number(s.cycle_count) || Number(s.remaining) === 0) continue
    results.push({ schemeId: String(s.id), schemeName: String(s.name), remaining: Number(s.remaining) })

    if (enabled.email || enabled.sms || enabled.whatsapp) {
      const members = db.prepare(`
        SELECT m.customer_id FROM chit_members m WHERE m.scheme_id = ? AND m.status = 'active'
      `).all(s.id) as { customer_id: string }[]
      for (const m of members) {
        const customer = db.prepare('SELECT name, phone, email FROM customers WHERE id=?').get(m.customer_id) as { name?: string; phone?: string; email?: string } | undefined
        if (!customer) continue
        const message = `Hi ${customer.name || ''}, your Smart Buy scheme "${s.name}" (${s.scheme_number}) is entering its final cycle — all remaining members will receive their product together. Please clear any pending payments before the final settlement.`
        await notifyCustomer(customer, `Scheme Closing Soon — ${s.name}`, message)
      }
    }
  }
  return results
}
