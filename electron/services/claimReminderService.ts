import { getDb } from '../database'
import { createNotification } from '../ipc/notifications'
import { enqueuSync } from './syncQueue'

// Product Redemption Policy — soft claim reminder. Entirely local (no cloud
// dependency, unlike SyncService, which is a no-op when cloud sync isn't
// configured) since this is a pure business rule that must work regardless
// of whether a company has set up cloud sync at all.
//
// Escalation (both thresholds only affect notifications/reporting — the
// entitlement itself is NEVER revoked or blocked at either stage):
//  - claim_due_date passes (default 90 days after winning, configurable via
//    Admin Configuration) -> claim_status 'pending_claim' -> 'reminder_sent',
//    notifies the branch's Smart Buy Manager + Super Admin.
//  - a further DELAYED_ESCALATION_DAYS (30, chosen here — not a business
//    figure from the spec, just a second internal severity tier so
//    'delayed_claim' means something distinct from 'reminder_sent') with
//    still no claim -> 'reminder_sent' -> 'delayed_claim', notifies again.
// claim_reminder_sent_at is the idempotency marker so a member already
// flagged doesn't get renotified every time this check runs.
const CHECK_INTERVAL_MS = 60 * 60 * 1000 // hourly
const DELAYED_ESCALATION_DAYS = 30

export class ClaimReminderService {
  private timer: ReturnType<typeof setInterval> | null = null
  private running = false

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => this.runOnce(), CHECK_INTERVAL_MS)
    this.runOnce()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  async runOnce(): Promise<void> {
    if (this.running) return
    this.running = true
    try {
      const db = getDb()
      const today = new Date().toISOString().slice(0, 10)

      // pending_claim -> reminder_sent: due date has passed, not yet flagged.
      const newlyDue = db.prepare(`
        SELECT m.id, m.scheme_id, cs.branch_id, cs.name as scheme_name, cs.scheme_number, c.name as customer_name
        FROM chit_members m
        JOIN chit_schemes cs ON cs.id = m.scheme_id
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.status='redeemed' AND m.redemption_invoice_id IS NULL
          AND m.claim_status='pending_claim' AND m.claim_due_date IS NOT NULL
          AND date(m.claim_due_date) <= date(?)
      `).all(today) as Array<{ id: string; scheme_id: string; branch_id: string; scheme_name: string; scheme_number: string; customer_name: string | null }>

      for (const row of newlyDue) {
        db.prepare(`UPDATE chit_members SET claim_status='reminder_sent', claim_reminder_sent_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(row.id)
        void enqueuSync('chit_members', row.id, 'UPDATE', { id: row.id, claim_status: 'reminder_sent', claim_reminder_sent_at: new Date().toISOString() })
        createNotification(
          'chit_claim_delayed', 'SmartBuy Claim Reminder',
          `${row.customer_name || 'A winner'} hasn't claimed their product yet for ${row.scheme_name} (${row.scheme_number}) — past the claim reminder window.`,
          { schemeId: row.scheme_id, memberId: row.id }, { roleScope: 'smartBuy', branchId: row.branch_id }
        )
      }

      // reminder_sent -> delayed_claim: still unclaimed a further
      // DELAYED_ESCALATION_DAYS after the reminder fired.
      const stillDelayed = db.prepare(`
        SELECT m.id, m.scheme_id, cs.branch_id, cs.name as scheme_name, cs.scheme_number, c.name as customer_name
        FROM chit_members m
        JOIN chit_schemes cs ON cs.id = m.scheme_id
        LEFT JOIN customers c ON c.id = m.customer_id
        WHERE m.status='redeemed' AND m.redemption_invoice_id IS NULL
          AND m.claim_status='reminder_sent' AND m.claim_reminder_sent_at IS NOT NULL
          AND julianday(?) - julianday(m.claim_reminder_sent_at) >= ?
      `).all(today, DELAYED_ESCALATION_DAYS) as Array<{ id: string; scheme_id: string; branch_id: string; scheme_name: string; scheme_number: string; customer_name: string | null }>

      for (const row of stillDelayed) {
        db.prepare(`UPDATE chit_members SET claim_status='delayed_claim', updated_at=datetime('now') WHERE id=?`).run(row.id)
        void enqueuSync('chit_members', row.id, 'UPDATE', { id: row.id, claim_status: 'delayed_claim' })
        createNotification(
          'chit_claim_delayed', 'SmartBuy Claim Significantly Delayed',
          `${row.customer_name || 'A winner'} still hasn't claimed their product for ${row.scheme_name} (${row.scheme_number}) — the entitlement remains active, but this needs follow-up.`,
          { schemeId: row.scheme_id, memberId: row.id }, { roleScope: 'smartBuy', branchId: row.branch_id }
        )
      }
    } catch (err) {
      console.error('[ClaimReminderService]', err)
    } finally {
      this.running = false
    }
  }
}

let instance: ClaimReminderService | null = null
export function getClaimReminderService(): ClaimReminderService {
  if (!instance) instance = new ClaimReminderService()
  return instance
}
