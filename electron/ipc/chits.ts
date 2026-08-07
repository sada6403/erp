import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { insertStockMovement } from '../services/stockMovement'
import { syncStockRow } from '../services/stockSync'
import { getNextBillNumber } from './invoices'
import { notifyWinnerSelected } from '../services/chitNotifications'
import { createNotification } from './notifications'
import { computeAndRecordCommission } from '../services/commissionEngine'
import Store from 'electron-store'
import * as XLSX from 'xlsx'
import { safeHandle } from './ipcHandler'
import { PHONE_RE, EMAIL_RE, NIC_RE, validateContactFields } from '../services/contactValidation'

const store = new Store()

// A manual winner override (chits:draws:conduct, method='manual_pick') must
// carry a substantive, auditable justification — not just a placeholder
// word — since it lets a Company Admin hand-pick who receives a real
// product ahead of the normal random draw.
const MANUAL_DRAW_MIN_REASON_LENGTH = 10

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

// Company-wide Smart Buy defaults (Admin Configuration Module, Settings →
// app_settings) — a scheme creator can always override these per-scheme;
// these only decide what a blank form starts with. No hardcoded fallback
// values live here beyond the last-resort literals also shown as the
// Settings page's own defaults (settings.ts DEFAULTS).
function smartBuySettings() {
  const saved = (store.get('app_settings') as Record<string, unknown> | undefined) || {}
  return {
    defaultMinMembers: Number(saved.smartbuy_default_min_members ?? 50) || 50,
    defaultLatePaymentDays: Number(saved.smartbuy_default_late_payment_days ?? 5) || 0,
    defaultLateFeeAmount: Number(saved.smartbuy_default_late_fee_amount ?? 0) || 0,
    defaultRepaymentMonths: Number(saved.smartbuy_default_repayment_months ?? 12) || 12,
    enforceRegistrationLock: saved.smartbuy_enforce_registration_lock !== false,
    // Product Redemption Policy — soft reminder window. The entitlement
    // itself never expires; this only controls when the system nudges a
    // reminder, then flags the claim as delayed, so Managers/Super Admin
    // notice a winner who hasn't come in yet. Never blocks the claim.
    claimReminderDays: Number(saved.smartbuy_claim_reminder_days ?? 90) || 90,
  }
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

function defaultBranchId() {
  return 'b1111111-1111-4111-8111-111111111111'
}

function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

// Notifies a scheme's assigned agent of a status change, only if they have a
// linked login to receive it (a passive, not-yet-linked agent record has
// nowhere to deliver a notification to).
function notifySchemeAgentStatus(db: ReturnType<typeof getDb>, agentId: string | null, schemeName: string, statusLabel: string, schemeId: string): void {
  if (!agentId) return
  const agent = db.prepare('SELECT user_id FROM agents WHERE id=?').get(agentId) as { user_id: string | null } | undefined
  if (!agent?.user_id) return
  createNotification('scheme_status_update', 'Scheme Status Update',
    `${schemeName} is now ${statusLabel}.`, { schemeId }, { userId: agent.user_id })
}

// Flips a 'pending' scheme to 'active' once enrolled (non-withdrawn) members
// reach min_members. No-op for schemes that are already active/completed/
// cancelled, and deliberately never reverts active->pending on withdrawal —
// a scheme with draws/contributions already in progress reverting would be
// more disruptive than useful; the spec's requirement is about the initial
// activation gate, not ongoing enforcement. Returns true if the scheme was
// just activated (so callers can enqueue the sync row).
function maybeActivateScheme(db: ReturnType<typeof getDb>, schemeId: string): boolean {
  const scheme = db.prepare('SELECT status, min_members FROM chit_schemes WHERE id=?')
    .get(schemeId) as { status: string; min_members: number } | undefined
  if (!scheme || scheme.status !== 'pending') return false
  const enrolled = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`)
    .get(schemeId) as { c: number }
  if (enrolled.c >= Number(scheme.min_members)) {
    db.prepare(`UPDATE chit_schemes SET status='active', updated_at=datetime('now') WHERE id=?`).run(schemeId)
    return true
  }
  return false
}

// Flips an 'active' scheme to 'completed' once every enrolled (non-
// withdrawn) member has received their product (status='redeemed') — i.e.
// no member is left in 'active' status. 'completed' was already a
// recognized status elsewhere (delete/purge guards, the dashboard's
// completed_schemes count, chits:toggleActive's "final states" comment) but
// no code path ever actually produced it — this closes that gap (SmartBuy
// final-cycle audit). Checked after every draw, not only a final-cycle one:
// an earlier random/manual draw can also happen to redeem the last
// remaining active member (e.g. after withdrawals shrank the pool). A
// member who hadn't paid the final cycle's contribution yet (see
// eligibleMembersForDraw's current-cycle-payment requirement) correctly
// stays 'active' and keeps the scheme open until a later draw call
// catches them too — never silently drops them. Returns true if the
// scheme was just completed (so callers can enqueue the sync row).
function maybeCompleteScheme(db: ReturnType<typeof getDb>, schemeId: string): boolean {
  const scheme = db.prepare('SELECT status FROM chit_schemes WHERE id=?')
    .get(schemeId) as { status: string } | undefined
  if (!scheme || scheme.status !== 'active') return false
  const remaining = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status='active'`)
    .get(schemeId) as { c: number }
  if (remaining.c === 0) {
    db.prepare(`UPDATE chit_schemes SET status='completed', updated_at=datetime('now') WHERE id=?`).run(schemeId)
    return true
  }
  return false
}

// Sync's pull for chit_members/chit_draws/chit_contributions/chit_scheme_branches
// only fetches a scheme's child rows when that scheme itself shows up as
// "changed since last pull" (see syncService.ts's related-ids dance keyed off
// chit_schemes). A scheme whose own row is never touched again after creation
// would otherwise never have its new members/draws/contributions/collaboration
// changes noticed by other devices, even though the child rows are pushed
// fine. Call this after every child-table write so the parent keeps showing
// up as changed. Payload must include updated_at explicitly — the backend's
// partial-UPDATE path (backend/lib/sync.ts) is a no-op if the only field is id.
async function touchSchemeSync(db: ReturnType<typeof getDb>, schemeId: string): Promise<void> {
  db.prepare(`UPDATE chit_schemes SET updated_at=datetime('now') WHERE id=?`).run(schemeId)
  const row = db.prepare('SELECT updated_at FROM chit_schemes WHERE id=?').get(schemeId) as { updated_at: string } | undefined
  if (row) await enqueuSync('chit_schemes', schemeId, 'UPDATE', { id: schemeId, updated_at: row.updated_at })
}

// Registration Lock (Admin Configuration Module) — rejects new enrollment
// outside a scheme's registration_start_date/registration_end_date window,
// when either is set and the global enforce toggle is on. A scheme with
// neither date set has no lock (always open), matching prior behavior.
function assertRegistrationWindow(scheme: { registration_start_date?: unknown; registration_end_date?: unknown }): string | null {
  if (!smartBuySettings().enforceRegistrationLock) return null
  const today = new Date().toISOString().slice(0, 10)
  if (scheme.registration_start_date && today < String(scheme.registration_start_date).slice(0, 10)) {
    return `Registration for this scheme opens on ${String(scheme.registration_start_date).slice(0, 10)}`
  }
  if (scheme.registration_end_date && today > String(scheme.registration_end_date).slice(0, 10)) {
    return `Registration for this scheme closed on ${String(scheme.registration_end_date).slice(0, 10)}`
  }
  return null
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

function importCell(row: Record<string, unknown>, ...names: string[]): string {
  for (const name of names) {
    for (const key of Object.keys(row)) {
      if (key.trim().toLowerCase() === name.toLowerCase()) {
        const v = row[key]
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim()
      }
    }
  }
  return ''
}

// Smart Buy access requires an EXPLICIT grant — 'all' (Company Admin) or
// 'chits' (Smart Buy Manager / any role an owner has opted in). 'customers'
// deliberately does NOT imply Smart Buy access: the seeded Branch Manager
// and Cashier roles both carry customers:true for the ordinary Customers
// module, and until this fix that also gave them full, unintended Smart Buy
// write access (create/edit schemes, enroll members, record payments,
// invite branches...) for their own branch. A company that wants Branch
// Manager/Cashier to keep Smart Buy access must now grant 'chits' to that
// role explicitly via Roles & Permissions — see the SmartBuy fix audit,
// HIGH-2 (permission leak).
function canManage(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all || perms.chits)
}

// Only 'all' (Company Admin) is treated as global (all-branch) access. A
// caller with only 'chits' (no 'all') is always confined to their own
// branch even if a request tries to pass a different branch_id.
function isGlobalChitAccess(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all)
}

// Resolves the branch a non-global caller is confined to, ignoring any
// client-supplied branch_id override — the caller's own branch always wins
// unless they have global access.
function resolveScopedBranchId(perms: Record<string, unknown>, caller: Record<string, unknown>, requested?: unknown): string | undefined {
  if (isGlobalChitAccess(perms)) return (requested as string | undefined) || undefined
  return caller.branch_id as string | undefined
}

// For a mutation against an existing scheme/record, verifies a non-global
// caller isn't reaching into another branch's data.
function assertBranchScope(perms: Record<string, unknown>, caller: Record<string, unknown>, targetBranchId: unknown): boolean {
  if (isGlobalChitAccess(perms)) return true
  return Boolean(targetBranchId) && String(targetBranchId) === String(caller.branch_id || '')
}

// Non-null only for a caller logged in as an Agent (session_scope='agent')
// — their own agent id, so read/write handlers can confine them to their
// own data ("cannot access other agents' schemes/members" per spec) on top
// of the existing branch scoping.
function resolveScopedAgentId(caller: Record<string, unknown>): string | null {
  const scope = caller.scope as { level?: string; agentId?: string | null } | undefined
  return scope?.level === 'agent' ? (scope.agentId || null) : null
}

// Scheme-level access for Branch Collaboration: global, the scheme's own
// (home) branch, or a branch with an ACTIVE collaboration row always has
// access; a merely 'pending'/'rejected'/'removed' row does not. Home branch
// always has full access regardless of collaboration — collaboration only
// ever extends reach, never narrows the owner's control.
function assertSchemeAccess(db: ReturnType<typeof getDb>, perms: Record<string, unknown>, caller: Record<string, unknown>, scheme: { id: unknown; branch_id: unknown }): boolean {
  if (isGlobalChitAccess(perms)) return true
  const callerBranch = String(caller.branch_id || '')
  if (!callerBranch) return false
  if (callerBranch === String(scheme.branch_id || '')) return true
  const collab = db.prepare(`SELECT 1 FROM chit_scheme_branches WHERE scheme_id=? AND branch_id=? AND status='active'`)
    .get(scheme.id, callerBranch)
  return Boolean(collab)
}

// Member-level access: the home branch sees/manages every member in its
// scheme; a collaborating branch only its own recruits (member.enrolled_
// branch_id) — collaboration extends enrollment reach, not visibility into
// what other branches (including the home branch's own walk-ins) enrolled.
function assertMemberAccess(perms: Record<string, unknown>, caller: Record<string, unknown>, scheme: { branch_id: unknown }, member: { enrolled_branch_id?: unknown }): boolean {
  if (isGlobalChitAccess(perms)) return true
  const callerBranch = String(caller.branch_id || '')
  if (!callerBranch) return false
  if (callerBranch === String(scheme.branch_id || '')) return true
  const enrolledBranch = String(member.enrolled_branch_id || scheme.branch_id || '')
  return callerBranch === enrolledBranch
}

function nextChitNumber(db: ReturnType<typeof getDb>, branchId: string) {
  const year = new Date().getFullYear()
  const branch = db.prepare('SELECT code, name FROM branches WHERE id=?').get(branchId) as { code?: string; name?: string } | undefined
  const code = String(branch?.code || branch?.name?.slice(0, 4) || 'MAIN').toUpperCase().replace(/\s+/g, '')
  const count = db.prepare(`
    SELECT COUNT(*) AS count FROM chit_schemes
    WHERE branch_id = ? AND substr(created_at, 1, 4) = ?
  `).get(branchId, String(year)) as { count: number }
  return `${code}-CHIT-${year}-${String(Number(count?.count || 0) + 1).padStart(4, '0')}`
}

// Generates the post-delivery repayment schedule for a member who has just
// received their product (via draw win, final-cycle batch release, or early
// redemption) and still owes a remaining balance. Reuses the exact loop
// shape from admin:installments:createSale so the existing recordPayment/
// verifyPayment engine handles collection with no new payment UI needed.
function generateChitRepaymentSchedule(
  db: ReturnType<typeof getDb>,
  scheme: Record<string, unknown>,
  member: Record<string, unknown>,
  principalRemaining: number,
  label: string
): { installmentId: string; enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> } | null {
  if (principalRemaining <= 0.01) return null

  const months = Math.max(1, Number(scheme.repayment_months) || 12)
  const monthlyAmount = money(principalRemaining / months)
  const installmentId = crypto.randomUUID()
  const startDate = new Date().toISOString().slice(0, 10)
  const nextDue = addMonths(startDate, 1)
  const contractNumber = `${label}-RPY`
  const enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> = []

  const installmentRow = {
    id: installmentId, contract_number: contractNumber, invoice_id: null,
    customer_id: member.customer_id, branch_id: scheme.branch_id,
    cash_price: scheme.chit_value, down_payment: 0, financed_amount: principalRemaining,
    interest_type: 'flat', interest_rate: 0, interest_amount: 0,
    total_amount: principalRemaining, paid_amount: 0, due_amount: principalRemaining,
    monthly_amount: monthlyAmount, installment_count: months, remaining_installments: months,
    frequency: 'monthly', start_date: startDate, next_due_date: nextDue, status: 'active',
    grace_period_days: 0, late_fee: 0, notes: `Chit repayment — ${label}`,
  }
  db.prepare(`
    INSERT INTO installments
      (id, contract_number, invoice_id, customer_id, branch_id, cash_price, down_payment,
       financed_amount, interest_type, interest_rate, interest_amount, total_amount, paid_amount,
       due_amount, monthly_amount, installment_count, remaining_installments, frequency, start_date,
       next_due_date, status, grace_period_days, late_fee, notes)
    VALUES (@id,@contract_number,@invoice_id,@customer_id,@branch_id,@cash_price,@down_payment,
       @financed_amount,@interest_type,@interest_rate,@interest_amount,@total_amount,@paid_amount,
       @due_amount,@monthly_amount,@installment_count,@remaining_installments,@frequency,@start_date,
       @next_due_date,@status,@grace_period_days,@late_fee,@notes)
  `).run(installmentRow)
  enqueue.push({ table: 'installments', id: installmentId, row: installmentRow })

  for (let i = 1; i <= months; i++) {
    const dueDate = addMonths(startDate, i)
    const scheduleId = crypto.randomUUID()
    const scheduleRow = {
      id: scheduleId, installment_id: installmentId, installment_no: i, due_date: dueDate,
      principal: monthlyAmount, interest: 0, total_due: monthlyAmount,
    }
    db.prepare(`
      INSERT INTO installment_schedule
        (id, installment_id, installment_no, due_date, principal, interest, total_due)
      VALUES (@id,@installment_id,@installment_no,@due_date,@principal,@interest,@total_due)
    `).run(scheduleRow)
    enqueue.push({ table: 'installment_schedule', id: scheduleId, row: scheduleRow })

    for (const offset of [7, 3, 0]) {
      const scheduled = new Date(`${dueDate}T00:00:00`)
      scheduled.setDate(scheduled.getDate() - offset)
      const reminderId = crypto.randomUUID()
      const reminderRow = {
        id: reminderId, installment_id: installmentId,
        channel: 'sms', reminder_type: offset === 0 ? 'due_today' : `${offset}_days_before`,
        message: `Chit repayment ${contractNumber}: Rs.${monthlyAmount} due on ${dueDate}`,
        scheduled_at: scheduled.toISOString().slice(0, 10),
      }
      db.prepare(`
        INSERT INTO installment_reminders
          (id, installment_id, channel, reminder_type, message, scheduled_at)
        VALUES (@id,@installment_id,@channel,@reminder_type,@message,@scheduled_at)
      `).run(reminderRow)
      enqueue.push({ table: 'installment_reminders', id: reminderId, row: reminderRow })
    }
  }

  return { installmentId, enqueue }
}

// Computes one member's contribution status for one cycle from real,
// already-recorded chit_contributions rows only — never a hypothetical
// "if we applied their available credit right now" preview. paidAmount is
// cash/method actually collected this cycle; creditUsed is how much of the
// member's credit_balance was drawn down against this specific cycle at
// the time each contributing row was recorded/approved; balanceDue is
// what's still owed. A member only accrues creditUsed here through an
// actual contribution event — sitting on unused credit_balance with zero
// contribution rows for the current cycle leaves balanceDue at the full
// expected amount until staff records at least one payment for it (see
// chits:contributions:record, which is the only place credit actually
// gets applied). Used identically by draw eligibility, the contribution-
// recording settle-check, and the member contribution statement report,
// so none of them can ever disagree about whether a cycle is settled.
function computeMemberCycleBalance(
  db: ReturnType<typeof getDb>, memberId: string, schemeId: string, cycleNo: number, expectedAmount: number
): { expectedAmount: number; paidAmount: number; creditUsed: number; balanceDue: number } {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) as paid, COALESCE(SUM(credit_applied), 0) as creditUsed
    FROM chit_contributions
    WHERE member_id=? AND scheme_id=? AND cycle_no=? AND contribution_type='cycle' AND status='approved'
  `).get(memberId, schemeId, cycleNo) as { paid: number; creditUsed: number }
  const expected = money(expectedAmount)
  const paidAmount = money(Number(row.paid) || 0)
  const creditUsed = money(Number(row.creditUsed) || 0)
  const balanceDue = money(Math.max(0, expected - paidAmount - creditUsed))
  return { expectedAmount: expected, paidAmount, creditUsed, balanceDue }
}

// Single source of truth for "who can be selected to win this cycle's
// draw" — used by BOTH the read-only preview (chits:draws:eligible) and the
// actual draw (chits:draws:conduct), so the two can never disagree about
// who is eligible again (see the SmartBuy fix audit, HIGH-1: draw
// eligibility mismatch). A member is eligible if active, not yet redeemed,
// has a fully settled balance for THIS cycle (balanceDue === 0 — full
// payment via direct payment, credit adjustment, or a combination —
// confirmed flexible-contribution business rule), and has no REJECTED
// contribution for this cycle or any earlier one (standard chit practice —
// a rejected payment blocks eligibility even after the fact, until it's
// corrected and re-approved, regardless of what the balance math alone
// would say).
function eligibleMembersForDraw(db: ReturnType<typeof getDb>, schemeId: string, cycleNo: number): Record<string, unknown>[] {
  const scheme = db.prepare('SELECT contribution_amount FROM chit_schemes WHERE id=?').get(schemeId) as { contribution_amount: number } | undefined
  const expectedAmount = Number(scheme?.contribution_amount) || 0
  const candidates = db.prepare(`
    SELECT m.*, c.name as customer_name, c.phone as customer_phone
    FROM chit_members m
    LEFT JOIN customers c ON c.id = m.customer_id
    WHERE m.scheme_id = ? AND m.status = 'active' AND m.redemption_type IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM chit_contributions cc
        WHERE cc.member_id = m.id AND cc.contribution_type = 'cycle'
          AND cc.cycle_no <= ? AND cc.status = 'rejected'
      )
    ORDER BY m.join_order
  `).all(schemeId, cycleNo) as Record<string, unknown>[]
  return candidates.filter(m => computeMemberCycleBalance(db, String(m.id), schemeId, cycleNo, expectedAmount).balanceDue <= 0.01)
}

export function registerChitHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'chits:list', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const isGlobal = isGlobalChitAccess(perms)
    const branchId = resolveScopedBranchId(perms, caller, filters.branch_id)
    const agentId = resolveScopedAgentId(caller)

    const conditions: string[] = []
    const params: unknown[] = []
    if (isGlobal) {
      if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    } else if (branchId) {
      // Non-global callers see their home-branch schemes plus any scheme
      // their branch is an active collaborator on (Branch Collaboration).
      conditions.push(`(cs.branch_id = ? OR EXISTS (
        SELECT 1 FROM chit_scheme_branches csb WHERE csb.scheme_id = cs.id AND csb.branch_id = ? AND csb.status = 'active'
      ))`)
      params.push(branchId, branchId)
    }
    if (filters.status) { conditions.push('cs.status = ?'); params.push(filters.status) }
    if (filters.search) {
      conditions.push('(cs.name LIKE ? OR cs.scheme_number LIKE ?)')
      params.push(`%${filters.search}%`, `%${filters.search}%`)
    }
    // An Agent session only sees schemes they're the scheme-level agent on,
    // or where they have at least one assigned member.
    if (agentId) {
      conditions.push('(cs.agent_id = ? OR EXISTS (SELECT 1 FROM chit_members m WHERE m.scheme_id = cs.id AND m.agent_id = ?))')
      params.push(agentId, agentId)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT cs.*, b.name as branch_name, a.name as agent_name, a.code as agent_code,
        p.name as product_name,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled,
        (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_completed,
        (SELECT COALESCE(SUM(amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as contributions_collected
      FROM chit_schemes cs
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN agents a ON a.id = cs.agent_id
      LEFT JOIN products p ON p.id = cs.product_id
      ${where}
      ORDER BY cs.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'chits:get', (_e, id: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const scheme = db.prepare(`
      SELECT cs.*, b.name as branch_name, a.name as agent_name, a.code as agent_code, p.name as product_name
      FROM chit_schemes cs
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN agents a ON a.id = cs.agent_id
      LEFT JOIN products p ON p.id = cs.product_id
      WHERE cs.id = ?
    `).get(id) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme as { id: unknown; branch_id: unknown })) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    const agentId = resolveScopedAgentId(caller)
    if (agentId && scheme.agent_id !== agentId) {
      const hasAssignedMember = db.prepare('SELECT 1 FROM chit_members WHERE scheme_id=? AND agent_id=? LIMIT 1').get(id, agentId)
      if (!hasAssignedMember) return { success: false, error: 'You do not have access to this scheme' }
    }
    // The home branch (and global callers) see every member; a caller who
    // only has access via an active Branch Collaboration row (not the home
    // branch) sees only the members their own branch recruited — matches
    // assertMemberAccess's invariant, which chits:get previously didn't
    // apply row-by-row to this embedded member list.
    const isHomeOrGlobal = isGlobalChitAccess(perms) || String(caller.branch_id || '') === String(scheme.branch_id || '')
    const memberBranchFilter = isHomeOrGlobal ? '' : 'AND m.enrolled_branch_id = ?'
    const memberParams = isHomeOrGlobal ? [id] : [id, caller.branch_id]

    const members = db.prepare(`
      SELECT m.*, c.name as customer_name, c.phone as customer_phone,
        i.status as repayment_status, i.due_amount as repayment_due,
        ma.name as member_agent_name, ma.code as member_agent_code,
        eb.name as enrolled_branch_name, ri.invoice_number as redemption_invoice_number
      FROM chit_members m
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN installments i ON i.id = m.installment_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      LEFT JOIN branches eb ON eb.id = m.enrolled_branch_id
      LEFT JOIN invoices ri ON ri.id = m.redemption_invoice_id
      WHERE m.scheme_id = ? ${memberBranchFilter}
      ORDER BY m.join_order
    `).all(...memberParams)

    const draws = db.prepare(`
      SELECT d.*,
        -- winner_member_id is only ever set for a single-winner draw
        -- (random/manual_pick) — a final_batch draw settles multiple
        -- members at once and leaves it NULL, so winner_name is built from
        -- every member whose won_cycle_no matches this draw's cycle
        -- instead, correctly listing all of them for both cases.
        (SELECT GROUP_CONCAT(c2.name, ', ') FROM chit_members m2
           JOIN customers c2 ON c2.id = m2.customer_id
           WHERE m2.scheme_id = d.scheme_id AND m2.won_cycle_no = d.cycle_no) as winner_name,
        u.name as conducted_by_name
      FROM chit_draws d
      LEFT JOIN users u ON u.id = d.conducted_by
      WHERE d.scheme_id = ?
      ORDER BY d.cycle_no
    `).all(id)

    const contributionSummary = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total_collected,
        COALESCE(SUM(commission_amount),0) as total_commission,
        COUNT(*) as contribution_count
      FROM chit_contributions WHERE scheme_id = ? AND status = 'approved'
    `).get(id)

    // Branch Collaboration: every branch (besides the home branch) that has
    // been invited/is contributing members to this scheme.
    const collaborations = db.prepare(`
      SELECT csb.*, b.name as branch_name,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = csb.scheme_id AND m.enrolled_branch_id = csb.branch_id AND m.status != 'withdrawn') as members_enrolled
      FROM chit_scheme_branches csb
      LEFT JOIN branches b ON b.id = csb.branch_id
      WHERE csb.scheme_id = ?
      ORDER BY csb.created_at
    `).all(id)

    return { success: true, data: { scheme, members, draws, contributionSummary, collaborations } }
  })

  // ── Centralized Scheme Master ──────────────────────────────────────────
  // Super Admin-only catalog of reusable SmartBuy "products" (scheme_name,
  // monthly_contribution_amount, duration_months, minimum_members,
  // product_value, status). chits:create below looks one of these up by id
  // and derives a new branch-scoped chit_schemes row's financial/duration/
  // capacity fields from it — never from client-supplied values — so
  // neither a Smart Buy Manager nor a tampered API call can inject a
  // hand-typed contribution amount, duration, or member count.
  const TEMPLATE_FIELDS = ['scheme_name', 'monthly_contribution_amount', 'duration_months', 'minimum_members', 'product_value'] as const

  function validateTemplatePayload(payload: Record<string, unknown>): { error: string } | {
    scheme_name: string; monthly_contribution_amount: number; duration_months: number; minimum_members: number; product_value: number
  } {
    const scheme_name = String(payload.scheme_name || '').trim()
    const monthly_contribution_amount = money(Number(payload.monthly_contribution_amount) || 0)
    const duration_months = Number(payload.duration_months) || 0
    const minimum_members = Number(payload.minimum_members) || 0
    const product_value = money(Number(payload.product_value) || 0)
    if (!scheme_name) return { error: 'Scheme name is required' }
    if (monthly_contribution_amount <= 0) return { error: 'Monthly contribution amount must be greater than 0' }
    if (duration_months <= 0) return { error: 'Duration (months) must be greater than 0' }
    if (minimum_members <= 0) return { error: 'Minimum members must be greater than 0' }
    if (product_value <= 0) return { error: 'Product value must be greater than 0' }
    return { scheme_name, monthly_contribution_amount, duration_months, minimum_members, product_value }
  }

  // View: any Smart Buy access (Super Admin or Smart Buy Manager) may list
  // templates — but a non-global caller can only ever see 'active' ones,
  // regardless of what status filter they pass, matching "SmartBuy Manager
  // can view active schemes" (not inactive/retired ones).
  safeHandle(ipcMain, 'chits:templates:list', (_e, filters: Record<string, unknown> = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const requestedStatus = filters.status && filters.status !== 'all' ? String(filters.status) : null
    const status = isGlobalChitAccess(perms) ? requestedStatus : 'active'
    const rows = status
      ? db.prepare('SELECT * FROM chit_scheme_templates WHERE status=? ORDER BY scheme_name').all(status)
      : db.prepare('SELECT * FROM chit_scheme_templates ORDER BY scheme_name').all()
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'chits:templates:create', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can create SmartBuy schemes' }
    const validated = validateTemplatePayload(payload)
    if ('error' in validated) return { success: false, error: validated.error }

    const db = getDb()
    const caller = authUser()
    const id = crypto.randomUUID()
    const row = { id, ...validated, status: 'active', created_by: caller.id || null }
    db.prepare(`
      INSERT INTO chit_scheme_templates
        (id, scheme_name, monthly_contribution_amount, duration_months, minimum_members, product_value, status, created_by)
      VALUES (@id,@scheme_name,@monthly_contribution_amount,@duration_months,@minimum_members,@product_value,@status,@created_by)
    `).run(row)
    await enqueuSync('chit_scheme_templates', id, 'INSERT', row)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: null,
      action: 'CHIT_SCHEME_TEMPLATE_CREATED', tableName: 'chit_scheme_templates', recordId: id, newValues: row,
    })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'chits:templates:update', async (_e, id: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can edit SmartBuy schemes' }
    const db = getDb()
    const existing = db.prepare('SELECT * FROM chit_scheme_templates WHERE id=?').get(id) as Record<string, unknown> | undefined
    if (!existing) return { success: false, error: 'Scheme template not found' }

    const update: Record<string, unknown> = {}
    // Status (active/inactive) can be toggled independently of the
    // financial fields — "Activate/deactivate schemes" is its own action
    // in the spec, not bundled with a full edit.
    if (payload.status !== undefined) {
      const status = String(payload.status)
      if (status !== 'active' && status !== 'inactive') return { success: false, error: "Status must be 'active' or 'inactive'" }
      update.status = status
    }
    const editingFields = TEMPLATE_FIELDS.some(f => payload[f] !== undefined)
    if (editingFields) {
      // Partial edit — merge onto the existing row so a caller changing
      // just one field (e.g. only the amount) doesn't need to resend every
      // other field to pass validation.
      const validated = validateTemplatePayload({ ...existing, ...payload })
      if ('error' in validated) return { success: false, error: validated.error }
      Object.assign(update, validated)
    }
    if (Object.keys(update).length === 0) return { success: true, data: { id } }

    const caller = authUser()
    const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
    db.prepare(`UPDATE chit_scheme_templates SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
    await enqueuSync('chit_scheme_templates', id, 'UPDATE', { id, ...update })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: null,
      action: 'CHIT_SCHEME_TEMPLATE_UPDATED', tableName: 'chit_scheme_templates', recordId: id, newValues: update,
    })
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'chits:create', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    // Spec: "Without Super Admin approval, an Agent cannot create a Scheme."
    // No approval workflow exists yet (deferred to Phase 2 alongside Branch
    // Collaboration) — for now an Agent session can never create a scheme,
    // which trivially satisfies the requirement.
    if (resolveScopedAgentId(caller)) {
      return { success: false, error: 'Scheme creation requires Super Admin approval — not available yet.' }
    }
    // Centralized Scheme Master: name, contribution amount, duration, and
    // member capacity are never taken from the client payload — they're
    // always looked up server-side from the chosen template. A non-global
    // caller (Smart Buy Manager) may only instantiate an ACTIVE template;
    // Super Admin, who also owns the template catalog, may use any status.
    const templateId = String(payload.template_id || '')
    if (!templateId) return { success: false, error: 'Select a SmartBuy scheme' }
    const template = db.prepare('SELECT * FROM chit_scheme_templates WHERE id=?').get(templateId) as Record<string, unknown> | undefined
    if (!template) return { success: false, error: 'Selected SmartBuy scheme was not found' }
    if (!isGlobalChitAccess(perms) && template.status !== 'active') {
      return { success: false, error: 'Selected SmartBuy scheme is no longer active' }
    }

    const branchId = String(resolveScopedBranchId(perms, caller, payload.branch_id) || defaultBranchId())
    const name = String(template.scheme_name)
    const cycleCount = Number(template.duration_months) || 0
    const minMembers = Number(template.minimum_members) || 0
    // Member capacity (this specific branch batch's total slots) is the one
    // structural number the Scheme Master intentionally leaves out — unlike
    // contribution amount/duration/minimum-to-activate, it's not a property
    // of the reusable "SmartBuy 500" product itself (two branches can run
    // batches of very different sizes off the same template), so it stays
    // an operational choice made at instantiation time, same as
    // branch/product/agent — just floored at the template's minimum.
    const memberCount = Number(payload.member_count) || 0
    if (memberCount <= 0) return { success: false, error: 'Member count must be greater than 0' }
    if (memberCount < minMembers) return { success: false, error: `Member count cannot be less than this scheme's minimum members (${minMembers})` }
    const defaults = smartBuySettings()
    const contributionAmount = money(Number(template.monthly_contribution_amount) || 0)
    const chitValue = money(Number(template.product_value) || 0)
    const agentCommissionPct = Number(payload.agent_commission_pct) || 0
    if (agentCommissionPct < 0 || agentCommissionPct > 100) return { success: false, error: 'Agent commission % must be between 0 and 100' }
    const earlyRedemptionCount = Number(payload.early_redemption_count) || 0
    if (earlyRedemptionCount < 0 || earlyRedemptionCount > memberCount) return { success: false, error: 'Early redemption count must be between 0 and the member count (capacity)' }
    const registrationStart = payload.registration_start_date || null
    const registrationEnd = payload.registration_end_date || null
    if (registrationStart && registrationEnd && String(registrationEnd) < String(registrationStart)) {
      return { success: false, error: 'Registration end date cannot be before the start date' }
    }

    const id = crypto.randomUUID()
    const schemeNumber = nextChitNumber(db, branchId)
    const row = {
      id, scheme_number: schemeNumber, name, branch_id: branchId, template_id: templateId,
      product_id: payload.product_id || null, agent_id: payload.agent_id || null,
      member_count: memberCount, cycle_count: cycleCount, min_members: minMembers,
      frequency: payload.frequency || 'monthly',
      contribution_amount: contributionAmount,
      chit_value: chitValue,
      early_redemption_count: earlyRedemptionCount,
      early_redemption_amount: money(Number(payload.early_redemption_amount) || 0),
      repayment_months: payload.repayment_months !== undefined ? Number(payload.repayment_months) || 12 : defaults.defaultRepaymentMonths,
      agent_commission_pct: agentCommissionPct,
      start_date: payload.start_date || new Date().toISOString().slice(0, 10),
      next_draw_date: payload.next_draw_date || null,
      registration_start_date: registrationStart,
      registration_end_date: registrationEnd,
      late_payment_days: payload.late_payment_days !== undefined ? Number(payload.late_payment_days) || 0 : defaults.defaultLatePaymentDays,
      late_fee_amount: payload.late_fee_amount !== undefined ? money(Number(payload.late_fee_amount) || 0) : defaults.defaultLateFeeAmount,
      // Every scheme starts with 0 enrolled members, so it always begins
      // 'pending' — maybeActivateScheme() flips it to 'active' once
      // enrollment reaches min_members.
      status: 'pending', notes: payload.notes || null, created_by: caller.id || null,
    }
    db.prepare(`
      INSERT INTO chit_schemes
        (id, scheme_number, name, branch_id, template_id, product_id, agent_id, member_count, cycle_count, min_members,
         frequency, contribution_amount, chit_value, early_redemption_count, early_redemption_amount,
         repayment_months, agent_commission_pct, start_date, next_draw_date,
         registration_start_date, registration_end_date, late_payment_days, late_fee_amount,
         status, notes, created_by)
      VALUES (@id,@scheme_number,@name,@branch_id,@template_id,@product_id,@agent_id,@member_count,@cycle_count,@min_members,
         @frequency,@contribution_amount,@chit_value,@early_redemption_count,@early_redemption_amount,
         @repayment_months,@agent_commission_pct,@start_date,@next_draw_date,
         @registration_start_date,@registration_end_date,@late_payment_days,@late_fee_amount,
         @status,@notes,@created_by)
    `).run(row)
    await enqueuSync('chit_schemes', id, 'INSERT', row)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: branchId,
      action: 'CHIT_SCHEME_CREATED', tableName: 'chit_schemes', recordId: id,
      newValues: { name, schemeNumber, memberCount, minMembers },
    })
    createNotification('scheme_created', 'New SmartBuy Scheme Created',
      `${name} (${schemeNumber}) was created for your branch.`,
      { schemeId: id, branchId }, { roleScope: 'smartBuy', branchId })
    return { success: true, data: { id, scheme_number: schemeNumber } }
  })

  // Only non-structural fields are editable here — member_count/cycle_count/
  // contribution amounts etc. already have live members and draw history
  // riding on them, so they're deliberately excluded even if a caller sends
  // them (matches what EditSchemeModal actually sends on the frontend).
  // 'name' now comes from the Scheme Master template at creation time — a
  // Smart Buy Manager renaming it would be the same manual-typing loophole
  // the Scheme Master exists to close, so only a global (Super Admin)
  // caller may still adjust it (e.g. a genuine correction).
  const CHIT_UPDATE_ALLOWED_FIELDS_GLOBAL = ['name', 'agent_id', 'notes'] as const
  const CHIT_UPDATE_ALLOWED_FIELDS_SCOPED = ['agent_id', 'notes'] as const

  safeHandle(ipcMain, 'chits:update', async (_e, id: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const existing = db.prepare('SELECT id, branch_id FROM chit_schemes WHERE id = ?').get(id) as Record<string, unknown> | undefined
    if (!existing) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, existing.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

    const update: Record<string, unknown> = {}
    const allowedFields = isGlobalChitAccess(perms) ? CHIT_UPDATE_ALLOWED_FIELDS_GLOBAL : CHIT_UPDATE_ALLOWED_FIELDS_SCOPED
    for (const k of allowedFields) if (payload[k] !== undefined) update[k] = payload[k]

    const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
    if (fields) db.prepare(`UPDATE chit_schemes SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
    await enqueuSync('chit_schemes', id, 'UPDATE', { id, ...update })
    if (fields) {
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (existing.branch_id as string) || null,
        action: 'CHIT_SCHEME_UPDATED', tableName: 'chit_schemes', recordId: id, newValues: update,
      })
    }
    return { success: true }
  })

  // A scheme nobody ever enrolled in and nobody paid into has no history
  // worth keeping — remove it outright (same call as members:remove/withdraw
  // uses for a single member, one level up). Anything with real activity
  // (an enrolled member, a contribution) is cancelled instead: soft, so the
  // members/contributions/commission_ledger audit trail survives and every
  // other handler's existing `status !== 'active'` guards (draws,
  // contributions, redemption, enrollment) already block new activity on it.
  safeHandle(ipcMain, 'chits:delete', async (_e, id: string) => {
    const perms = currentPerms()
    // Deleting/cancelling a scheme is Super Admin only — a Branch Manager or
    // Smart Buy Manager (who can otherwise create/edit schemes via canManage)
    // must not be able to erase or cancel one on their own.
    if (!perms.all) return { success: false, error: 'Super Admin access required to delete a scheme' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT id, name, branch_id, agent_id, status FROM chit_schemes WHERE id = ?').get(id) as
      { id: string; name: string; branch_id: unknown; agent_id: string | null; status: string } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    if (scheme.status === 'cancelled') return { success: false, error: 'This scheme is already cancelled' }
    if (scheme.status === 'completed') return { success: false, error: 'A completed scheme cannot be deleted or cancelled' }

    // Counts ALL members (even withdrawn ones — that's still real enrollment
    // history) and draws conducted, not just approved contributions, so a
    // scheme that saw any activity at all is never silently hard-deleted.
    const enrolled = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=?`).get(id) as { c: number }
    const collected = db.prepare(`SELECT COALESCE(SUM(amount),0) as total FROM chit_contributions WHERE scheme_id=? AND status='approved'`).get(id) as { total: number }
    const draws = db.prepare(`SELECT COUNT(*) as c FROM chit_draws WHERE scheme_id=?`).get(id) as { c: number }

    if (enrolled.c === 0 && Number(collected.total) === 0 && draws.c === 0) {
      db.transaction(() => {
        db.prepare('DELETE FROM chit_scheme_branches WHERE scheme_id=?').run(id)
        db.prepare('DELETE FROM chit_schemes WHERE id=?').run(id)
      })()
      await enqueuSync('chit_schemes', id, 'DELETE', { id })
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: 'CHIT_SCHEME_DELETED', tableName: 'chit_schemes', recordId: id,
      })
      return { success: true, data: { hardDeleted: true } }
    }

    db.prepare(`UPDATE chit_schemes SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id)
    await enqueuSync('chit_schemes', id, 'UPDATE', { id, status: 'cancelled' })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
      action: 'CHIT_SCHEME_CANCELLED', tableName: 'chit_schemes', recordId: id,
    })
    notifySchemeAgentStatus(db, scheme.agent_id, scheme.name, 'cancelled', id)
    return { success: true, data: { hardDeleted: false } }
  })

  // ── Purge a cancelled scheme ─────────────────────────────────────────────
  // chits:delete deliberately never force-erases a scheme with real activity
  // — it cancels instead, so the history survives. This is the explicit,
  // Super-Admin-only escape hatch for cleaning up an already-cancelled scheme
  // for good (test data, duplicate entries, etc.) — genuinely irreversible,
  // and only reachable once the scheme is already in the terminal 'cancelled'
  // state. Two things it will NOT do, ever, because they'd corrupt data
  // outside this scheme's own history: touch a member who already received
  // a real product (redemption_invoice_id set — that invoice/stock movement
  // is real inventory history), or one with real repayment money already
  // collected against their post-redemption installment schedule.
  safeHandle(ipcMain, 'chits:purgeCancelled', async (_e, id: string) => {
    const perms = currentPerms()
    if (!perms.all) return { success: false, error: 'Super Admin access required to purge a scheme' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT id, name, scheme_number, branch_id, status FROM chit_schemes WHERE id = ?').get(id) as
      { id: string; name: string; scheme_number: string; branch_id: unknown; status: string } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (scheme.status !== 'cancelled') {
      return { success: false, error: 'Only an already-cancelled scheme can be purged — cancel it first' }
    }

    const redeemed = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND redemption_invoice_id IS NOT NULL`).get(id) as { c: number }
    if (redeemed.c > 0) {
      return { success: false, error: `Cannot purge — ${redeemed.c} member(s) already received a real product through this scheme (real invoices/stock movements exist and must stay).` }
    }
    const memberIds = (db.prepare(`SELECT id FROM chit_members WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const installmentIds = memberIds.length
      ? (db.prepare(`SELECT id, paid_amount FROM installments WHERE id IN (SELECT installment_id FROM chit_members WHERE scheme_id=? AND installment_id IS NOT NULL)`).all(id) as { id: string; paid_amount: number }[])
      : []
    const repaid = installmentIds.filter(i => Number(i.paid_amount) > 0)
    if (repaid.length > 0) {
      return { success: false, error: `Cannot purge — ${repaid.length} member(s) already repaid real money against this scheme's repayment schedule.` }
    }
    const ruleCnt = (db.prepare(`SELECT COUNT(*) as c FROM commission_rules WHERE scheme_id=?`).get(id) as { c: number }).c
    if (ruleCnt > 0) {
      return { success: false, error: `Cannot purge — ${ruleCnt} commission rule(s) are scoped to this scheme. Remove or repoint them first.` }
    }
    // Same "real money moved -> keep the record" principle as the repaid-
    // installments check above — an approved withdrawal with a nonzero
    // refund is real money leaving the business and must not be silently
    // erased by a purge (Production Readiness Audit, database integrity).
    const refundedCnt = (db.prepare(`SELECT COUNT(*) as c FROM withdrawal_requests WHERE scheme_id=? AND status='approved' AND refund_amount > 0`).get(id) as { c: number }).c
    if (refundedCnt > 0) {
      return { success: false, error: `Cannot purge — ${refundedCnt} member(s) received a real withdrawal refund through this scheme.` }
    }

    const commissionIds = (db.prepare(`SELECT id FROM commission_ledger WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const contributionIds = (db.prepare(`SELECT id FROM chit_contributions WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const drawIds = (db.prepare(`SELECT id FROM chit_draws WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const collabIds = (db.prepare(`SELECT id FROM chit_scheme_branches WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const withdrawalIds = (db.prepare(`SELECT id FROM withdrawal_requests WHERE scheme_id=?`).all(id) as { id: string }[]).map(r => r.id)
    const transferIds = memberIds.length
      ? (db.prepare(`SELECT id FROM smartbuy_transfer_history WHERE member_id IN (${memberIds.map(() => '?').join(',')})`).all(...memberIds) as { id: string }[]).map(r => r.id)
      : []
    const installmentIdList = installmentIds.map(i => i.id)

    db.transaction(() => {
      if (commissionIds.length) {
        db.prepare(`DELETE FROM commission_approval_logs WHERE commission_id IN (${commissionIds.map(() => '?').join(',')})`).run(...commissionIds)
        db.prepare(`DELETE FROM commission_ledger WHERE scheme_id=?`).run(id)
      }
      db.prepare(`DELETE FROM chit_draws WHERE scheme_id=?`).run(id)
      db.prepare(`DELETE FROM chit_contributions WHERE scheme_id=?`).run(id)
      db.prepare(`DELETE FROM chit_scheme_branches WHERE scheme_id=?`).run(id)
      // withdrawal_requests / smartbuy_transfer_history reference
      // chit_members without ON DELETE CASCADE — deleted here explicitly
      // (already confirmed above to carry no un-purgeable real money) so
      // the chit_members delete below doesn't hit a dangling foreign key.
      db.prepare(`DELETE FROM withdrawal_requests WHERE scheme_id=?`).run(id)
      if (memberIds.length) {
        db.prepare(`DELETE FROM smartbuy_transfer_history WHERE member_id IN (${memberIds.map(() => '?').join(',')})`).run(...memberIds)
      }
      // installment_schedule / installment_reminders cascade automatically
      // (ON DELETE CASCADE) once their parent installments row is gone.
      if (installmentIdList.length) {
        db.prepare(`DELETE FROM installments WHERE id IN (${installmentIdList.map(() => '?').join(',')})`).run(...installmentIdList)
      }
      db.prepare(`DELETE FROM chit_members WHERE scheme_id=?`).run(id)
      db.prepare(`DELETE FROM chit_schemes WHERE id=?`).run(id)
    })()

    for (const mid of memberIds) await enqueuSync('chit_members', mid, 'DELETE', { id: mid })
    for (const cid of contributionIds) await enqueuSync('chit_contributions', cid, 'DELETE', { id: cid })
    for (const did of drawIds) await enqueuSync('chit_draws', did, 'DELETE', { id: did })
    for (const coid of commissionIds) await enqueuSync('commission_ledger', coid, 'DELETE', { id: coid })
    for (const clid of collabIds) await enqueuSync('chit_scheme_branches', clid, 'DELETE', { id: clid })
    for (const wid of withdrawalIds) await enqueuSync('withdrawal_requests', wid, 'DELETE', { id: wid })
    for (const tid of transferIds) await enqueuSync('smartbuy_transfer_history', tid, 'DELETE', { id: tid })
    for (const iid of installmentIdList) await enqueuSync('installments', iid, 'DELETE', { id: iid })
    await enqueuSync('chit_schemes', id, 'DELETE', { id })

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
      action: 'CHIT_SCHEME_PURGED', tableName: 'chit_schemes', recordId: id,
      oldValues: { name: scheme.name, schemeNumber: scheme.scheme_number, membersRemoved: memberIds.length, contributionsRemoved: contributionIds.length },
    })
    return { success: true }
  })

  // Quick pause/resume, independent of delete/cancel — flips active<->inactive
  // only. 'pending' activates on its own once min_members is reached, and
  // 'completed'/'cancelled' are final states, so neither is toggleable here.
  // Every other handler's existing `status !== 'active'` guard already blocks
  // draws/contributions/enrollment/redemption on an 'inactive' scheme the
  // same way it already blocks them on 'cancelled'/'pending' — no other
  // change needed for the pause to actually take effect.
  safeHandle(ipcMain, 'chits:toggleActive', async (_e, id: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT id, name, branch_id, agent_id, status FROM chit_schemes WHERE id = ?').get(id) as
      { id: string; name: string; branch_id: unknown; agent_id: string | null; status: string } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    if (scheme.status !== 'active' && scheme.status !== 'inactive') {
      return { success: false, error: `A ${scheme.status} scheme cannot be toggled active/inactive` }
    }

    const nextStatus = scheme.status === 'active' ? 'inactive' : 'active'
    db.prepare(`UPDATE chit_schemes SET status=?, updated_at=datetime('now') WHERE id=?`).run(nextStatus, id)
    await enqueuSync('chit_schemes', id, 'UPDATE', { id, status: nextStatus })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
      action: 'CHIT_SCHEME_STATUS_TOGGLED', tableName: 'chit_schemes', recordId: id, newValues: { status: nextStatus },
    })
    notifySchemeAgentStatus(db, scheme.agent_id, scheme.name, nextStatus, id)
    return { success: true, data: { status: nextStatus } }
  })

  // ── Branch Collaboration ─────────────────────────────────────────────────
  // Only the scheme's home branch (or a global caller) may invite another
  // branch — collaboration extends who may enroll/collect, it never changes
  // who controls the scheme (draws, edits stay home-branch/global only).
  safeHandle(ipcMain, 'chits:branches:invite', async (_e, schemeId: string, targetBranchId: string, notes?: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT id, branch_id, name FROM chit_schemes WHERE id=?').get(schemeId) as { id: string; branch_id: string; name: string } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'Only the scheme\'s home branch can invite another branch to collaborate' }
    }
    if (String(targetBranchId) === String(scheme.branch_id)) {
      return { success: false, error: 'Cannot invite the scheme\'s own home branch' }
    }
    const targetBranch = db.prepare('SELECT id, name FROM branches WHERE id=?').get(targetBranchId) as { id: string; name: string } | undefined
    if (!targetBranch) return { success: false, error: 'Target branch not found' }
    const existing = db.prepare('SELECT id, status FROM chit_scheme_branches WHERE scheme_id=? AND branch_id=?').get(schemeId, targetBranchId) as { id: string; status: string } | undefined
    if (existing && existing.status === 'active') return { success: false, error: 'This branch is already collaborating on this scheme' }
    if (existing && existing.status === 'pending') return { success: false, error: 'An invitation to this branch is already pending' }

    const id = existing?.id || crypto.randomUUID()
    const row = {
      id, scheme_id: schemeId, branch_id: targetBranchId, status: 'pending',
      requested_by: caller.id || null, responded_by: null, responded_at: null, notes: notes || null,
    }
    if (existing) {
      // Re-inviting after a prior rejection/removal — reuse the row.
      db.prepare(`UPDATE chit_scheme_branches SET status='pending', requested_by=?, responded_by=NULL, responded_at=NULL, notes=?, updated_at=datetime('now') WHERE id=?`)
        .run(caller.id || null, notes || null, id)
      await enqueuSync('chit_scheme_branches', id, 'UPDATE', row)
    } else {
      db.prepare(`
        INSERT INTO chit_scheme_branches (id, scheme_id, branch_id, status, requested_by, notes)
        VALUES (@id,@scheme_id,@branch_id,@status,@requested_by,@notes)
      `).run(row)
      await enqueuSync('chit_scheme_branches', id, 'INSERT', row)
    }
    await touchSchemeSync(db, schemeId)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: scheme.branch_id,
      action: 'CHIT_BRANCH_COLLAB_INVITED', tableName: 'chit_scheme_branches', recordId: id,
      newValues: { schemeId, targetBranchId },
    })
    createNotification('chit_collaboration_invite', 'Branch Collaboration Invite',
      `${targetBranch.name} invited to collaborate on "${scheme.name}"`,
      { schemeId, targetBranchId })
    return { success: true, data: { id } }
  })

  // Approve/reject an invite — only the invited branch's own manager, or a
  // global caller, may respond (the home branch cannot approve itself in).
  safeHandle(ipcMain, 'chits:branches:respond', async (_e, collaborationId: string, action: 'approve' | 'reject', notes?: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const collab = db.prepare('SELECT * FROM chit_scheme_branches WHERE id=?').get(collaborationId) as Record<string, unknown> | undefined
    if (!collab) return { success: false, error: 'Collaboration request not found' }
    if (collab.status !== 'pending') return { success: false, error: 'This request has already been responded to' }
    if (!assertBranchScope(perms, caller, collab.branch_id)) {
      return { success: false, error: 'Only the invited branch can respond to this request' }
    }

    const newStatus = action === 'approve' ? 'active' : 'rejected'
    db.prepare(`UPDATE chit_scheme_branches SET status=?, responded_by=?, responded_at=datetime('now'), notes=COALESCE(?, notes), updated_at=datetime('now') WHERE id=?`)
      .run(newStatus, caller.id || null, notes || null, collaborationId)
    await enqueuSync('chit_scheme_branches', collaborationId, 'UPDATE', { id: collaborationId, status: newStatus, responded_by: caller.id || null })

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (collab.branch_id as string) || null,
      action: action === 'approve' ? 'CHIT_BRANCH_COLLAB_APPROVED' : 'CHIT_BRANCH_COLLAB_REJECTED',
      tableName: 'chit_scheme_branches', recordId: collaborationId,
      newValues: { schemeId: collab.scheme_id },
    })
    // Approving may itself cross min_members if the collaborating branch
    // already had members recorded some other way — harmless no-op otherwise.
    if (newStatus === 'active' && maybeActivateScheme(db, String(collab.scheme_id))) {
      await enqueuSync('chit_schemes', String(collab.scheme_id), 'UPDATE', { id: collab.scheme_id, status: 'active' })
    } else {
      await touchSchemeSync(db, String(collab.scheme_id))
    }
    return { success: true }
  })

  // Ends a branch's collaboration (does not withdraw members already
  // enrolled through it — only the home branch or global may do this).
  safeHandle(ipcMain, 'chits:branches:remove', async (_e, collaborationId: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const collab = db.prepare(`
      SELECT csb.*, cs.branch_id as scheme_branch_id FROM chit_scheme_branches csb
      JOIN chit_schemes cs ON cs.id = csb.scheme_id WHERE csb.id=?
    `).get(collaborationId) as Record<string, unknown> | undefined
    if (!collab) return { success: false, error: 'Collaboration not found' }
    if (!assertBranchScope(perms, caller, collab.scheme_branch_id)) {
      return { success: false, error: 'Only the scheme\'s home branch can remove a collaborating branch' }
    }
    db.prepare(`UPDATE chit_scheme_branches SET status='removed', updated_at=datetime('now') WHERE id=?`).run(collaborationId)
    await enqueuSync('chit_scheme_branches', collaborationId, 'UPDATE', { id: collaborationId, status: 'removed' })
    await touchSchemeSync(db, String(collab.scheme_id))
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (collab.scheme_branch_id as string) || null,
      action: 'CHIT_BRANCH_COLLAB_REMOVED', tableName: 'chit_scheme_branches', recordId: collaborationId,
      newValues: { schemeId: collab.scheme_id },
    })
    return { success: true }
  })

  // Cross-scheme view for a branch manager: every pending invite addressed
  // to my branch, across all schemes (surfaced on the Smart Buy dashboard).
  safeHandle(ipcMain, 'chits:branches:pendingInvites', (_e) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const isGlobal = isGlobalChitAccess(perms)
    const branchId = caller.branch_id as string | undefined
    if (!isGlobal && !branchId) return { success: true, data: [] }

    const where = isGlobal ? `WHERE csb.status='pending'` : `WHERE csb.status='pending' AND csb.branch_id=?`
    const params = isGlobal ? [] : [branchId]
    const rows = db.prepare(`
      SELECT csb.*, cs.name as scheme_name, cs.scheme_number, cs.min_members, cs.member_count,
        hb.name as home_branch_name, tb.name as target_branch_name,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled
      FROM chit_scheme_branches csb
      JOIN chit_schemes cs ON cs.id = csb.scheme_id
      LEFT JOIN branches hb ON hb.id = cs.branch_id
      LEFT JOIN branches tb ON tb.id = csb.branch_id
      ${where}
      ORDER BY csb.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Members: individual add ─────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:members:add', async (_e, schemeId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme as { id: unknown; branch_id: unknown })) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    // A completed/cancelled scheme has no future cycles left to enroll
    // into — without this, a scheme that finished with spare capacity
    // (some earlier withdrawals) could silently accept a new member after
    // maybeCompleteScheme() already closed it out.
    if (scheme.status !== 'pending' && scheme.status !== 'active') {
      return { success: false, error: `Cannot enroll a member into a ${scheme.status} scheme` }
    }
    const registrationBlocked = assertRegistrationWindow(scheme)
    if (registrationBlocked) return { success: false, error: registrationBlocked }
    // An Agent session can only enroll members under their own agent id —
    // ignore any client-supplied override, same pattern as branch scoping.
    const scopedAgentId = resolveScopedAgentId(caller)
    if (scopedAgentId) payload.agent_id = scopedAgentId
    // Which branch actually recruited this member — the caller's own branch
    // when scoped (home or an active collaborator), else the scheme's home
    // branch for global callers (no branch of their own to attribute to).
    const enrolledBranchId = !isGlobalChitAccess(perms) ? (caller.branch_id as string | undefined) : (scheme.branch_id as string | undefined)

    const enrolled = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }
    if (enrolled.c >= Number(scheme.member_count)) return { success: false, error: 'This chit scheme is already full' }

    let customerId = String(payload.customer_id || '')

    // No explicit customer_id supplied — try to match an existing customer
    // by phone or NIC before creating a new one, so enrolling someone who's
    // already a walk-in customer doesn't create a duplicate record.
    if (!customerId) {
      const phone = String(payload.customer_phone || '').trim()
      const nic = String(payload.customer_nic || '').trim()
      if (phone || nic) {
        const conditions: string[] = []
        const params: unknown[] = []
        if (phone) { conditions.push('phone = ?'); params.push(phone) }
        if (nic)   { conditions.push('nic = ?'); params.push(nic) }
        const matched = db.prepare(`SELECT id FROM customers WHERE ${conditions.join(' OR ')} LIMIT 1`).get(...params) as { id: string } | undefined
        if (matched) customerId = matched.id
      }
    }

    if (customerId) {
      const already = db.prepare(`SELECT id FROM chit_members WHERE scheme_id=? AND customer_id=?`).get(schemeId, customerId)
      if (already) return { success: false, error: 'This customer is already enrolled in this scheme' }
    } else {
      // Creating a brand-new customer record from this enrollment — apply
      // the same phone/email/NIC format validation the bulk Excel import
      // already enforces, via the shared validator (SmartBuy fix audit,
      // MED-1), so the two entry points can no longer drift apart.
      const contactError = validateContactFields({
        phone: payload.customer_phone, email: payload.customer_email, nic: payload.customer_nic,
      })
      if (contactError) return { success: false, error: contactError }
    }

    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> = []

    const memberId = crypto.randomUUID()
    const nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m + 1

    db.transaction(() => {
      if (!customerId) {
        customerId = crypto.randomUUID()
        const customerRow = {
          id: customerId, branch_id: enrolledBranchId || scheme.branch_id,
          name: payload.customer_name || 'Chit Member', phone: payload.customer_phone || null,
          email: payload.customer_email || null, address: payload.customer_address || null,
          nic: payload.customer_nic || null, notes: 'Created from Chit Fund enrollment',
        }
        db.prepare(`
          INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
          VALUES (@id,@branch_id,@name,@phone,@email,@address,@nic,@notes)
        `).run(customerRow)
        enqueue.push({ table: 'customers', id: customerId, row: customerRow })
      }

      const isEarly = nextOrder <= Number(scheme.early_redemption_count)
      const memberRow = {
        id: memberId, scheme_id: schemeId, customer_id: customerId, agent_id: payload.agent_id || null, join_order: nextOrder,
        is_early_redemption: isEarly ? 1 : 0, redemption_type: null, won_cycle_no: null,
        product_received_at: null, contributions_paid: 0, installment_id: null,
        status: 'active', eligibility_note: null, enrolled_branch_id: enrolledBranchId || scheme.branch_id,
      }
      db.prepare(`
        INSERT INTO chit_members
          (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
           won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note,
           enrolled_branch_id)
        VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
           @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note,
           @enrolled_branch_id)
      `).run(memberRow)
      enqueue.push({ table: 'chit_members', id: memberId, row: memberRow })
      // Who signed up whom is the most sensitive event in the module — the
      // audit entry records the acting user, the enrolling agent (if any),
      // the branch, the scheme, and the customer (SmartBuy fix audit, HIGH-4).
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (enrolledBranchId as string) || (scheme.branch_id as string) || null,
        action: 'CHIT_MEMBER_ADDED', tableName: 'chit_members', recordId: memberId,
        newValues: { schemeId, customerId, agentId: memberRow.agent_id, joinOrder: nextOrder },
        ipAddress: (caller.deviceId as string) || null,
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, 'INSERT', item.row)
    if (maybeActivateScheme(db, schemeId)) {
      await enqueuSync('chit_schemes', schemeId, 'UPDATE', { id: schemeId, status: 'active' })
    } else {
      await touchSchemeSync(db, schemeId)
    }
    return { success: true, data: { id: memberId, join_order: nextOrder } }
  })

  // ── Register a member from a physical paper record (ledger book / invoice
  // booklet) in one step: enroll the member (with the paper's own reference
  // code for traceability) and record their initial payment, backdated to
  // when it actually happened on paper — instead of two separate actions
  // with no way to backdate. Wraps the same logic as members:add +
  // contributions:record in a single transaction so a failure partway
  // through can't leave a member with no matching payment record.
  safeHandle(ipcMain, 'chits:members:registerHistorical', async (_e, schemeId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme as { id: unknown; branch_id: unknown })) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    if (scheme.status !== 'pending' && scheme.status !== 'active') {
      return { success: false, error: `Cannot enroll a member into a ${scheme.status} scheme` }
    }
    const scopedAgentId = resolveScopedAgentId(caller)
    if (scopedAgentId) payload.agent_id = scopedAgentId
    const enrolledBranchId = !isGlobalChitAccess(perms) ? (caller.branch_id as string | undefined) : (scheme.branch_id as string | undefined)

    const enrolled = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }
    if (enrolled.c >= Number(scheme.member_count)) return { success: false, error: 'This chit scheme is already full' }

    let customerId = String(payload.customer_id || '')
    if (!customerId) {
      const phone = String(payload.customer_phone || '').trim()
      const nic = String(payload.customer_nic || '').trim()
      if (phone || nic) {
        const conditions: string[] = []
        const params: unknown[] = []
        if (phone) { conditions.push('phone = ?'); params.push(phone) }
        if (nic)   { conditions.push('nic = ?'); params.push(nic) }
        const matched = db.prepare(`SELECT id FROM customers WHERE ${conditions.join(' OR ')} LIMIT 1`).get(...params) as { id: string } | undefined
        if (matched) customerId = matched.id
      }
    }
    if (customerId) {
      const already = db.prepare(`SELECT id FROM chit_members WHERE scheme_id=? AND customer_id=?`).get(schemeId, customerId)
      if (already) return { success: false, error: 'This customer is already enrolled in this scheme' }
    } else {
      const contactError = validateContactFields({
        phone: payload.customer_phone, email: payload.customer_email, nic: payload.customer_nic,
      })
      if (contactError) return { success: false, error: contactError }
    }

    const initialAmount = money(Number(payload.initial_amount) || 0)
    const agentId = payload.agent_id || null

    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
    const memberId = crypto.randomUUID()
    const nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m + 1
    let contributionId: string | null = null
    let activated = false

    db.transaction(() => {
      if (!customerId) {
        customerId = crypto.randomUUID()
        const customerRow = {
          id: customerId, branch_id: enrolledBranchId || scheme.branch_id,
          name: payload.customer_name || 'Chit Member', phone: payload.customer_phone || null,
          email: payload.customer_email || null, address: payload.customer_address || null,
          nic: payload.customer_nic || null, notes: 'Registered from paper record',
        }
        db.prepare(`
          INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
          VALUES (@id,@branch_id,@name,@phone,@email,@address,@nic,@notes)
        `).run(customerRow)
        enqueue.push({ table: 'customers', id: customerId, row: customerRow, op: 'INSERT' })
      }

      const isEarly = nextOrder <= Number(scheme.early_redemption_count)
      const memberRow = {
        id: memberId, scheme_id: schemeId, customer_id: customerId, agent_id: agentId, join_order: nextOrder,
        is_early_redemption: isEarly ? 1 : 0, redemption_type: null, won_cycle_no: null,
        product_received_at: null, contributions_paid: initialAmount > 0 ? initialAmount : 0, installment_id: null,
        status: 'active', eligibility_note: null,
        paper_reference_code: payload.paper_reference_code || null,
        enrolled_branch_id: enrolledBranchId || scheme.branch_id,
      }
      db.prepare(`
        INSERT INTO chit_members
          (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
           won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note,
           paper_reference_code, enrolled_branch_id)
        VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
           @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note,
           @paper_reference_code,@enrolled_branch_id)
      `).run(memberRow)
      enqueue.push({ table: 'chit_members', id: memberId, row: memberRow, op: 'INSERT' })

      // This enrollment may itself be the one that crosses min_members —
      // activate first so a same-transaction initial payment isn't wrongly
      // blocked by a now-stale 'pending' status.
      activated = maybeActivateScheme(db, schemeId)

      if (initialAmount > 0) {
        const currentStatus = (db.prepare('SELECT status FROM chit_schemes WHERE id=?').get(schemeId) as { status: string }).status
        if (currentStatus === 'pending') {
          throw new Error('Scheme is pending — cannot collect the first installment until minimum members are reached')
        }
        contributionId = crypto.randomUUID()
        const method = String(payload.method || 'cash')
        // Commission is no longer accrued per contribution — it's computed
        // once, at redemption, against the actual product the member takes.
        const contributionRow = {
          id: contributionId, scheme_id: schemeId, member_id: memberId, cycle_no: null,
          contribution_type: 'cycle', amount: initialAmount, method,
          receipt_number: payload.receipt_number || null, reference: payload.reference || null,
          status: 'approved', received_by: caller.id || null, collected_by_agent_id: agentId,
          branch_id: scheme.branch_id, commission_amount: 0, notes: 'Registered from paper record',
          paid_at: payload.paid_at ? String(payload.paid_at) : new Date().toISOString(),
        }
        db.prepare(`
          INSERT INTO chit_contributions
            (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number,
             reference, status, received_by, collected_by_agent_id, branch_id, commission_amount, notes, paid_at)
          VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@receipt_number,
             @reference,@status,@received_by,@collected_by_agent_id,@branch_id,@commission_amount,@notes,@paid_at)
        `).run(contributionRow)
        enqueue.push({ table: 'chit_contributions', id: contributionId, row: contributionRow, op: 'INSERT' })
      }

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: 'CHIT_MEMBER_REGISTERED_HISTORICAL', tableName: 'chit_members', recordId: memberId,
        newValues: { schemeId, customerId, agentId, initialAmount, paperReferenceCode: payload.paper_reference_code },
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    if (activated) {
      await enqueuSync('chit_schemes', schemeId, 'UPDATE', { id: schemeId, status: 'active' })
    } else {
      await touchSchemeSync(db, schemeId)
    }
    return { success: true, data: { id: memberId, join_order: nextOrder, contributionId } }
  })

  // ── Member Withdrawal / Exit Management ────────────────────────────────
  // Business rules (confirmed, hybrid policy):
  //  - Pre-activation (scheme still 'pending'): withdrawal is immediate,
  //    no approval gate — full refund of whatever the member has actually
  //    paid in (contributions_paid; credit_balance is already a subset of
  //    that figure, never additive, so no separate accounting is needed).
  //  - Post-activation (scheme 'active'): requires Super Admin approval.
  //    Refund is NOT auto-computed — the approver enters the amount by
  //    hand (deliberately no fixed formula), capped at the member's net
  //    contribution at approval time so a refund can never exceed real
  //    money the company actually collected from them.
  //  - A winner (status='redeemed' — set the instant they win a draw,
  //    before any invoice/stock is touched, see chits:draws:conduct) can
  //    never withdraw, claimed or not. This was already enforced by the
  //    old chits:members:remove and is unchanged here — correct as-is.
  //  - The vacant slot needs no special "replacement" mechanism: capacity
  //    checks throughout this file already count only non-withdrawn
  //    members against member_count (see chits:members:add), so a new
  //    member can be enrolled into the reopened seat the normal way the
  //    moment a withdrawal is finalized.
  safeHandle(ipcMain, 'chits:withdrawals:request', async (_e, memberId: string, reason: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const trimmedReason = String(reason || '').trim()
    if (!trimmedReason) return { success: false, error: 'A withdrawal reason is required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id as scheme_branch_id, cs.status as scheme_status
      FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
      WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertMemberAccess(perms, caller, { branch_id: member.scheme_branch_id }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    if (member.status === 'redeemed') return { success: false, error: 'This member has already won and received their product — a winner cannot withdraw' }
    if (member.status === 'withdrawn') return { success: false, error: 'This member has already withdrawn' }
    const scheme = member.scheme_status as string
    if (scheme !== 'pending' && scheme !== 'active') {
      return { success: false, error: `Cannot process a withdrawal on a ${scheme} scheme` }
    }
    const existingPending = db.prepare(`SELECT id FROM withdrawal_requests WHERE member_id=? AND status='pending'`).get(memberId)
    if (existingPending) return { success: false, error: 'A withdrawal request for this member is already pending review' }

    const id = crypto.randomUUID()
    const branchId = (member.scheme_branch_id as string) || null
    const nowIso = new Date().toISOString()

    if (scheme === 'pending') {
      // Pre-activation: immediate, full refund, no review step. Still
      // recorded through the same table/shape as a post-activation request
      // (self-resolved) so every withdrawal — whichever path — has one
      // uniform, fully traceable audit record.
      const refundAmount = money(Number(member.contributions_paid) || 0)
      const row = {
        id, member_id: memberId, scheme_id: member.scheme_id, branch_id: branchId,
        requested_by: caller.id || null, reason: trimmedReason, scheme_was_active: 0,
        status: 'approved', refund_amount: refundAmount,
        reviewed_by: caller.id || null, reviewed_at: nowIso,
        review_reason: 'Auto-approved — scheme had not yet activated',
      }
      db.transaction(() => {
        db.prepare(`
          INSERT INTO withdrawal_requests
            (id, member_id, scheme_id, branch_id, requested_by, reason, scheme_was_active, status,
             refund_amount, reviewed_by, reviewed_at, review_reason)
          VALUES (@id,@member_id,@scheme_id,@branch_id,@requested_by,@reason,@scheme_was_active,@status,
             @refund_amount,@reviewed_by,@reviewed_at,@review_reason)
        `).run(row)
        db.prepare(`UPDATE chit_members SET status='withdrawn', credit_balance=0, updated_at=datetime('now') WHERE id=?`).run(memberId)
        logAudit(db, {
          userId: (caller.id as string) || null, branchId,
          action: 'CHIT_MEMBER_WITHDRAWN', tableName: 'chit_members', recordId: memberId,
          newValues: { reason: trimmedReason, refundAmount, schemeWasActive: false },
        })
      })()
      await enqueuSync('withdrawal_requests', id, 'INSERT', row)
      await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, status: 'withdrawn', credit_balance: 0 })
      await touchSchemeSync(db, String(member.scheme_id))
      return { success: true, data: { id, status: 'approved', refundAmount } }
    }

    // Post-activation: create a pending request, member keeps their seat
    // and stays 'active' until a Super Admin reviews it.
    const row = {
      id, member_id: memberId, scheme_id: member.scheme_id, branch_id: branchId,
      requested_by: caller.id || null, reason: trimmedReason, scheme_was_active: 1, status: 'pending',
    }
    db.prepare(`
      INSERT INTO withdrawal_requests (id, member_id, scheme_id, branch_id, requested_by, reason, scheme_was_active, status)
      VALUES (@id,@member_id,@scheme_id,@branch_id,@requested_by,@reason,@scheme_was_active,@status)
    `).run(row)
    await enqueuSync('withdrawal_requests', id, 'INSERT', row)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId,
      action: 'CHIT_WITHDRAWAL_REQUESTED', tableName: 'withdrawal_requests', recordId: id,
      newValues: { memberId, reason: trimmedReason },
    })
    return { success: true, data: { id, status: 'pending' } }
  })

  safeHandle(ipcMain, 'chits:withdrawals:approve', async (_e, withdrawalId: string, refundAmount: number, reviewReason: string) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can approve a withdrawal' }
    const trimmedReason = String(reviewReason || '').trim()
    if (!trimmedReason) return { success: false, error: 'An approval reason is required' }
    const refund = money(Number(refundAmount) || 0)
    if (refund < 0) return { success: false, error: 'Refund amount cannot be negative' }

    const db = getDb()
    const caller = authUser()
    const request = db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(withdrawalId) as Record<string, unknown> | undefined
    if (!request) return { success: false, error: 'Withdrawal request not found' }
    if (request.status !== 'pending') return { success: false, error: `This request is already ${request.status} — nothing to approve` }
    const member = db.prepare('SELECT id, status, contributions_paid FROM chit_members WHERE id=?').get(request.member_id) as { id: string; status: string; contributions_paid: number } | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (member.status !== 'active') return { success: false, error: `Member is no longer active (status: ${member.status}) — cannot complete this withdrawal` }
    // Cap checked fresh against the member's CURRENT net contribution, not
    // whatever it was at request time — a bank-transfer payment can land
    // and get verified while a request sits pending.
    const netContribution = money(Number(member.contributions_paid) || 0)
    if (refund > netContribution) {
      return { success: false, error: `Refund cannot exceed this member's net contribution (Rs.${netContribution})` }
    }

    db.transaction(() => {
      db.prepare(`
        UPDATE withdrawal_requests
        SET status='approved', refund_amount=?, reviewed_by=?, reviewed_at=datetime('now'), review_reason=?, updated_at=datetime('now')
        WHERE id=?
      `).run(refund, caller.id || null, trimmedReason, withdrawalId)
      db.prepare(`UPDATE chit_members SET status='withdrawn', credit_balance=0, updated_at=datetime('now') WHERE id=?`).run(request.member_id)
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (request.branch_id as string) || null,
        action: 'CHIT_WITHDRAWAL_APPROVED', tableName: 'withdrawal_requests', recordId: withdrawalId,
        newValues: { refundAmount: refund, reviewReason: trimmedReason },
      })
    })()
    await enqueuSync('withdrawal_requests', withdrawalId, 'UPDATE', { id: withdrawalId, status: 'approved', refund_amount: refund, reviewed_by: caller.id || null, review_reason: trimmedReason })
    await enqueuSync('chit_members', String(request.member_id), 'UPDATE', { id: request.member_id, status: 'withdrawn', credit_balance: 0 })
    await touchSchemeSync(db, String(request.scheme_id))
    return { success: true, data: { id: withdrawalId, refundAmount: refund } }
  })

  safeHandle(ipcMain, 'chits:withdrawals:reject', async (_e, withdrawalId: string, reviewReason: string) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can reject a withdrawal' }
    const trimmedReason = String(reviewReason || '').trim()
    if (!trimmedReason) return { success: false, error: 'A rejection reason is required' }

    const db = getDb()
    const caller = authUser()
    const request = db.prepare('SELECT * FROM withdrawal_requests WHERE id=?').get(withdrawalId) as Record<string, unknown> | undefined
    if (!request) return { success: false, error: 'Withdrawal request not found' }
    if (request.status !== 'pending') return { success: false, error: `This request is already ${request.status} — nothing to reject` }

    db.prepare(`
      UPDATE withdrawal_requests
      SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), review_reason=?, updated_at=datetime('now')
      WHERE id=?
    `).run(caller.id || null, trimmedReason, withdrawalId)
    await enqueuSync('withdrawal_requests', withdrawalId, 'UPDATE', { id: withdrawalId, status: 'rejected', reviewed_by: caller.id || null, review_reason: trimmedReason })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (request.branch_id as string) || null,
      action: 'CHIT_WITHDRAWAL_REJECTED', tableName: 'withdrawal_requests', recordId: withdrawalId,
      newValues: { reviewReason: trimmedReason },
    })
    return { success: true }
  })

  safeHandle(ipcMain, 'chits:withdrawals:list', (_e, filters: { schemeId?: string; status?: string; branchId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('w.branch_id = ?'); params.push(branchId) }
    if (filters.schemeId) { conditions.push('w.scheme_id = ?'); params.push(filters.schemeId) }
    if (filters.status) { conditions.push('w.status = ?'); params.push(filters.status) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT w.*, c.name as customer_name, c.phone as customer_phone,
        cs.name as scheme_name, cs.scheme_number, b.name as branch_name,
        ru.name as requested_by_name, rvu.name as reviewed_by_name
      FROM withdrawal_requests w
      JOIN chit_members m ON m.id = w.member_id
      LEFT JOIN customers c ON c.id = m.customer_id
      JOIN chit_schemes cs ON cs.id = w.scheme_id
      LEFT JOIN branches b ON b.id = w.branch_id
      LEFT JOIN users ru ON ru.id = w.requested_by
      LEFT JOIN users rvu ON rvu.id = w.reviewed_by
      ${where}
      ORDER BY w.requested_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'chits:members:list', (_e, schemeId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const scheme = db.prepare('SELECT id, branch_id FROM chit_schemes WHERE id=?').get(schemeId) as { id: string; branch_id: unknown } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    const rows = db.prepare(`
      SELECT m.*, c.name as customer_name, c.phone as customer_phone,
        ma.name as member_agent_name, ma.code as member_agent_code
      FROM chit_members m
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      WHERE m.scheme_id = ?
      ORDER BY m.join_order
    `).all(schemeId)
    return { success: true, data: rows }
  })

  // ── Members: bulk upload (Excel/CSV), same shape as agents:downloadTemplate/importExcel ──
  safeHandle(ipcMain, 'chits:members:downloadTemplate', async () => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const saveResult = await dialog.showSaveDialog({
      title: 'Save Chit Member Import Template',
      defaultPath: 'chit-member-import-template.xlsx',
      filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    })
    if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

    const wb = XLSX.utils.book_new()
    const sample = [
      { 'Customer Name': 'Kamala Perera', 'Phone': '0771234567', 'Email': '', 'NIC': '', 'Address': '', 'Agent Code': '' },
      { 'Customer Name': '', 'Phone': '', 'Email': '', 'NIC': '', 'Address': '', 'Agent Code': '' },
    ]
    const ws = XLSX.utils.json_to_sheet(sample)
    ws['!cols'] = [{ wch: 22 }, { wch: 16 }, { wch: 26 }, { wch: 16 }, { wch: 30 }, { wch: 14 }]
    XLSX.utils.book_append_sheet(wb, ws, 'Members')

    const instructions = XLSX.utils.aoa_to_sheet([
      ['Column', 'Required', 'Rules'],
      ['Customer Name', 'Yes', 'Full name of the member'],
      ['Phone', 'Yes', '9-12 digits, optional leading +'],
      ['Email', 'No', 'Must be a valid email if provided'],
      ['NIC', 'No', 'Sri Lankan NIC format if provided'],
      ['Address', 'No', 'Free text'],
      ['Agent Code', 'No', 'Must match an existing agent\'s code exactly if provided — leave blank to use the scheme\'s default agent'],
      [],
      ['If a phone or NIC already matches an existing customer, that customer is reused instead of creating a duplicate.'],
      ['Members are enrolled in the order rows appear in this file. Join order determines early-redemption eligibility.'],
      ['Upload this file from the Chit Fund scheme page → Bulk Import Members.'],
    ])
    instructions['!cols'] = [{ wch: 18 }, { wch: 10 }, { wch: 70 }]
    XLSX.utils.book_append_sheet(wb, instructions, 'Instructions')

    XLSX.writeFile(wb, saveResult.filePath)
    return { success: true, filePath: saveResult.filePath }
  })

  safeHandle(ipcMain, 'chits:members:importExcel', async (_e, schemeId: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme as { id: unknown; branch_id: unknown })) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    if (scheme.status !== 'pending' && scheme.status !== 'active') {
      return { success: false, error: `Cannot enroll a member into a ${scheme.status} scheme` }
    }
    const registrationBlocked = assertRegistrationWindow(scheme)
    if (registrationBlocked) return { success: false, error: registrationBlocked }
    const enrolledBranchId = !isGlobalChitAccess(perms) ? (caller.branch_id as string | undefined) : (scheme.branch_id as string | undefined)

    const { filePaths } = await dialog.showOpenDialog({
      title: 'Select Chit Member Import File',
      filters: [{ name: 'Excel / CSV', extensions: ['xlsx', 'xls', 'csv'] }],
      properties: ['openFile'],
    })
    if (!filePaths || filePaths.length === 0) return { success: false, cancelled: true }

    const workbook = XLSX.readFile(filePaths[0])
    const sheetName = workbook.SheetNames.find(n => n.toLowerCase() === 'members') || workbook.SheetNames[0]
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' }) as Record<string, unknown>[]

    let imported = 0
    let skipped = 0
    const errors: string[] = []
    let nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m
    const capacity = Number(scheme.member_count) - (db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }).c

    // Pre-load agents once (not per row) for the optional "Agent Code" column.
    const agentRows = db.prepare('SELECT id, code FROM agents').all() as { id: string; code: string }[]
    const agentByCode = new Map(agentRows.map(a => [a.code.toUpperCase().trim(), a.id]))

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      const rowNum = i + 2
      const name = importCell(row, 'Customer Name', 'Name')
      const phone = importCell(row, 'Phone')
      const email = importCell(row, 'Email')
      const nic = importCell(row, 'NIC')
      const address = importCell(row, 'Address')
      const agentCode = importCell(row, 'Agent Code', 'Agent')

      if (!name && !phone) continue // fully blank row
      if (imported >= capacity) { errors.push(`Row ${rowNum}: skipped — chit scheme is full`); skipped++; continue }
      if (!name) { errors.push(`Row ${rowNum}: customer name is required`); skipped++; continue }
      if (!phone) { errors.push(`Row ${rowNum}: phone is required`); skipped++; continue }
      if (!PHONE_RE.test(phone)) { errors.push(`Row ${rowNum}: invalid phone "${phone}"`); skipped++; continue }
      if (email && !EMAIL_RE.test(email)) { errors.push(`Row ${rowNum}: invalid email "${email}"`); skipped++; continue }
      if (nic && !NIC_RE.test(nic)) { errors.push(`Row ${rowNum}: invalid NIC "${nic}"`); skipped++; continue }
      let agentId: string | null = null
      if (agentCode) {
        const matched = agentByCode.get(agentCode.toUpperCase().trim())
        if (!matched) { errors.push(`Row ${rowNum}: unknown agent code "${agentCode}"`); skipped++; continue }
        agentId = matched
      }

      try {
        // Look up an existing customer by phone or NIC before creating a
        // fresh one, same rule as the single-add flow.
        let customerId = ''
        const matchConditions: string[] = []
        const matchParams: unknown[] = []
        if (phone) { matchConditions.push('phone = ?'); matchParams.push(phone) }
        if (nic)   { matchConditions.push('nic = ?'); matchParams.push(nic) }
        const matched = matchConditions.length
          ? db.prepare(`SELECT id FROM customers WHERE ${matchConditions.join(' OR ')} LIMIT 1`).get(...matchParams) as { id: string } | undefined
          : undefined
        if (matched) {
          customerId = matched.id
          const already = db.prepare(`SELECT id FROM chit_members WHERE scheme_id=? AND customer_id=?`).get(schemeId, customerId)
          if (already) { errors.push(`Row ${rowNum}: this customer is already enrolled in this scheme`); skipped++; continue }
        } else {
          customerId = crypto.randomUUID()
          const customerRow = {
            id: customerId, branch_id: enrolledBranchId || scheme.branch_id, name, phone,
            email: email || null, address: address || null, nic: nic || null,
            notes: 'Created from Chit Fund bulk import',
          }
          db.prepare(`
            INSERT INTO customers (id, branch_id, name, phone, email, address, nic, notes)
            VALUES (@id,@branch_id,@name,@phone,@email,@address,@nic,@notes)
          `).run(customerRow)
          await enqueuSync('customers', customerId, 'INSERT', customerRow)
        }

        nextOrder += 1
        const memberId = crypto.randomUUID()
        const isEarly = nextOrder <= Number(scheme.early_redemption_count)
        const memberRow = {
          id: memberId, scheme_id: schemeId, customer_id: customerId, agent_id: agentId, join_order: nextOrder,
          is_early_redemption: isEarly ? 1 : 0, redemption_type: null, won_cycle_no: null,
          product_received_at: null, contributions_paid: 0, installment_id: null,
          status: 'active', eligibility_note: null, enrolled_branch_id: enrolledBranchId || scheme.branch_id,
        }
        db.prepare(`
          INSERT INTO chit_members
            (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
             won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note,
             enrolled_branch_id)
          VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
             @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note,
             @enrolled_branch_id)
        `).run(memberRow)
        await enqueuSync('chit_members', memberId, 'INSERT', memberRow)
        imported++
      } catch (err: unknown) {
        errors.push(`Row ${rowNum}: ${(err as Error).message}`)
        skipped++
      }
    }

    if (imported > 0) {
      if (maybeActivateScheme(db, schemeId)) {
        await enqueuSync('chit_schemes', schemeId, 'UPDATE', { id: schemeId, status: 'active' })
      } else {
        await touchSchemeSync(db, schemeId)
      }
    }
    if (imported > 0) {
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (enrolledBranchId as string) || (scheme.branch_id as string) || null,
        action: 'CHIT_MEMBERS_BULK_IMPORTED', tableName: 'chit_members', recordId: schemeId,
        newValues: { imported, skipped },
      })
    }
    return { success: true, imported, skipped, errors: errors.slice(0, 50) }
  })

  // ── Draws ────────────────────────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:draws:eligible', (_e, schemeId: string, cycleNo: number) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const scheme = db.prepare('SELECT id, branch_id FROM chit_schemes WHERE id=?').get(schemeId) as { id: string; branch_id: unknown } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    return { success: true, data: eligibleMembersForDraw(db, schemeId, cycleNo) }
  })

  safeHandle(ipcMain, 'chits:draws:conduct', async (_e, schemeId: string, cycleNo: number, options: { method?: 'random' | 'manual_pick'; winnerMemberId?: string; reason?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

    const existingDraw = db.prepare('SELECT id FROM chit_draws WHERE scheme_id=? AND cycle_no=?').get(schemeId, cycleNo)
    if (existingDraw) return { success: false, error: `Cycle ${cycleNo} has already been drawn` }

    if (scheme.status === 'pending') {
      const enrolledNow = db.prepare(`SELECT COUNT(*) as c FROM chit_members WHERE scheme_id=? AND status != 'withdrawn'`).get(schemeId) as { c: number }
      const short = Math.max(0, Number(scheme.min_members) - enrolledNow.c)
      return { success: false, error: `Scheme is still pending — needs ${short} more member(s) before draws can start` }
    }
    // Allowlist (not a 'pending'-only denylist) so a cancelled/completed
    // scheme can never have a draw conducted against it either — previously
    // only 'pending' was rejected, leaving 'cancelled'/'completed' schemes
    // still drawable as long as an eligible member existed.
    if (scheme.status !== 'active') {
      return { success: false, error: `Cannot conduct a draw on a ${scheme.status} scheme` }
    }

    const isFinalCycle = cycleNo >= Number(scheme.cycle_count)
    const requestedMethod = options.method || 'random'
    // Manual override of who wins a real product is the single highest-trust
    // action in this module — restricted to Company/Super Admin (perms.all)
    // regardless of ordinary Smart Buy management access, and always
    // requires a substantive, recorded justification (SmartBuy fix audit,
    // HIGH-5). Final-cycle batch settlement always overrides the requested
    // method (every remaining member settles together), so it is exempt.
    if (!isFinalCycle && requestedMethod === 'manual_pick') {
      if (!perms.all) return { success: false, error: 'Only a Company Admin can manually select a Smart Buy winner' }
      const reason = String(options.reason || '').trim()
      if (reason.length < MANUAL_DRAW_MIN_REASON_LENGTH) {
        return { success: false, error: `A manual winner selection requires a reason of at least ${MANUAL_DRAW_MIN_REASON_LENGTH} characters` }
      }
    }

    // Single source of truth for who may be drawn — identical to the
    // read-only preview (chits:draws:eligible), so a member excluded there
    // (e.g. a rejected prior-cycle payment) can never be selected here
    // either (SmartBuy fix audit, HIGH-1).
    const eligible = eligibleMembersForDraw(db, schemeId, cycleNo)
    if (eligible.length === 0) return { success: false, error: 'No eligible members remain for this scheme' }

    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
    const drawId = crypto.randomUUID()
    let settledWinners: Record<string, unknown>[] = []

    db.transaction(() => {
      // Re-verified inside the transaction, not just in the pre-transaction
      // read above — the earlier existingDraw check is a plain SELECT with
      // no lock, so this is the actual guard against two near-simultaneous
      // draw attempts for the same cycle both passing it (mirrors the same
      // pattern already used in chits:members:recordRedemption). The
      // UNIQUE(scheme_id, cycle_no) constraint on chit_draws would catch a
      // genuine double-insert regardless, but only as a raw SQL error —
      // this turns that into the same friendly, expected error message.
      const stillUndrawn = db.prepare('SELECT id FROM chit_draws WHERE scheme_id=? AND cycle_no=?').get(schemeId, cycleNo)
      if (stillUndrawn) throw new Error(`Cycle ${cycleNo} has already been drawn`)

      let winners: Record<string, unknown>[]
      let method: string

      if (isFinalCycle) {
        // Final cycle: every remaining member receives their product together.
        winners = eligible
        method = 'final_batch'
      } else if (requestedMethod === 'manual_pick') {
        const winner = eligible.find(m => m.id === options.winnerMemberId)
        if (!winner) throw new Error('Selected member is not eligible for this draw')
        winners = [winner]
        method = 'manual_pick'
      } else {
        winners = [eligible[crypto.randomInt(eligible.length)]]
        method = 'random'
      }

      const drawRow = {
        id: drawId, scheme_id: schemeId, cycle_no: cycleNo,
        // Full date+time (not just the date) — Winner Selection Log needs a
        // precise timestamp, not just which day. Stored as ISO text; the
        // column accepts any string locally and is DATETIME on the cloud side.
        draw_date: new Date().toISOString(),
        winner_member_id: winners.length === 1 ? winners[0].id : null,
        settled_count: winners.length, eligible_count: eligible.length,
        method, conducted_by: caller.id || null, notes: options.reason || null,
      }
      db.prepare(`
        INSERT INTO chit_draws
          (id, scheme_id, cycle_no, draw_date, winner_member_id, settled_count, eligible_count, method, conducted_by, notes)
        VALUES (@id,@scheme_id,@cycle_no,@draw_date,@winner_member_id,@settled_count,@eligible_count,@method,@conducted_by,@notes)
      `).run(drawRow)
      enqueue.push({ table: 'chit_draws', id: drawId, row: drawRow, op: 'INSERT' })

      for (const winner of winners) {
        // Business rule (confirmed): a draw/final-cycle winner's remaining
        // balance is waived outright, not financed — this SmartBuy scheme
        // is a promotional lucky-draw, not a loan-financed pool, and the
        // business intentionally absorbs the gap between chit_value and
        // what the winner had contributed so far. No repayment schedule is
        // generated and installment_id stays null. This is deliberately
        // scoped to draw/final_batch winners only — early redemption
        // (chits:members:earlyRedeem) is a separate, explicitly-paid
        // mechanism and still finances its own remaining balance.
        // Product Redemption Policy — claim tracking starts the instant a
        // member wins, for BOTH a single-winner draw and every member
        // settled in a final_batch (same loop, same UPDATE — no separate
        // handling needed). The entitlement itself never expires; these
        // fields only drive the soft reminder system (chitClaimReminder
        // service) and are never used to block or revoke a claim.
        const claimDueDate = addDays(new Date().toISOString().slice(0, 10), smartBuySettings().claimReminderDays)
        const entitlementValue = money(Number(scheme.chit_value) || 0)
        db.prepare(`
          UPDATE chit_members
          SET redemption_type=?, won_cycle_no=?, product_received_at=date('now'),
              installment_id=NULL, status='redeemed',
              claim_status='pending_claim', claim_due_date=?, entitlement_value=?,
              updated_at=datetime('now')
          WHERE id=?
        `).run(isFinalCycle ? 'final_batch' : 'draw', cycleNo, claimDueDate, entitlementValue, winner.id)
        enqueue.push({
          table: 'chit_members', id: String(winner.id), op: 'UPDATE',
          row: {
            id: winner.id, redemption_type: isFinalCycle ? 'final_batch' : 'draw',
            won_cycle_no: cycleNo, product_received_at: new Date().toISOString().slice(0, 10),
            installment_id: null, status: 'redeemed',
            claim_status: 'pending_claim', claim_due_date: claimDueDate, entitlement_value: entitlementValue,
          },
        })
      }

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: isFinalCycle ? 'CHIT_FINAL_SETTLEMENT' : 'CHIT_DRAW_CONDUCTED',
        tableName: 'chit_draws', recordId: drawId,
        newValues: { cycleNo, winnerCount: winners.length, method, reason: options.reason || null, winnerMemberIds: winners.map(w => w.id) },
      })
      settledWinners = winners
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    // A draw can be the one that redeems the last remaining active member —
    // not only on a final-cycle call (an earlier cycle can also happen to
    // clear out everyone, e.g. after withdrawals shrank the pool). Checked
    // after every draw, not just isFinalCycle ones.
    if (maybeCompleteScheme(db, schemeId)) {
      await enqueuSync('chit_schemes', schemeId, 'UPDATE', { id: schemeId, status: 'completed' })
    } else {
      await touchSchemeSync(db, schemeId)
    }
    // Winner Selected / Product Ready notification — best-effort, never
    // blocks the draw result even if SMS/email/WhatsApp all fail.
    for (const winner of settledWinners) {
      await notifyWinnerSelected(db, winner as { customer_id: unknown }, scheme as { name: unknown; scheme_number: unknown; chit_value: unknown }).catch(() => {})
    }
    return { success: true, data: { drawId, isFinalCycle, settledCount: isFinalCycle ? eligible.length : 1 } }
  })

  safeHandle(ipcMain, 'chits:draws:list', (_e, schemeId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const scheme = db.prepare('SELECT id, branch_id FROM chit_schemes WHERE id=?').get(schemeId) as { id: string; branch_id: unknown } | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertSchemeAccess(db, perms, caller, scheme)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }
    const rows = db.prepare(`
      SELECT d.*,
        -- Same fix as chits:get's embedded draws — winner_member_id alone
        -- misses final_batch's multiple winners.
        (SELECT GROUP_CONCAT(c2.name, ', ') FROM chit_members m2
           JOIN customers c2 ON c2.id = m2.customer_id
           WHERE m2.scheme_id = d.scheme_id AND m2.won_cycle_no = d.cycle_no) as winner_name,
        u.name as conducted_by_name
      FROM chit_draws d
      LEFT JOIN users u ON u.id = d.conducted_by
      WHERE d.scheme_id = ?
      ORDER BY d.cycle_no
    `).all(schemeId)
    return { success: true, data: rows }
  })

  // ── Early redemption ────────────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:members:earlyRedeem', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!member.is_early_redemption) return { success: false, error: 'This member is not eligible for early redemption' }
    if (member.redemption_type) return { success: false, error: 'This member has already received their product' }
    if (member.status === 'withdrawn') return { success: false, error: 'This member has withdrawn from the scheme' }

    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>
    if (!assertMemberAccess(perms, caller, scheme as { branch_id: unknown }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    const scopedAgentId = resolveScopedAgentId(caller)
    if (scopedAgentId && member.agent_id !== scopedAgentId) {
      return { success: false, error: 'You do not have access to this member' }
    }
    if (scheme.status === 'pending') {
      return { success: false, error: 'Scheme is pending — cannot process redemptions until minimum members are reached' }
    }
    if (scheme.status !== 'active') {
      return { success: false, error: `Cannot process a redemption on a ${scheme.status} scheme` }
    }
    const amount = money(Number(payload.amount) || 0)
    if (amount <= 0) return { success: false, error: 'Enter a valid amount' }
    if (amount < Number(scheme.early_redemption_amount)) {
      return { success: false, error: `Early redemption requires at least Rs.${scheme.early_redemption_amount}` }
    }

    const contributionId = crypto.randomUUID()
    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []

    db.transaction(() => {
      const collectedByAgentId = scopedAgentId || (payload.collected_by_agent_id !== undefined
        ? (payload.collected_by_agent_id || null)
        : (member.agent_id || null))
      // Commission is no longer accrued here — it's computed once, at
      // chits:members:recordRedemption, against the actual product taken.
      const paidAt = payload.paid_at ? String(payload.paid_at) : new Date().toISOString()
      const contributionRow = {
        id: contributionId, scheme_id: member.scheme_id, member_id: memberId, cycle_no: null,
        contribution_type: 'early_redemption', amount, method: payload.method || 'cash',
        receipt_number: payload.receipt_number || null, reference: payload.reference || null,
        status: 'approved', received_by: caller.id || null, collected_by_agent_id: collectedByAgentId,
        branch_id: scheme.branch_id, commission_amount: 0, notes: payload.notes || null,
        paid_at: paidAt,
      }
      db.prepare(`
        INSERT INTO chit_contributions
          (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number,
           reference, status, received_by, collected_by_agent_id, branch_id, commission_amount, notes, paid_at)
        VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@receipt_number,
           @reference,@status,@received_by,@collected_by_agent_id,@branch_id,@commission_amount,@notes,@paid_at)
      `).run(contributionRow)
      enqueue.push({ table: 'chit_contributions', id: contributionId, row: contributionRow, op: 'INSERT' })

      const principalRemaining = money(Number(scheme.chit_value) - amount)
      const repayment = generateChitRepaymentSchedule(
        db, scheme, member, principalRemaining,
        `${scheme.scheme_number}-M${member.join_order}`
      )
      for (const item of repayment?.enqueue || []) enqueue.push({ ...item, op: 'INSERT' })

      db.prepare(`
        UPDATE chit_members
        SET redemption_type='early', product_received_at=date('now'), installment_id=?,
            contributions_paid=contributions_paid+?, status='redeemed', updated_at=datetime('now')
        WHERE id=?
      `).run(repayment?.installmentId || null, amount, memberId)
      enqueue.push({
        table: 'chit_members', id: memberId, op: 'UPDATE',
        row: {
          id: memberId, redemption_type: 'early', product_received_at: new Date().toISOString().slice(0, 10),
          installment_id: repayment?.installmentId || null,
          contributions_paid: money(Number(member.contributions_paid || 0) + amount), status: 'redeemed',
        },
      })

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: 'CHIT_EARLY_REDEMPTION', tableName: 'chit_members', recordId: memberId,
        newValues: { amount },
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    // Early redemption also sets status='redeemed' — it can be the event
    // that clears out the last remaining active member, same as a draw.
    if (maybeCompleteScheme(db, String(member.scheme_id))) {
      await enqueuSync('chit_schemes', String(member.scheme_id), 'UPDATE', { id: member.scheme_id, status: 'completed' })
    } else {
      await touchSchemeSync(db, String(member.scheme_id))
    }
    return { success: true, data: { contributionId } }
  })

  // ── Contributions (pre-delivery waiting-period payments) ────────────────
  safeHandle(ipcMain, 'chits:contributions:record', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>
    if (!assertMemberAccess(perms, caller, scheme as { branch_id: unknown }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    const scopedAgentId = resolveScopedAgentId(caller)
    if (scopedAgentId && member.agent_id !== scopedAgentId) {
      return { success: false, error: 'You do not have access to this member' }
    }
    // Once a member has won and their remaining balance is waived (see
    // chits:draws:conduct), there is nothing left to collect — a redeemed
    // member should never appear in future cycle-contribution collection.
    if (member.status === 'redeemed') {
      return { success: false, error: 'This member has already received their product — no further contributions are due' }
    }
    if (member.status === 'withdrawn') {
      return { success: false, error: 'This member has withdrawn from the scheme — no further contributions can be recorded' }
    }
    if (scheme.status !== 'active' && scheme.status !== 'pending') {
      return { success: false, error: `Cannot collect a payment on a ${scheme.status} scheme` }
    }
    if (scheme.status === 'pending') {
      const priorCount = db.prepare(`SELECT COUNT(*) as c FROM chit_contributions WHERE member_id=? AND status='approved'`).get(memberId) as { c: number }
      if (priorCount.c === 0) {
        return { success: false, error: 'Scheme is pending — cannot collect the first installment until minimum members are reached' }
      }
    }

    // Business rule (confirmed, flexible contribution handling): a member
    // may pay a cycle off in multiple installments, overpay (the excess
    // carries forward as credit toward a future cycle), or underpay and
    // draw down previously-banked credit to close the gap. What's still
    // blocked is a genuine DUPLICATE — a new contribution attempt once the
    // cycle's balance is already fully settled. Scoped by schemeId as well
    // as memberId/cycleNo since the same customer can be enrolled in
    // multiple SmartBuy schemes at once and owes a separate payment in
    // each. A contribution with no cycle_no (e.g. registerHistorical's
    // backdated initial payment) is never subject to this check — it isn't
    // claiming to be "for" any specific cycle.
    const cycleNo = payload.cycle_no !== undefined && payload.cycle_no !== null && payload.cycle_no !== ''
      ? Number(payload.cycle_no) : null
    let balanceBefore: { expectedAmount: number; paidAmount: number; creditUsed: number; balanceDue: number } | null = null
    if (cycleNo !== null) {
      balanceBefore = computeMemberCycleBalance(db, memberId, String(member.scheme_id), cycleNo, Number(scheme.contribution_amount) || 0)
      if (balanceBefore.balanceDue <= 0.01) {
        return { success: false, error: `Cycle ${cycleNo} (Rs.${balanceBefore.expectedAmount}) is already fully paid — no further contribution is needed. If a payment was entered incorrectly, edit, cancel, or reverse the existing entry instead of recording another.` }
      }
    }

    let amount = money(Number(payload.amount) || 0)
    if (amount <= 0) return { success: false, error: 'Enter a valid amount' }
    const method = String(payload.method || 'cash')
    const status = method === 'bank_transfer' ? 'pending_verification' : 'approved'
    const contributionId = crypto.randomUUID()
    // Who physically collected the cash from the customer — defaults to the
    // member's own assigned agent, but can be overridden (a different agent
    // covering the visit). Distinct from received_by, the office user keying it in.
    // An Agent session always collects under their own id.
    const collectedByAgentId = scopedAgentId || (payload.collected_by_agent_id !== undefined
      ? (payload.collected_by_agent_id || null)
      : (member.agent_id || null))
    // Backdatable for paper-record entry — defaults to now when omitted.
    const paidAt = payload.paid_at ? String(payload.paid_at) : new Date().toISOString()

    // Late Fee (Admin Configuration Module) — a scheme with late_payment_days
    // set treats that as the grace period (day-of-month); a cycle
    // contribution recorded past it gets the scheme's flat late_fee_amount
    // added on top, automatically, no manual entry needed. Counted toward
    // this cycle's paid/credit math same as the base amount — see
    // computeMemberCycleBalance's comment for the known, accepted
    // trade-off (a late fee can end up contributing toward carried-forward
    // credit rather than being purely punitive).
    let lateFeeApplied = 0
    if (Number(scheme.late_payment_days) > 0 && Number(scheme.late_fee_amount) > 0) {
      const dayOfMonth = new Date(paidAt).getDate()
      if (dayOfMonth > Number(scheme.late_payment_days)) {
        lateFeeApplied = money(Number(scheme.late_fee_amount))
        amount = money(amount + lateFeeApplied)
      }
    }

    // Auto credit-application (only ever for an immediately-approved
    // payment against a real cycle — a bank-transfer submission sitting at
    // pending_verification hasn't happened yet as far as the ledger is
    // concerned, so its credit application is decided later, at
    // chits:contributions:verify, against balances as they stand then).
    let creditApplied = 0
    let creditBalanceAfter = Number(member.credit_balance) || 0
    let cycleStatusAfter: { paidAmount: number; creditUsed: number; balanceDue: number } | null = null
    if (status === 'approved' && balanceBefore) {
      const shortfallAfterCash = money(Math.max(0, balanceBefore.balanceDue - amount))
      creditApplied = shortfallAfterCash > 0 ? money(Math.min(creditBalanceAfter, shortfallAfterCash)) : 0
      const newPaidTotal = money(balanceBefore.paidAmount + amount)
      const newCreditUsedTotal = money(balanceBefore.creditUsed + creditApplied)
      const overshoot = money(Math.max(0, (newPaidTotal + newCreditUsedTotal) - balanceBefore.expectedAmount))
      creditBalanceAfter = money(creditBalanceAfter - creditApplied + overshoot)
      cycleStatusAfter = {
        paidAmount: newPaidTotal, creditUsed: newCreditUsedTotal,
        balanceDue: money(Math.max(0, balanceBefore.expectedAmount - newPaidTotal - newCreditUsedTotal)),
      }
    }

    const row: Record<string, unknown> = {
      id: contributionId, scheme_id: member.scheme_id, member_id: memberId,
      cycle_no: cycleNo, contribution_type: 'cycle', amount, method, credit_applied: creditApplied,
      receipt_number: payload.receipt_number || null, reference: payload.reference || null,
      status, received_by: caller.id || null, collected_by_agent_id: collectedByAgentId,
      branch_id: scheme.branch_id,
      commission_amount: 0,
      notes: lateFeeApplied > 0
        ? `${payload.notes ? `${payload.notes} — ` : ''}Includes Rs.${lateFeeApplied} late fee`
        : (payload.notes || null),
      paid_at: paidAt,
    }
    db.transaction(() => {
      // Commission is no longer accrued here — it's computed once, at
      // chits:members:recordRedemption, against the actual product taken.
      db.prepare(`
        INSERT INTO chit_contributions
          (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, credit_applied, receipt_number,
           reference, status, received_by, collected_by_agent_id, branch_id, commission_amount, notes, paid_at)
        VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@credit_applied,@receipt_number,
           @reference,@status,@received_by,@collected_by_agent_id,@branch_id,@commission_amount,@notes,@paid_at)
      `).run(row)
      if (status === 'approved') {
        db.prepare(`
          UPDATE chit_members SET contributions_paid=contributions_paid+?, credit_balance=?, updated_at=datetime('now') WHERE id=?
        `).run(amount, creditBalanceAfter, memberId)
      }
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: 'CHIT_CONTRIBUTION', tableName: 'chit_contributions', recordId: contributionId,
        newValues: { amount, method, cycleNo, creditApplied },
      })
    })()

    await enqueuSync('chit_contributions', contributionId, 'INSERT', row)
    if (status === 'approved') {
      await enqueuSync('chit_members', memberId, 'UPDATE', {
        id: memberId, contributions_paid: money(Number(member.contributions_paid || 0) + amount), credit_balance: creditBalanceAfter,
      })
    }
    await touchSchemeSync(db, String(member.scheme_id))
    return {
      success: true,
      data: {
        id: contributionId, status, amount, lateFeeApplied, creditApplied,
        ...(cycleStatusAfter ? {
          expectedAmount: balanceBefore!.expectedAmount, paidAmount: cycleStatusAfter.paidAmount,
          creditUsed: cycleStatusAfter.creditUsed, balanceDue: cycleStatusAfter.balanceDue,
          cycleStatus: cycleStatusAfter.balanceDue <= 0.01 ? 'completed' : 'partial',
          creditBalance: creditBalanceAfter,
        } : {}),
      },
    }
  })

  safeHandle(ipcMain, 'chits:contributions:verify', async (_e, contributionId: string, action: 'approve' | 'reject', notes?: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const contribution = db.prepare('SELECT * FROM chit_contributions WHERE id=?').get(contributionId) as Record<string, unknown> | undefined
    if (!contribution) return { success: false, error: 'Contribution not found' }
    if (!assertBranchScope(perms, caller, contribution.branch_id)) {
      return { success: false, error: 'You do not have access to this contribution' }
    }
    // Verify only ever applies to a bank-transfer contribution still awaiting
    // approval — without this guard, approving twice double-writes the
    // commission ledger and double-counts chit_members.contributions_paid,
    // and rejecting an already-approved contribution leaves both of those
    // stale (never reversed). There is no reversal/correction flow for an
    // already-approved contribution anywhere in the app, so both actions are
    // scoped to the one state "verify" is actually meant for.
    if (contribution.status !== 'pending_verification') {
      return { success: false, error: `This contribution is already ${contribution.status} — nothing to verify` }
    }
    let newContributionsPaid: number | null = null

    let creditApplied = 0
    let creditBalanceAfter: number | null = null

    if (action === 'reject') {
      db.prepare(`UPDATE chit_contributions SET status='rejected', verified_by=?, verified_at=datetime('now'), rejected_reason=?, updated_at=datetime('now') WHERE id=?`)
        .run(caller.id || null, notes || null, contributionId)
    } else {
      // The money has already been collected by this point (a real bank
      // transfer already happened) — unlike chits:contributions:record,
      // which can refuse a brand-new submission before anything is
      // committed, approving a pending payment never hard-blocks just
      // because the cycle looks already settled. It's processed through
      // the same credit/balance algorithm and any excess becomes credit,
      // same as a same-transaction overpayment would (flexible
      // contribution handling — supersedes the old "reject a conflicting
      // approved entry" guard here, which would have refused to properly
      // record real, already-collected funds).
      const member = db.prepare('SELECT id, agent_id, contributions_paid, credit_balance FROM chit_members WHERE id=?').get(contribution.member_id) as { id: string; agent_id?: unknown; contributions_paid?: number; credit_balance?: number } | undefined
      creditBalanceAfter = Number(member?.credit_balance) || 0
      if (contribution.cycle_no !== null && contribution.cycle_no !== undefined) {
        const scheme = db.prepare('SELECT contribution_amount FROM chit_schemes WHERE id=?').get(contribution.scheme_id) as { contribution_amount: number } | undefined
        const balanceBefore = computeMemberCycleBalance(db, String(contribution.member_id), String(contribution.scheme_id), Number(contribution.cycle_no), Number(scheme?.contribution_amount) || 0)
        const amount = Number(contribution.amount) || 0
        const shortfallAfterCash = money(Math.max(0, balanceBefore.balanceDue - amount))
        creditApplied = shortfallAfterCash > 0 ? money(Math.min(creditBalanceAfter, shortfallAfterCash)) : 0
        const newPaidTotal = money(balanceBefore.paidAmount + amount)
        const newCreditUsedTotal = money(balanceBefore.creditUsed + creditApplied)
        const overshoot = money(Math.max(0, (newPaidTotal + newCreditUsedTotal) - balanceBefore.expectedAmount))
        creditBalanceAfter = money(creditBalanceAfter - creditApplied + overshoot)
      }
      db.transaction(() => {
        // Commission is no longer accrued here — it's computed once, at
        // chits:members:recordRedemption, against the actual product taken.
        db.prepare(`UPDATE chit_contributions SET status='approved', credit_applied=?, verified_by=?, verified_at=datetime('now'), updated_at=datetime('now') WHERE id=?`)
          .run(creditApplied, caller.id || null, contributionId)
        db.prepare(`UPDATE chit_members SET contributions_paid=contributions_paid+?, credit_balance=?, updated_at=datetime('now') WHERE id=?`)
          .run(Number(contribution.amount), creditBalanceAfter, contribution.member_id)
        newContributionsPaid = money(Number(member?.contributions_paid || 0) + (Number(contribution.amount) || 0))
      })()
    }

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (contribution.branch_id as string) || null,
      action: action === 'approve' ? 'CHIT_CONTRIBUTION_APPROVED' : 'CHIT_CONTRIBUTION_REJECTED',
      tableName: 'chit_contributions', recordId: contributionId, newValues: { notes, creditApplied },
    })
    await enqueuSync('chit_contributions', contributionId, 'UPDATE', {
      id: contributionId, status: action === 'approve' ? 'approved' : 'rejected',
      verified_by: caller.id || null, rejected_reason: notes || null, credit_applied: creditApplied,
    })
    if (action === 'approve') {
      // Must include an actual changed field — the backend's partial-UPDATE
      // path is a no-op when the payload is just { id }, so an id-only
      // enqueue here would silently never push the contributions_paid
      // increment to the cloud at all.
      await enqueuSync('chit_members', String(contribution.member_id), 'UPDATE', {
        id: contribution.member_id, contributions_paid: newContributionsPaid, credit_balance: creditBalanceAfter,
      })
    }
    await touchSchemeSync(db, String(contribution.scheme_id))
    return { success: true, data: { creditApplied, creditBalance: creditBalanceAfter } }
  })

  safeHandle(ipcMain, 'chits:contributions:pendingTransfers', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branch_id)
    const conditions = [`cc.status = 'pending_verification'`]
    const params: unknown[] = []
    if (filters.scheme_id) { conditions.push('cc.scheme_id = ?'); params.push(filters.scheme_id) }
    if (branchId) { conditions.push('cc.branch_id = ?'); params.push(branchId) }
    const rows = db.prepare(`
      SELECT cc.*, cs.name as scheme_name, c.name as customer_name
      FROM chit_contributions cc
      LEFT JOIN chit_schemes cs ON cs.id = cc.scheme_id
      LEFT JOIN chit_members m ON m.id = cc.member_id
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY cc.paid_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Reports ──────────────────────────────────────────────────────────────
  // ── Reports: Scheme Summary (also covers Pending/Active/Completed/
  // Cancelled Scheme Report via the status filter) ─────────────────────────
  safeHandle(ipcMain, 'chits:reports', (_e, filters: { schemeId?: string; branchId?: string; status?: string; dateFrom?: string; dateTo?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (filters.schemeId) { conditions.push('cs.id = ?'); params.push(filters.schemeId) }
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    if (filters.status) { conditions.push('cs.status = ?'); params.push(filters.status) }
    if (filters.dateFrom) { conditions.push('date(cs.created_at) >= date(?)'); params.push(filters.dateFrom) }
    if (filters.dateTo) { conditions.push('date(cs.created_at) <= date(?)'); params.push(filters.dateTo) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT cs.id, cs.scheme_number, cs.name, cs.member_count, cs.min_members, cs.cycle_count, cs.chit_value, cs.status,
        b.name as branch_name, a.name as agent_name,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status = 'redeemed') as members_redeemed,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status = 'withdrawn') as members_withdrawn,
        (SELECT COALESCE(SUM(refund_amount),0) FROM withdrawal_requests w WHERE w.scheme_id = cs.id AND w.status = 'approved') as withdrawal_refunds_total,
        (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_completed,
        (SELECT COALESCE(SUM(amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as contributions_collected,
        (SELECT COALESCE(SUM(total_commission),0) FROM commission_ledger cl WHERE cl.scheme_id = cs.id) as commission_accrued,
        cs.next_draw_date, cs.created_at
      FROM chit_schemes cs
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN agents a ON a.id = cs.agent_id
      ${where}
      ORDER BY cs.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Reports: Scheme Members (cross-scheme; covers "Pending Members" via
  // schemeStatus='pending', or member-level status filter) ─────────────────
  safeHandle(ipcMain, 'chits:reports:members', (_e, filters: {
    branchId?: string; schemeId?: string; status?: string; schemeStatus?: string
  } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    if (filters.schemeId) { conditions.push('m.scheme_id = ?'); params.push(filters.schemeId) }
    if (filters.status) { conditions.push('m.status = ?'); params.push(filters.status) }
    if (filters.schemeStatus) { conditions.push('cs.status = ?'); params.push(filters.schemeStatus) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT m.join_order, m.status, m.is_early_redemption, m.contributions_paid, m.won_cycle_no,
        m.redeemed_product_name, m.redeemed_qty, m.redeemed_value, m.created_at,
        c.name as customer_name, c.phone as customer_phone, c.nic as customer_nic,
        cs.name as scheme_name, cs.scheme_number, cs.status as scheme_status, cs.chit_value,
        b.name as branch_name, ma.name as agent_name, ma.code as agent_code
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      ${where}
      ORDER BY cs.name, m.join_order
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Reports: Payment Collection (cross-scheme approved contributions) ────
  safeHandle(ipcMain, 'chits:reports:contributions', (_e, filters: {
    branchId?: string; schemeId?: string; agentId?: string; status?: string; dateFrom?: string; dateTo?: string
  } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cc.branch_id = ?'); params.push(branchId) }
    if (filters.schemeId) { conditions.push('cc.scheme_id = ?'); params.push(filters.schemeId) }
    if (filters.agentId) { conditions.push('cc.collected_by_agent_id = ?'); params.push(filters.agentId) }
    conditions.push('cc.status = ?')
    params.push(filters.status || 'approved')
    if (filters.dateFrom) { conditions.push('date(cc.paid_at) >= date(?)'); params.push(filters.dateFrom) }
    if (filters.dateTo) { conditions.push('date(cc.paid_at) <= date(?)'); params.push(filters.dateTo) }
    const where = `WHERE ${conditions.join(' AND ')}`

    const rows = db.prepare(`
      SELECT cc.paid_at, cc.amount, cc.method, cc.contribution_type, cc.receipt_number, cc.status,
        cc.commission_amount, cs.name as scheme_name, cs.scheme_number,
        cust.name as customer_name, a.name as agent_name, a.code as agent_code, b.name as branch_name
      FROM chit_contributions cc
      JOIN chit_schemes cs ON cs.id = cc.scheme_id
      LEFT JOIN chit_members m ON m.id = cc.member_id
      LEFT JOIN customers cust ON cust.id = m.customer_id
      LEFT JOIN agents a ON a.id = cc.collected_by_agent_id
      LEFT JOIN branches b ON b.id = cc.branch_id
      ${where}
      ORDER BY cc.paid_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Reports: Winner / Winner Product Report (cross-scheme draws) ─────────
  safeHandle(ipcMain, 'chits:reports:winners', (_e, filters: { branchId?: string; schemeId?: string; dateFrom?: string; dateTo?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    if (filters.schemeId) { conditions.push('d.scheme_id = ?'); params.push(filters.schemeId) }
    if (filters.dateFrom) { conditions.push('date(d.draw_date) >= date(?)'); params.push(filters.dateFrom) }
    if (filters.dateTo) { conditions.push('date(d.draw_date) <= date(?)'); params.push(filters.dateTo) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    // One row per WINNING MEMBER, not per draw event — a final_batch draw
    // settles multiple members together, each with their own product/
    // value/invoice (potentially different from each other), which a
    // single row keyed off chit_draws.winner_member_id (only ever set for
    // a single-winner draw) cannot represent at all. Matches on
    // (scheme_id, won_cycle_no) instead, so both single-winner and
    // final_batch draws produce one accurate row per winner.
    const rows = db.prepare(`
      SELECT d.cycle_no, d.draw_date, d.method, d.settled_count, d.eligible_count, d.notes as reason,
        cs.name as scheme_name, cs.scheme_number, b.name as branch_name,
        c.name as winner_name, wm.redeemed_product_name, wm.redeemed_qty, wm.redeemed_value,
        ri.invoice_number as redemption_invoice_number, u.name as conducted_by_name,
        wm.claim_status, wm.claim_due_date, wm.claimed_at,
        op.name as original_product_name, wm.entitlement_value, wm.upgrade_amount, wm.wallet_credit_created,
        wm.substitution_flag, wm.substitution_reason,
        tc.name as transferred_to_name
      FROM chit_members wm
      JOIN chit_schemes cs ON cs.id = wm.scheme_id
      JOIN chit_draws d ON d.scheme_id = wm.scheme_id AND d.cycle_no = wm.won_cycle_no
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN customers c ON c.id = wm.customer_id
      LEFT JOIN invoices ri ON ri.id = wm.redemption_invoice_id
      LEFT JOIN users u ON u.id = d.conducted_by
      LEFT JOIN products op ON op.id = cs.product_id
      LEFT JOIN customers tc ON tc.id = wm.transferred_customer_id
      ${where}
      ${where ? 'AND' : 'WHERE'} wm.redemption_type IN ('draw', 'final_batch')
      ORDER BY d.draw_date DESC, wm.join_order
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Reports: Branch Performance ───────────────────────────────────────────
  safeHandle(ipcMain, 'chits:reports:branchPerformance', (_e) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, undefined)
    const where = branchId ? 'WHERE b.id = ?' : ''
    const params = branchId ? [branchId] : []

    const rows = db.prepare(`
      SELECT b.id as branch_id, b.name as branch_name, mgr.name as manager_name,
        (SELECT COUNT(*) FROM chit_schemes cs WHERE cs.branch_id = b.id) as scheme_count,
        (SELECT COUNT(*) FROM chit_schemes cs WHERE cs.branch_id = b.id AND cs.status = 'active') as active_scheme_count,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          WHERE cs.branch_id = b.id AND m.status != 'withdrawn') as members_enrolled,
        (SELECT COUNT(DISTINCT m.customer_id) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          WHERE cs.branch_id = b.id AND m.status != 'withdrawn') as customers,
        (SELECT COALESCE(SUM(cc.amount),0) FROM chit_contributions cc WHERE cc.branch_id = b.id AND cc.status = 'approved') as contributions_collected,
        (SELECT COALESCE(SUM(cl.total_commission),0) FROM commission_ledger cl WHERE cl.branch_id = b.id) as commission_accrued,
        (SELECT COUNT(*) FROM chit_draws d JOIN chit_schemes cs ON cs.id = d.scheme_id WHERE cs.branch_id = b.id) as draws_conducted
      FROM branches b
      LEFT JOIN users mgr ON mgr.id = b.smartbuy_manager_id
      ${where}
      ORDER BY contributions_collected DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // Customers who are enrolled in at least one Chit Fund scheme — a
  // dedicated view distinct from the general customer list, since these
  // customers need scheme/product/agent context that plain "customers"
  // doesn't carry. One row per customer (not per membership); a customer
  // in multiple schemes shows an aggregate scheme count plus a combined
  // list of scheme names/agents for quick scanning.
  safeHandle(ipcMain, 'chits:customers:list', (_e, filters: { search?: string; branchId?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    if (filters.search) {
      conditions.push('(c.name LIKE ? OR c.phone LIKE ? OR c.nic LIKE ?)')
      params.push(`%${filters.search}%`, `%${filters.search}%`, `%${filters.search}%`)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT c.id, c.name, c.phone, c.email, c.nic, c.address, c.outstanding_due, c.loyalty_points,
        COUNT(DISTINCT m.id) as scheme_count,
        COALESCE(SUM(m.contributions_paid), 0) as total_contributions_paid,
        -- Concatenated on scheme_number (unique per branch instance), not
        -- bare name — the Scheme Master (centralized scheme templates)
        -- deliberately lets multiple branches share an identical scheme
        -- name, so DISTINCT on name alone would silently collapse a
        -- customer's two separate memberships (e.g. Branch A's and Branch
        -- B's "SmartBuy 5000 Plan") into a single displayed entry.
        GROUP_CONCAT(DISTINCT cs.scheme_number || ' - ' || cs.name) as scheme_names,
        GROUP_CONCAT(DISTINCT COALESCE(ma.name, sa.name)) as agent_names,
        GROUP_CONCAT(DISTINCT b.name) as branch_names,
        GROUP_CONCAT(DISTINCT p.name) as product_names
      FROM customers c
      JOIN chit_members m ON m.customer_id = c.id
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN products p ON p.id = cs.product_id
      LEFT JOIN agents sa ON sa.id = cs.agent_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      ${where}
      GROUP BY c.id
      ORDER BY c.name
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Smart Buy Agents: chit-specific stats per agent ─────────────────────
  // Unlike agents:report/reportAllSummary (POS-invoice-only), this aggregates
  // chit_members/chit_contributions — the numbers the Smart Buy agent view
  // actually needs (members assigned, cash collected, commission earned).
  safeHandle(ipcMain, 'chits:agents:report', (_e, filters: { branchId?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const scopedAgentId = resolveScopedAgentId(caller)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('a.branch_id = ?'); params.push(branchId) }
    // An Agent session can only ever see their own report row.
    if (scopedAgentId) { conditions.push('a.id = ?'); params.push(scopedAgentId) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT a.id, a.code, a.name, a.phone, a.branch_id, a.default_commission_pct, a.monthly_target, a.status,
        b.name as branch_name,
        (SELECT COUNT(*) FROM chit_members m WHERE m.agent_id = a.id AND m.status != 'withdrawn') as members_assigned,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = a.id AND cc.status = 'approved') as total_collected,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = a.id AND cc.status = 'approved'
            AND strftime('%Y-%m', cc.paid_at) = strftime('%Y-%m', 'now')) as collected_this_month,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = a.id THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = a.id THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = a.id OR cl.sales_agent_id = a.id)
            AND cl.status NOT IN ('rejected', 'cancelled')) as commission_earned,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = a.id THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = a.id THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = a.id OR cl.sales_agent_id = a.id) AND cl.status = 'pending') as commission_pending,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = a.id THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = a.id THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = a.id OR cl.sales_agent_id = a.id) AND cl.status = 'paid') as commission_paid,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = a.id AND cc.status = 'approved' AND cc.method = 'cash') as total_cash_collected,
        (SELECT COALESCE(SUM(r.amount), 0) FROM agent_remittances r WHERE r.agent_id = a.id) as total_remitted
      FROM agents a
      LEFT JOIN branches b ON b.id = a.branch_id
      ${where}
      ORDER BY a.name
    `).all(...params) as Record<string, unknown>[]
    // Cash-in-hand balance = cash collected minus what's been handed to the office.
    for (const r of rows) r.cash_balance = money(Number(r.total_cash_collected || 0) - Number(r.total_remitted || 0))
    return { success: true, data: rows }
  })

  // One agent's full monitoring view: every member assigned to them (with
  // their contribution totals) plus the agent's own aggregate stats — the
  // "A to Z activity" view for a single agent.
  safeHandle(ipcMain, 'chits:agents:detail', (_e, agentId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const agent = db.prepare(`
      SELECT a.*, b.name as branch_name, u.name as linked_user_name, u.email as linked_user_email
      FROM agents a
      LEFT JOIN branches b ON b.id = a.branch_id
      LEFT JOIN users u ON u.id = a.user_id
      WHERE a.id = ?
    `).get(agentId) as Record<string, unknown> | undefined
    if (!agent) return { success: false, error: 'Agent not found' }
    if (!assertBranchScope(perms, caller, agent.branch_id)) {
      return { success: false, error: 'You do not have access to this agent' }
    }
    const scopedAgentId = resolveScopedAgentId(caller)
    if (scopedAgentId && scopedAgentId !== agentId) {
      return { success: false, error: 'You do not have access to this agent' }
    }

    const members = db.prepare(`
      SELECT m.id, m.scheme_id, m.customer_id, m.join_order, m.status, m.contributions_paid,
        m.redemption_type, m.won_cycle_no, m.redeemed_product_name, m.redeemed_qty, m.redeemed_value,
        c.name as customer_name, c.phone as customer_phone,
        cs.name as scheme_name, cs.scheme_number, cs.chit_value
      FROM chit_members m
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN chit_schemes cs ON cs.id = m.scheme_id
      WHERE m.agent_id = ?
      ORDER BY cs.name, m.join_order
    `).all(agentId)

    const stats = db.prepare(`
      SELECT
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = ? AND cc.status = 'approved') as total_collected,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = ? THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = ? THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = ? OR cl.sales_agent_id = ?)
            AND cl.status NOT IN ('rejected', 'cancelled')) as commission_earned,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = ? THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = ? THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = ? OR cl.sales_agent_id = ?) AND cl.status = 'pending') as commission_pending,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = ? AND cc.status = 'approved' AND cc.method = 'cash') as total_cash_collected,
        (SELECT COALESCE(SUM(r.amount), 0) FROM agent_remittances r WHERE r.agent_id = ?) as total_remitted
    `).get(agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId, agentId) as Record<string, unknown>

    stats.cash_balance = money(Number(stats.total_cash_collected || 0) - Number(stats.total_remitted || 0))

    const remittances = db.prepare(`
      SELECT r.*, u.name as received_by_name FROM agent_remittances r
      LEFT JOIN users u ON u.id = r.received_by
      WHERE r.agent_id = ? ORDER BY r.submitted_at DESC
    `).all(agentId)

    // Full commission breakdown — every ledger line this agent earned any
    // part of, whichever role (registration/sales/bonus).
    const commissionLedger = db.prepare(`
      SELECT cl.*, cs.name as scheme_name, cs.scheme_number, r.name as rule_name
      FROM commission_ledger cl
      LEFT JOIN chit_schemes cs ON cs.id = cl.scheme_id
      LEFT JOIN commission_rules r ON r.id = cl.rule_id
      WHERE cl.registration_agent_id = ? OR cl.sales_agent_id = ?
      ORDER BY cl.created_at DESC
    `).all(agentId, agentId)

    return { success: true, data: { agent, members, stats, remittances, commissionLedger } }
  })

  // Every individual contribution row for one member — the payment history
  // ledger (date/amount/method/receipt/who collected/who recorded).
  safeHandle(ipcMain, 'chits:members:contributionHistory', (_e, memberId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const member = db.prepare(`
      SELECT m.id, m.enrolled_branch_id, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id = ?
    `).get(memberId) as { id: string; enrolled_branch_id: unknown; branch_id: unknown } | undefined
    if (!member) return { success: false, error: 'Member not found' }
    // Payment history is a member-level read — a collaborating branch that
    // legitimately manages its own recruit (enroll/collect/redeem, all
    // assertMemberAccess-gated) needs to see that same member's own history
    // too; assertBranchScope (home-branch-only) would wrongly deny it.
    if (!assertMemberAccess(perms, caller, { branch_id: member.branch_id }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }

    const rows = db.prepare(`
      SELECT cc.*, ag.name as collected_by_agent_name, ag.code as collected_by_agent_code,
        u.name as received_by_name
      FROM chit_contributions cc
      LEFT JOIN agents ag ON ag.id = cc.collected_by_agent_id
      LEFT JOIN users u ON u.id = cc.received_by
      WHERE cc.member_id = ?
      ORDER BY cc.paid_at DESC
    `).all(memberId)
    return { success: true, data: rows }
  })

  // ── Member contribution statement (flexible contribution handling) ──────
  // Full month-by-month breakdown for one member: expected/paid/credit-
  // used/balance-due per cycle plus the member's current carry-forward
  // credit and raw payment history. Every per-cycle number is read back
  // from the same computeMemberCycleBalance() that draw eligibility and
  // contribution recording use, so the statement can never disagree with
  // what actually determines eligibility or blocks a duplicate payment.
  // A distinct, new endpoint rather than folding this into
  // chits:members:contributionHistory (whose flat-array response shape is
  // already relied on by MemberPaymentHistoryModal) — additive, not a
  // breaking change to an existing consumer.
  safeHandle(ipcMain, 'chits:members:contributionStatement', (_e, memberId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const member = db.prepare(`
      SELECT m.*, cs.branch_id, cs.name as scheme_name, cs.scheme_number, cs.contribution_amount, cs.cycle_count,
        c.name as customer_name, c.phone as customer_phone
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.id = ?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertMemberAccess(perms, caller, { branch_id: member.branch_id }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }

    const expectedAmount = Number(member.contribution_amount) || 0
    const cycleCount = Math.max(0, Number(member.cycle_count) || 0)
    const cycles: Array<{
      cycleNo: number; expectedAmount: number; paidAmount: number; creditUsed: number
      balanceDue: number; status: 'completed' | 'partial' | 'pending'
    }> = []
    for (let cycleNo = 1; cycleNo <= cycleCount; cycleNo++) {
      const balance = computeMemberCycleBalance(db, memberId, String(member.scheme_id), cycleNo, expectedAmount)
      const hasActivity = balance.paidAmount > 0 || balance.creditUsed > 0
      cycles.push({
        cycleNo, expectedAmount: balance.expectedAmount, paidAmount: balance.paidAmount,
        creditUsed: balance.creditUsed, balanceDue: balance.balanceDue,
        status: balance.balanceDue <= 0.01 && hasActivity ? 'completed' : hasActivity ? 'partial' : 'pending',
      })
    }

    const paymentHistory = db.prepare(`
      SELECT cc.*, ag.name as collected_by_agent_name, ag.code as collected_by_agent_code,
        u.name as received_by_name
      FROM chit_contributions cc
      LEFT JOIN agents ag ON ag.id = cc.collected_by_agent_id
      LEFT JOIN users u ON u.id = cc.received_by
      WHERE cc.member_id = ?
      ORDER BY cc.paid_at DESC
    `).all(memberId)

    return {
      success: true,
      data: {
        member: {
          id: member.id, customerName: member.customer_name, customerPhone: member.customer_phone,
          schemeName: member.scheme_name, schemeNumber: member.scheme_number, status: member.status,
        },
        creditBalance: money(Number(member.credit_balance) || 0),
        cycles,
        paymentHistory,
      },
    }
  })

  // ── Agent cash remittance / settlement ──────────────────────────────────
  safeHandle(ipcMain, 'chits:remittances:record', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const scopedAgentId = resolveScopedAgentId(caller)
    // An Agent session can only remit against their own record.
    const agentId = scopedAgentId || String(payload.agent_id || '')
    const agent = db.prepare('SELECT id, branch_id FROM agents WHERE id=?').get(agentId) as { id: string; branch_id: unknown } | undefined
    if (!agent) return { success: false, error: 'Agent not found' }
    if (!assertBranchScope(perms, caller, agent.branch_id)) {
      return { success: false, error: 'You do not have access to this agent' }
    }
    const amount = money(Number(payload.amount) || 0)
    if (amount <= 0) return { success: false, error: 'Enter a valid amount' }

    const id = crypto.randomUUID()
    const row = {
      id, agent_id: agentId, branch_id: agent.branch_id,
      amount, method: String(payload.method || 'cash'),
      bank_reference: payload.bank_reference || null,
      submitted_at: payload.submitted_at ? String(payload.submitted_at) : new Date().toISOString(),
      received_by: caller.id || null, notes: payload.notes || null,
    }
    db.prepare(`
      INSERT INTO agent_remittances (id, agent_id, branch_id, amount, method, bank_reference, submitted_at, received_by, notes)
      VALUES (@id,@agent_id,@branch_id,@amount,@method,@bank_reference,@submitted_at,@received_by,@notes)
    `).run(row)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (agent.branch_id as string) || null,
      action: 'AGENT_REMITTANCE_RECORDED', tableName: 'agent_remittances', recordId: id,
      newValues: { agentId, amount },
    })
    await enqueuSync('agent_remittances', id, 'INSERT', row)
    return { success: true, data: { id } }
  })

  safeHandle(ipcMain, 'chits:remittances:list', (_e, filters: { agentId?: string; branchId?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const scopedAgentId = resolveScopedAgentId(caller)
    const conditions: string[] = []
    const params: unknown[] = []
    // An Agent session only ever sees their own remittances, ignoring any
    // client-supplied agentId filter.
    if (scopedAgentId) { conditions.push('r.agent_id = ?'); params.push(scopedAgentId) }
    else if (filters.agentId) { conditions.push('r.agent_id = ?'); params.push(filters.agentId) }
    if (branchId) { conditions.push('r.branch_id = ?'); params.push(branchId) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT r.*, a.name as agent_name, a.code as agent_code, u.name as received_by_name
      FROM agent_remittances r
      LEFT JOIN agents a ON a.id = r.agent_id
      LEFT JOIN users u ON u.id = r.received_by
      ${where}
      ORDER BY r.submitted_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Redemption: which product a winner actually chose ───────────────────
  // The scheme has one default product_id, but a winner isn't forced to it —
  // record what they actually picked (qty/value), denormalized so it survives
  // the product being renamed/removed later.
  // Records which product a winner actually took — and, unlike the pure
  // bookkeeping this used to be, now generates a real POS invoice (with a
  // payment line marking it pre-paid via the scheme), decrements stock, and
  // logs a stock_movement, so the handout is visible everywhere a normal
  // sale is: stock-on-hand, revenue/tax reports, the customer's purchase
  // history. Requires a real catalog product (no more free-text-only entries)
  // since price/tax/stock all come from the product record.
  safeHandle(ipcMain, 'chits:members:recordRedemption', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id, cs.chit_value, cs.name as scheme_name, cs.scheme_number, cs.product_id as scheme_product_id
      FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertMemberAccess(perms, caller, { branch_id: member.branch_id }, member)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    if (!member.redemption_type) return { success: false, error: 'This member has not received their product yet' }
    if (member.redemption_invoice_id) return { success: false, error: 'A redemption invoice has already been recorded for this member' }

    const productId = payload.product_id ? String(payload.product_id) : ''
    if (!productId) return { success: false, error: 'Select a product from the catalog' }
    const qty = Math.max(1, Math.trunc(Number(payload.qty) || 1))
    // Fulfilled from wherever the member was actually recruited (a
    // collaborating branch's own recruit is dispensed from that branch's
    // stock), falling back to the scheme's home branch.
    const fulfillBranchId = String(member.enrolled_branch_id || member.branch_id)
    // Members who won before this migration have no entitlement_value
    // frozen at win time — fall back to the scheme's chit_value, same
    // figure the old hard cap always used.
    const entitlementValue = money(Number(member.entitlement_value ?? member.chit_value) || 0)

    const product = db.prepare('SELECT id, name, selling_price, tax_rate FROM products WHERE id=?')
      .get(productId) as { id: string; name: string; selling_price: number; tax_rate: number } | undefined
    if (!product) return { success: false, error: 'Product not found' }

    const stockRow = db.prepare('SELECT COALESCE(SUM(quantity),0) as available FROM stocks WHERE product_id=? AND branch_id=?')
      .get(productId, fulfillBranchId) as { available: number }
    if (stockRow.available < qty) {
      return { success: false, error: `Insufficient stock for "${product.name}" at this branch — available ${stockRow.available}, requested ${qty}` }
    }

    const unitPrice = money(Number(product.selling_price) || 0)
    const subtotal = money(unitPrice * qty)
    const taxAmount = money(subtotal * (Number(product.tax_rate) || 0) / 100)
    const totalAmount = money(subtotal + taxAmount)

    // Product Substitution Consent Policy — a redemption for a product
    // other than the scheme's own nominal product_id cannot complete
    // without a recorded reason AND explicit customer acceptance. A scheme
    // with no nominal product set has nothing to "substitute" against.
    const schemeProductId = member.scheme_product_id ? String(member.scheme_product_id) : null
    const isSubstitution = Boolean(schemeProductId && schemeProductId !== productId)
    if (isSubstitution) {
      const substitutionReason = String(payload.substitution_reason || '').trim()
      if (!substitutionReason) {
        return { success: false, error: 'Record a substitution reason — the selected product differs from this scheme\'s own product' }
      }
      if (payload.customer_accepted !== true) {
        return { success: false, error: 'Redemption cannot complete without recording customer acceptance of the substituted product' }
      }
    }

    // Product Upgrade / Top-up Policy — the entitlement covers up to
    // entitlementValue; anything above requires an explicit customer
    // top-up payment collected as PART of this same redemption (never a
    // loan/installment). Downgrades never require anything extra — the
    // leftover becomes SmartBuy Wallet credit, handled inside the
    // transaction below.
    const upgradeAmount = money(Math.max(0, totalAmount - entitlementValue))
    let upgradePaymentMethod: string | null = null
    if (upgradeAmount > 0) {
      upgradePaymentMethod = payload.upgrade_payment_method ? String(payload.upgrade_payment_method) : ''
      if (!upgradePaymentMethod) {
        return { success: false, error: `This product (Rs.${totalAmount}) exceeds the entitled value (Rs.${entitlementValue}) — collect the Rs.${upgradeAmount} top-up and select a payment method before completing redemption` }
      }
    }
    const walletCreditAmount = money(Math.max(0, entitlementValue - totalAmount))

    const invoiceId = crypto.randomUUID()
    const invoiceNumber = getNextBillNumber(fulfillBranchId, 'RETAIL')
    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
    const nowIso = new Date().toISOString()

    db.transaction(() => {
      // Re-verified inside the transaction, not just in the pre-transaction
      // read above — the earlier check is a plain SELECT with no lock, so
      // this is the actual guard against two near-simultaneous calls both
      // passing it and double-redeeming the same member.
      const stillUnredeemed = db.prepare('SELECT redemption_invoice_id FROM chit_members WHERE id=?').get(memberId) as { redemption_invoice_id: string | null } | undefined
      if (stillUnredeemed?.redemption_invoice_id) throw new Error('A redemption invoice has already been recorded for this member')

      const changed = db.prepare(`
        UPDATE stocks SET quantity = quantity - ?, updated_at=datetime('now')
        WHERE product_id=? AND branch_id=? AND quantity >= ?
      `).run(qty, productId, fulfillBranchId, qty)
      if (!changed.changes) throw new Error('Insufficient stock — it may have just been sold elsewhere')

      const notesParts = [`Smart Buy Redemption — ${member.scheme_name} (${member.scheme_number}), Member #${member.join_order}`]
      if (upgradeAmount > 0) notesParts.push(`Upgrade: entitlement Rs.${entitlementValue} + customer top-up Rs.${upgradeAmount}`)
      if (walletCreditAmount > 0) notesParts.push(`Downgrade: Rs.${walletCreditAmount} carried to SmartBuy Wallet`)
      if (isSubstitution) notesParts.push(`Substituted from scheme product — ${String(payload.substitution_reason || '').trim()}`)

      const invoiceRow = {
        id: invoiceId, invoice_number: invoiceNumber, branch_id: fulfillBranchId,
        customer_id: member.transferred_customer_id || member.customer_id, cashier_id: caller.id || null,
        bill_type: 'RETAIL', status: 'completed',
        subtotal, discount_amount: 0, tax_amount: taxAmount, total_amount: totalAmount,
        paid_amount: totalAmount, due_amount: 0,
        notes: notesParts.join(' — '),
      }
      db.prepare(`
        INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id, bill_type, status,
          subtotal, discount_amount, tax_amount, total_amount, paid_amount, due_amount, notes)
        VALUES (@id,@invoice_number,@branch_id,@customer_id,@cashier_id,@bill_type,@status,
          @subtotal,@discount_amount,@tax_amount,@total_amount,@paid_amount,@due_amount,@notes)
      `).run(invoiceRow)
      enqueue.push({ table: 'invoices', id: invoiceId, row: invoiceRow, op: 'INSERT' })

      const itemId = crypto.randomUUID()
      const itemRow = {
        id: itemId, invoice_id: invoiceId, product_id: productId, quantity: qty, unit_price: unitPrice,
        discount_pct: 0, discount_amount: 0, tax_rate: product.tax_rate || 0, tax_amount: taxAmount, line_total: totalAmount,
      }
      db.prepare(`
        INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, discount_pct,
          discount_amount, tax_rate, tax_amount, line_total)
        VALUES (@id,@invoice_id,@product_id,@quantity,@unit_price,@discount_pct,
          @discount_amount,@tax_rate,@tax_amount,@line_total)
      `).run(itemRow)
      enqueue.push({ table: 'invoice_items', id: itemId, row: itemRow, op: 'INSERT' })

      // Entitlement-covered portion is always its own payment line, exactly
      // like before — capped at whatever the entitlement actually covers of
      // this invoice (the full total normally/on a downgrade, or just the
      // entitlement's share on an upgrade).
      const entitlementCovered = money(Math.min(totalAmount, entitlementValue))
      const paymentId = crypto.randomUUID()
      const paymentRow = {
        id: paymentId, invoice_id: invoiceId, method: 'chit_redemption', amount: entitlementCovered,
        reference: member.scheme_number, received_by: caller.id || null,
      }
      db.prepare(`
        INSERT INTO payments (id, invoice_id, method, amount, reference, received_by)
        VALUES (@id,@invoice_id,@method,@amount,@reference,@received_by)
      `).run(paymentRow)
      enqueue.push({ table: 'payments', id: paymentId, row: paymentRow, op: 'INSERT' })

      // Upgrade top-up — a second, separate payment line in the customer's
      // own chosen method. Never an installment/loan: collected now, as
      // part of completing this same redemption.
      if (upgradeAmount > 0) {
        const upgradePaymentId = crypto.randomUUID()
        const upgradePaymentRow = {
          id: upgradePaymentId, invoice_id: invoiceId, method: upgradePaymentMethod, amount: upgradeAmount,
          reference: `${member.scheme_number}-UPGRADE`, received_by: caller.id || null,
        }
        db.prepare(`
          INSERT INTO payments (id, invoice_id, method, amount, reference, received_by)
          VALUES (@id,@invoice_id,@method,@amount,@reference,@received_by)
        `).run(upgradePaymentRow)
        enqueue.push({ table: 'payments', id: upgradePaymentId, row: upgradePaymentRow, op: 'INSERT' })
      }

      const movement = insertStockMovement(db, {
        product_id: productId, from_branch_id: fulfillBranchId, to_branch_id: null,
        quantity: qty, movement_type: 'SALE', reference_order_id: invoiceId,
        notes: `Smart Buy Redemption — ${member.scheme_number}`, created_by: (caller.id as string) || null,
      })
      enqueue.push({ table: 'stock_movements', id: String(movement.id), row: movement, op: 'INSERT' })

      // The one and only place SmartBuy commission is earned — matched
      // against the product/invoice the member actually received (actual
      // subtotal, whatever it is on an upgrade or downgrade), never the
      // scheme's nominal entitlement value.
      const commissionResult = computeAndRecordCommission(db, {
        sourceTable: 'chit_members', sourceId: invoiceId, productId, schemeId: String(member.scheme_id),
        memberId, registrationAgentId: (member.agent_id as string | null) || null, salesAgentId: null,
        amount: subtotal, branchId: fulfillBranchId,
      })
      for (const item of commissionResult.enqueue) enqueue.push(item)

      // Product Downgrade Handling — leftover entitlement becomes SmartBuy
      // Wallet credit. Never cash, never touches the scheme's own
      // contribution/commission accounting — a standalone customer credit
      // ledger keyed by customer_id (the actual recipient, honoring a
      // transfer if one was approved).
      if (walletCreditAmount > 0) {
        const walletCustomerId = String(member.transferred_customer_id || member.customer_id)
        const existingWallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE customer_id=?').get(walletCustomerId) as { id: string; balance: number } | undefined
        const walletId = existingWallet?.id || crypto.randomUUID()
        const newBalance = money((existingWallet?.balance || 0) + walletCreditAmount)
        if (existingWallet) {
          db.prepare(`UPDATE smartbuy_wallet SET balance=?, updated_at=datetime('now') WHERE id=?`).run(newBalance, walletId)
          enqueue.push({ table: 'smartbuy_wallet', id: walletId, op: 'UPDATE', row: { id: walletId, balance: newBalance } })
        } else {
          const walletRow = { id: walletId, customer_id: walletCustomerId, balance: newBalance }
          db.prepare(`INSERT INTO smartbuy_wallet (id, customer_id, balance) VALUES (@id,@customer_id,@balance)`).run(walletRow)
          enqueue.push({ table: 'smartbuy_wallet', id: walletId, op: 'INSERT', row: walletRow })
        }
        const walletTxnId = crypto.randomUUID()
        const walletTxnRow = {
          id: walletTxnId, wallet_id: walletId, customer_id: walletCustomerId, transaction_type: 'credit',
          amount: walletCreditAmount, balance_after: newBalance, source: 'redemption_downgrade',
          redemption_id: memberId, notes: `Entitlement Rs.${entitlementValue} − product Rs.${totalAmount}`, created_by: caller.id || null,
        }
        db.prepare(`
          INSERT INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, redemption_id, notes, created_by)
          VALUES (@id,@wallet_id,@customer_id,@transaction_type,@amount,@balance_after,@source,@redemption_id,@notes,@created_by)
        `).run(walletTxnRow)
        enqueue.push({ table: 'smartbuy_wallet_transactions', id: walletTxnId, row: walletTxnRow, op: 'INSERT' })
      }

      const memberUpdate = {
        redeemed_product_id: productId, redeemed_product_name: product.name, redeemed_qty: qty, redeemed_value: totalAmount,
        redemption_invoice_id: invoiceId, claim_status: 'redeemed', claimed_at: nowIso,
        entitlement_value: entitlementValue, upgrade_amount: upgradeAmount,
        upgrade_payment_status: upgradeAmount > 0 ? 'paid' : null, upgrade_payment_method: upgradeAmount > 0 ? upgradePaymentMethod : null,
        upgrade_paid_at: upgradeAmount > 0 ? nowIso : null,
        substitution_flag: isSubstitution ? 1 : 0, substitution_reason: isSubstitution ? String(payload.substitution_reason || '').trim() : null,
        wallet_credit_created: walletCreditAmount,
      }
      db.prepare(`
        UPDATE chit_members
        SET redeemed_product_id=@redeemed_product_id, redeemed_product_name=@redeemed_product_name,
            redeemed_qty=@redeemed_qty, redeemed_value=@redeemed_value, redemption_invoice_id=@redemption_invoice_id,
            claim_status=@claim_status, claimed_at=@claimed_at, entitlement_value=@entitlement_value,
            upgrade_amount=@upgrade_amount, upgrade_payment_status=@upgrade_payment_status,
            upgrade_payment_method=@upgrade_payment_method, upgrade_paid_at=@upgrade_paid_at,
            substitution_flag=@substitution_flag, substitution_reason=@substitution_reason,
            wallet_credit_created=@wallet_credit_created, updated_at=datetime('now')
        WHERE id=@id
      `).run({ ...memberUpdate, id: memberId })

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: fulfillBranchId,
        action: 'CHIT_REDEMPTION_RECORDED', tableName: 'chit_members', recordId: memberId,
        newValues: {
          productId, productName: product.name, qty, value: totalAmount, invoiceId,
          entitlementValue, upgradeAmount, walletCreditAmount,
          isSubstitution, substitutionReason: isSubstitution ? String(payload.substitution_reason || '').trim() : null,
        },
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    await syncStockRow(db, productId, fulfillBranchId)
    await enqueuSync('chit_members', memberId, 'UPDATE', {
      id: memberId, redeemed_product_id: productId, redeemed_product_name: product.name,
      redeemed_qty: qty, redeemed_value: totalAmount, redemption_invoice_id: invoiceId,
      claim_status: 'redeemed', claimed_at: nowIso, entitlement_value: entitlementValue,
      upgrade_amount: upgradeAmount, wallet_credit_created: walletCreditAmount,
    })
    await touchSchemeSync(db, String(member.scheme_id))
    return { success: true, data: { invoiceId, invoiceNumber, entitlementValue, upgradeAmount, walletCreditAmount, isSubstitution } }
  })

  // ── Redemption reversal (Super Admin only) ───────────────────────────────
  // The only correction path for a redemption gone wrong (wrong product
  // keyed in, customer changed their mind before leaving, data-entry
  // mistake) — cancelling the invoice generically left the member
  // permanently stranded (redemption_invoice_id stayed set, blocking
  // chits:members:recordRedemption forever, with no invoice to show for
  // it). This reverses everything the original redemption did — invoice,
  // stock, commission, any wallet credit it created — and puts the member
  // back to "won, unclaimed" so staff can redo it. Never touches whether
  // they won (redemption_type/won_cycle_no/status stay exactly as they
  // were) — this undoes the CLAIM, not the draw result.
  safeHandle(ipcMain, 'chits:members:reverseRedemption', async (_e, memberId: string, reason: string) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can reverse a redemption' }
    const trimmedReason = String(reason || '').trim()
    if (!trimmedReason) return { success: false, error: 'A reversal reason is required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!member.redemption_invoice_id) return { success: false, error: 'This member has no recorded redemption to reverse' }

    const invoiceId = String(member.redemption_invoice_id)
    const fulfillBranchId = String(member.enrolled_branch_id || member.branch_id)
    const oldValues = {
      redeemedProductId: member.redeemed_product_id, redeemedProductName: member.redeemed_product_name,
      redeemedQty: member.redeemed_qty, redeemedValue: member.redeemed_value, invoiceId,
      upgradeAmount: member.upgrade_amount, walletCreditCreated: member.wallet_credit_created,
    }

    db.transaction(() => {
      db.prepare(`UPDATE invoices SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(invoiceId)

      if (member.redeemed_product_id && Number(member.redeemed_qty) > 0) {
        db.prepare(`
          UPDATE stocks SET quantity = quantity + ?, updated_at=datetime('now')
          WHERE product_id=? AND branch_id=?
        `).run(Number(member.redeemed_qty), member.redeemed_product_id, fulfillBranchId)
        insertStockMovement(db, {
          product_id: String(member.redeemed_product_id), from_branch_id: null, to_branch_id: fulfillBranchId,
          quantity: Number(member.redeemed_qty), movement_type: 'ADJUSTMENT', reference_order_id: invoiceId,
          notes: `Redemption reversed — ${trimmedReason}`, created_by: (caller.id as string) || null,
        })
      }

      db.prepare(`UPDATE commission_ledger SET status='cancelled', updated_at=datetime('now') WHERE source_id=? AND member_id=?`)
        .run(invoiceId, memberId)

      // Claw back any wallet credit this specific redemption created —
      // floored at 0, never driven negative even if some of it was
      // already spent elsewhere in the meantime.
      const walletCreditCreated = Number(member.wallet_credit_created) || 0
      if (walletCreditCreated > 0) {
        const walletCustomerId = String(member.transferred_customer_id || member.customer_id)
        const wallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE customer_id=?').get(walletCustomerId) as { id: string; balance: number } | undefined
        if (wallet) {
          const clawback = money(Math.min(walletCreditCreated, wallet.balance))
          const newBalance = money(wallet.balance - clawback)
          db.prepare(`UPDATE smartbuy_wallet SET balance=?, updated_at=datetime('now') WHERE id=?`).run(newBalance, wallet.id)
          if (clawback > 0) {
            db.prepare(`
              INSERT INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, redemption_id, notes, created_by)
              VALUES (?,?,?,?,?,?,?,?,?,?)
            `).run(crypto.randomUUID(), wallet.id, walletCustomerId, 'debit', clawback, newBalance, 'redemption_reversed', memberId, `Redemption reversed — ${trimmedReason}`, caller.id || null)
          }
        }
      }

      db.prepare(`
        UPDATE chit_members
        SET redeemed_product_id=NULL, redeemed_product_name=NULL, redeemed_qty=1, redeemed_value=NULL,
            redemption_invoice_id=NULL, claim_status='pending_claim', claimed_at=NULL,
            upgrade_amount=0, upgrade_payment_status=NULL, upgrade_payment_method=NULL, upgrade_paid_at=NULL,
            substitution_flag=0, substitution_reason=NULL, wallet_credit_created=0, updated_at=datetime('now')
        WHERE id=?
      `).run(memberId)

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: fulfillBranchId,
        action: 'CHIT_REDEMPTION_REVERSED', tableName: 'chit_members', recordId: memberId,
        oldValues, newValues: { reason: trimmedReason },
      })
    })()

    await enqueuSync('invoices', invoiceId, 'UPDATE', { id: invoiceId, status: 'cancelled' })
    await enqueuSync('chit_members', memberId, 'UPDATE', {
      id: memberId, redeemed_product_id: null, redeemed_product_name: null, redeemed_qty: 1, redeemed_value: null,
      redemption_invoice_id: null, claim_status: 'pending_claim', claimed_at: null,
      upgrade_amount: 0, upgrade_payment_status: null, upgrade_payment_method: null, upgrade_paid_at: null,
      substitution_flag: 0, substitution_reason: null, wallet_credit_created: 0,
    })
    if (member.redeemed_product_id) await syncStockRow(db, String(member.redeemed_product_id), fulfillBranchId)
    await touchSchemeSync(db, String(member.scheme_id))
    return { success: true }
  })

  // ── Claim Expiry Policy (soft reminder only — entitlement never expires) ─
  safeHandle(ipcMain, 'chits:members:extendClaim', async (_e, memberId: string, newDueDate: string, reason: string) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can extend a claim date' }
    const trimmedReason = String(reason || '').trim()
    if (!trimmedReason) return { success: false, error: 'An extension reason is required' }
    if (!newDueDate) return { success: false, error: 'A new claim due date is required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (member.redemption_invoice_id) return { success: false, error: 'This member has already claimed their product' }
    if (!member.redemption_type) return { success: false, error: 'This member has not won yet' }

    const oldDueDate = member.claim_due_date || null
    db.prepare(`
      UPDATE chit_members SET claim_due_date=?, claim_status='pending_claim', claim_reminder_sent_at=NULL, updated_at=datetime('now')
      WHERE id=?
    `).run(newDueDate, memberId)
    await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, claim_due_date: newDueDate, claim_status: 'pending_claim', claim_reminder_sent_at: null })
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (member.branch_id as string) || null,
      action: 'CHIT_CLAIM_EXTENDED', tableName: 'chit_members', recordId: memberId,
      oldValues: { claimDueDate: oldDueDate }, newValues: { claimDueDate: newDueDate, reason: trimmedReason, winner: memberId },
    })
    return { success: true }
  })

  safeHandle(ipcMain, 'chits:claims:delayed', (_e, filters: { branchId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions = [`m.status='redeemed'`, `m.redemption_invoice_id IS NULL`, `m.claim_status IN ('reminder_sent','delayed_claim')`]
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    const rows = db.prepare(`
      SELECT m.id, m.claim_status, m.claim_due_date, m.product_received_at as won_date, m.won_cycle_no,
        c.name as customer_name, c.phone as customer_phone,
        cs.name as scheme_name, cs.scheme_number, b.name as branch_name,
        CAST(julianday('now') - julianday(m.claim_due_date) AS INTEGER) as days_overdue
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN branches b ON b.id = cs.branch_id
      WHERE ${conditions.join(' AND ')}
      ORDER BY m.claim_due_date ASC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── Winner Transfer Policy (Super Admin only, exceptional) ───────────────
  safeHandle(ipcMain, 'chits:members:transfer', async (_e, memberId: string, newCustomerId: string, reason: string) => {
    const perms = currentPerms()
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can approve a winner transfer' }
    const trimmedReason = String(reason || '').trim()
    if (!trimmedReason) return { success: false, error: 'A transfer reason is required' }
    if (!newCustomerId) return { success: false, error: 'Select the recipient customer' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!member.redemption_type) return { success: false, error: 'This member has not won yet — nothing to transfer' }
    // Restricted to before the physical claim — once redeemed, the invoice/
    // stock/commission are already settled under the original customer;
    // unwinding that is reversal territory, not a transfer. This also
    // naturally satisfies "transfer must not change commission history":
    // commission only accrues at claim time, so pre-claim there is none yet.
    if (member.redemption_invoice_id) return { success: false, error: 'This member has already claimed their product — a transfer is only possible before the product is claimed' }
    const newCustomer = db.prepare('SELECT id, name FROM customers WHERE id=?').get(newCustomerId) as { id: string; name: string } | undefined
    if (!newCustomer) return { success: false, error: 'Recipient customer not found' }
    if (newCustomerId === member.customer_id) return { success: false, error: 'Recipient is already the original winner' }

    const transferId = crypto.randomUUID()
    db.transaction(() => {
      // The original winner (customer_id), draw history, and scheme winner
      // record are never overwritten — only who will actually claim it.
      db.prepare(`UPDATE chit_members SET transferred_customer_id=?, transfer_reason=?, updated_at=datetime('now') WHERE id=?`)
        .run(newCustomerId, trimmedReason, memberId)
      const transferRow = {
        id: transferId, member_id: memberId, original_customer_id: member.customer_id, new_customer_id: newCustomerId,
        reason: trimmedReason, approved_by: caller.id || null,
      }
      db.prepare(`
        INSERT INTO smartbuy_transfer_history (id, member_id, original_customer_id, new_customer_id, reason, approved_by)
        VALUES (@id,@member_id,@original_customer_id,@new_customer_id,@reason,@approved_by)
      `).run(transferRow)
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (member.branch_id as string) || null,
        action: 'CHIT_WINNER_TRANSFERRED', tableName: 'chit_members', recordId: memberId,
        oldValues: { originalCustomerId: member.customer_id }, newValues: { newCustomerId, reason: trimmedReason },
      })
    })()
    await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, transferred_customer_id: newCustomerId, transfer_reason: trimmedReason })
    await enqueuSync('smartbuy_transfer_history', transferId, 'INSERT', {
      id: transferId, member_id: memberId, original_customer_id: member.customer_id, new_customer_id: newCustomerId,
      reason: trimmedReason, approved_by: caller.id || null,
    })
    return { success: true, data: { id: transferId } }
  })

  safeHandle(ipcMain, 'chits:transfers:list', (_e, filters: { branchId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT t.*, oc.name as original_customer_name, nc.name as new_customer_name,
        cs.name as scheme_name, cs.scheme_number, u.name as approved_by_name
      FROM smartbuy_transfer_history t
      JOIN chit_members m ON m.id = t.member_id
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      LEFT JOIN customers oc ON oc.id = t.original_customer_id
      LEFT JOIN customers nc ON nc.id = t.new_customer_id
      LEFT JOIN users u ON u.id = t.approved_by
      ${where}
      ORDER BY t.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // ── SmartBuy Wallet ───────────────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:wallet:list', (_e, filters: { customerId?: string; branchId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (filters.customerId) { conditions.push('w.customer_id = ?'); params.push(filters.customerId) }
    // Scoped by ENROLLMENT (chit_members.enrolled_branch_id), not the
    // customer's own "home" branch_id — matching assertMemberAccess/
    // assertBranchScope everywhere else. A customer's home branch is
    // wherever they first registered; Branch Collaboration means the same
    // customer can also be legitimately enrolled (and generate wallet
    // credit) at a different branch, which must stay visible to that
    // branch's own Manager even though it isn't the customer's home branch.
    if (branchId) {
      conditions.push('EXISTS (SELECT 1 FROM chit_members m2 WHERE m2.customer_id = w.customer_id AND m2.enrolled_branch_id = ?)')
      params.push(branchId)
    }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''
    const rows = db.prepare(`
      SELECT w.*, c.name as customer_name, c.phone as customer_phone,
        (SELECT COALESCE(SUM(amount),0) FROM smartbuy_wallet_transactions wt WHERE wt.wallet_id=w.id AND wt.transaction_type='credit') as total_credited,
        (SELECT COALESCE(SUM(amount),0) FROM smartbuy_wallet_transactions wt WHERE wt.wallet_id=w.id AND wt.transaction_type='debit') as total_used,
        -- Balance before all recorded activity — 0 for the whole-lifetime
        -- view every column here already covers (current balance is
        -- exactly credit_created minus credit_used from a starting point
        -- of zero); kept as an explicit field so the report can show it
        -- directly without the viewer re-deriving it.
        (w.balance - (
          (SELECT COALESCE(SUM(amount),0) FROM smartbuy_wallet_transactions wt WHERE wt.wallet_id=w.id AND wt.transaction_type='credit')
          - (SELECT COALESCE(SUM(amount),0) FROM smartbuy_wallet_transactions wt WHERE wt.wallet_id=w.id AND wt.transaction_type='debit')
        )) as opening_balance
      FROM smartbuy_wallet w
      LEFT JOIN customers c ON c.id = w.customer_id
      ${where}
      ORDER BY w.updated_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  // Wallet Usage Report — one row per spend event (POS purchase or manual
  // admin debit), not a per-customer summary like chits:wallet:list.
  safeHandle(ipcMain, 'chits:wallet:usage', (_e, filters: { customerId?: string; branchId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions = [`wt.transaction_type = 'debit'`]
    const params: unknown[] = []
    if (filters.customerId) { conditions.push('wt.customer_id = ?'); params.push(filters.customerId) }
    if (branchId) {
      conditions.push('EXISTS (SELECT 1 FROM chit_members m2 WHERE m2.customer_id = wt.customer_id AND m2.enrolled_branch_id = ?)')
      params.push(branchId)
    }
    const rows = db.prepare(`
      SELECT wt.id, wt.amount, wt.created_at, wt.source, wt.invoice_id,
        c.name as customer_name, c.phone as customer_phone,
        inv.invoice_number, u.name as staff_name
      FROM smartbuy_wallet_transactions wt
      LEFT JOIN customers c ON c.id = wt.customer_id
      LEFT JOIN invoices inv ON inv.id = wt.invoice_id
      LEFT JOIN users u ON u.id = wt.created_by
      WHERE ${conditions.join(' AND ')}
      ORDER BY wt.created_at DESC
    `).all(...params)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'chits:wallet:detail', (_e, customerId: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const db = getDb()
    const caller = authUser()
    const wallet = db.prepare(`
      SELECT w.*, c.name as customer_name, c.phone as customer_phone
      FROM smartbuy_wallet w LEFT JOIN customers c ON c.id = w.customer_id
      WHERE w.customer_id=?
    `).get(customerId) as Record<string, unknown> | undefined
    if (!wallet) return { success: true, data: { wallet: null, transactions: [] } }
    // Same enrollment-based scoping as chits:wallet:list — a non-global
    // caller needs at least one enrollment for this customer at their own
    // branch, not a match on the customer's "home" branch_id.
    if (!isGlobalChitAccess(perms)) {
      const myBranchId = caller.branch_id as string | undefined
      const enrolledHere = myBranchId && db.prepare(
        `SELECT 1 FROM chit_members WHERE customer_id=? AND enrolled_branch_id=? LIMIT 1`
      ).get(customerId, myBranchId)
      if (!enrolledHere) return { success: false, error: 'You do not have access to this customer\'s wallet' }
    }
    const transactions = db.prepare(`
      SELECT wt.*, u.name as created_by_name
      FROM smartbuy_wallet_transactions wt LEFT JOIN users u ON u.id = wt.created_by
      WHERE wt.wallet_id=?
      ORDER BY wt.created_at DESC
    `).all(wallet.id)
    return { success: true, data: { wallet, transactions } }
  })

  // Manual usage — a customer spending wallet credit toward a future
  // purchase. Deliberately NOT wired into the main POS checkout screen
  // this round (that's a much larger, separate change to the daily-driver
  // payment flow) — this records the usage as its own auditable ledger
  // entry, which is what the balance/history/reports actually need.
  safeHandle(ipcMain, 'chits:wallet:debit', async (_e, customerId: string, amount: number, notes: string) => {
    const perms = currentPerms()
    // Super Admin only — a Smart Buy Manager may VIEW a wallet (their own
    // branch's customers, via chits:wallet:list/detail) but must never be
    // able to move real balance out of it (Product Redemption Policy
    // audit, "Manager cannot: Modify wallet balance").
    if (!isGlobalChitAccess(perms)) return { success: false, error: 'Only Super Admin can debit a SmartBuy Wallet' }
    const debitAmount = money(Number(amount) || 0)
    if (debitAmount <= 0) return { success: false, error: 'Enter a valid amount' }
    // Now that POS checkout has its own dedicated, automatic wallet-payment
    // path (invoices:create), this handler is exclusively for discretionary
    // manual admin adjustments — those require a recorded reason (SmartBuy
    // Wallet + POS audit: "Every manual wallet adjustment: Require... Reason").
    const trimmedNotes = String(notes || '').trim()
    if (!trimmedNotes) return { success: false, error: 'A reason is required for a manual wallet adjustment' }

    const db = getDb()
    const caller = authUser()
    const wallet = db.prepare('SELECT * FROM smartbuy_wallet WHERE customer_id=?').get(customerId) as { id: string; balance: number } | undefined
    if (!wallet) return { success: false, error: 'This customer has no SmartBuy Wallet' }
    if (debitAmount > Number(wallet.balance) + 0.01) {
      return { success: false, error: `Insufficient wallet balance — available Rs.${wallet.balance}` }
    }

    const newBalance = money(Number(wallet.balance) - debitAmount)
    const txnId = crypto.randomUUID()
    db.transaction(() => {
      db.prepare(`UPDATE smartbuy_wallet SET balance=?, updated_at=datetime('now') WHERE id=?`).run(newBalance, wallet.id)
      db.prepare(`
        INSERT INTO smartbuy_wallet_transactions (id, wallet_id, customer_id, transaction_type, amount, balance_after, source, notes, created_by)
        VALUES (?,?,?,?,?,?,?,?,?)
      `).run(txnId, wallet.id, customerId, 'debit', debitAmount, newBalance, 'manual_usage', trimmedNotes, caller.id || null)
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: null,
        action: 'SMARTBUY_WALLET_DEBITED', tableName: 'smartbuy_wallet', recordId: wallet.id,
        oldValues: { balance: wallet.balance }, newValues: { balance: newBalance, amount: debitAmount, notes: trimmedNotes },
      })
    })()
    await enqueuSync('smartbuy_wallet', wallet.id, 'UPDATE', { id: wallet.id, balance: newBalance })
    await enqueuSync('smartbuy_wallet_transactions', txnId, 'INSERT', {
      id: txnId, wallet_id: wallet.id, customer_id: customerId, transaction_type: 'debit',
      amount: debitAmount, balance_after: newBalance, source: 'manual_usage', notes: trimmedNotes, created_by: caller.id || null,
    })
    return { success: true, data: { balance: newBalance } }
  })

  // ── Smart Buy Dashboard: everything on one screen ───────────────────────
  safeHandle(ipcMain, 'chits:dashboard', (_e, filters: { branchId?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!canManage(perms)) return { success: false, error: 'Smart Buy management access required' }
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const schemeWhere = branchId ? 'WHERE cs.branch_id = ?' : ''
    const schemeParams = branchId ? [branchId] : []

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere}) as total_schemes,
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere ? schemeWhere + " AND cs.status='active'" : "WHERE cs.status='active'"}) as active_schemes,
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere ? schemeWhere + " AND cs.status='pending'" : "WHERE cs.status='pending'"}) as pending_schemes,
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere ? schemeWhere + " AND cs.status='completed'" : "WHERE cs.status='completed'"}) as completed_schemes,
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere ? schemeWhere + " AND cs.status='cancelled'" : "WHERE cs.status='cancelled'"}) as cancelled_schemes,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} m.status != 'withdrawn') as members_enrolled,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} m.status = 'redeemed') as winner_count,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc JOIN chit_schemes cs ON cs.id = cc.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} cc.status = 'approved'
          AND strftime('%Y-%m', cc.paid_at) = strftime('%Y-%m', 'now')) as collected_this_month,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc JOIN chit_schemes cs ON cs.id = cc.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} cc.status = 'approved'
          AND date(cc.paid_at) = date('now')) as collected_today,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc JOIN chit_schemes cs ON cs.id = cc.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} cc.status = 'pending_verification') as pending_payments,
        (SELECT COALESCE(SUM(cl.total_commission), 0) FROM commission_ledger cl JOIN chit_schemes cs ON cs.id = cl.scheme_id
          ${schemeWhere}) as total_commission,
        (SELECT COUNT(DISTINCT m.customer_id) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} m.status != 'withdrawn') as total_customers,
        (SELECT COUNT(*) FROM withdrawal_requests w JOIN chit_schemes cs ON cs.id = w.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} w.status = 'pending') as pending_withdrawal_requests,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} m.claim_status IN ('reminder_sent','delayed_claim')) as delayed_claims_count,
        (SELECT COALESCE(SUM(w.balance), 0) FROM smartbuy_wallet w JOIN customers c ON c.id = w.customer_id
          ${branchId ? 'WHERE c.branch_id = ?' : ''}) as total_wallet_balance
    `).get(...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...schemeParams, ...(branchId ? [branchId] : [])) as Record<string, unknown>

    // Company-wide-only figures — meaningless once scoped to one branch (a
    // branch-scoped caller only ever has their own branch/manager anyway).
    if (!branchId) {
      const companyTotals = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM branches) as total_branches,
          (SELECT COUNT(*) FROM users u JOIN roles r ON r.id = u.role_id WHERE r.session_scope = 'smartBuy' AND u.is_active = 1) as total_smartbuy_managers
      `).get() as Record<string, unknown>
      Object.assign(stats, companyTotals)
    }

    const agentWhere = branchId ? 'WHERE a.branch_id = ?' : ''
    const agentParams = branchId ? [branchId] : []
    const agentBalances = db.prepare(`
      SELECT a.id, a.name, a.code,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = a.id AND cc.status = 'approved' AND cc.method = 'cash') as total_cash_collected,
        (SELECT COALESCE(SUM(r.amount), 0) FROM agent_remittances r WHERE r.agent_id = a.id) as total_remitted
      FROM agents a
      ${agentWhere}
    `).all(...agentParams) as Record<string, unknown>[]
    for (const a of agentBalances) a.cash_balance = money(Number(a.total_cash_collected || 0) - Number(a.total_remitted || 0))
    const pendingRemittanceTotal = agentBalances.reduce((sum, a) => sum + Number(a.cash_balance || 0), 0)
    const agentsWithBalance = agentBalances.filter(a => Number(a.cash_balance || 0) > 0).sort((a, b) => Number(b.cash_balance) - Number(a.cash_balance))

    // One row per winning member (not per draw event) — same fix as
    // chits:reports:winners, so a final_batch draw's multiple winners each
    // show up with their own product instead of a single NULL row.
    const recentDraws = db.prepare(`
      SELECT d.cycle_no, d.draw_date, d.method, cs.name as scheme_name, cs.scheme_number,
        c.name as winner_name, wm.redeemed_product_name, wm.redeemed_qty, wm.contributions_paid
      FROM chit_members wm
      JOIN chit_schemes cs ON cs.id = wm.scheme_id
      JOIN chit_draws d ON d.scheme_id = wm.scheme_id AND d.cycle_no = wm.won_cycle_no
      LEFT JOIN customers c ON c.id = wm.customer_id
      ${schemeWhere}
      ${schemeWhere ? 'AND' : 'WHERE'} wm.redemption_type IN ('draw', 'final_batch')
      ORDER BY d.draw_date DESC
      LIMIT 10
    `).all(...schemeParams)

    // Final Month Product Claim — schemes with final-settlement members who
    // haven't had their product claim (invoice + stock) processed yet.
    const pendingFinalClaims = db.prepare(`
      SELECT cs.id as scheme_id, cs.name as scheme_name, cs.scheme_number,
        COUNT(*) as pending_count
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      ${schemeWhere ? schemeWhere + " AND" : "WHERE"} m.redemption_type = 'final_batch' AND m.redemption_invoice_id IS NULL
      GROUP BY cs.id, cs.name, cs.scheme_number
      ORDER BY pending_count DESC
    `).all(...schemeParams)

    // Branch Ranking — top branches by collection (company-wide view only;
    // a branch-scoped caller only ever has their own branch to rank).
    const branchRanking = db.prepare(`
      SELECT b.id as branch_id, b.name as branch_name,
        (SELECT COALESCE(SUM(cc.amount),0) FROM chit_contributions cc WHERE cc.branch_id = b.id AND cc.status = 'approved') as collected,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs2 ON cs2.id = m.scheme_id WHERE cs2.branch_id = b.id AND m.status != 'withdrawn') as members_enrolled
      FROM branches b
      ${branchId ? 'WHERE b.id = ?' : ''}
      ORDER BY collected DESC
      LIMIT 5
    `).all(...(branchId ? [branchId] : []))

    // Agent Ranking — top agents by total commission earned (either role).
    // Enriched with sales/customers so the same query backs both the ranking
    // chart and the KPI dashboard's ranked table (rank computed client-side
    // off this already-sorted array).
    const agentRanking = db.prepare(`
      SELECT a.id, a.name, a.code, b.name as branch_name,
        (SELECT COALESCE(SUM(
            CASE WHEN cl.registration_agent_id = a.id THEN cl.registration_commission ELSE 0 END +
            CASE WHEN cl.sales_agent_id = a.id THEN cl.sales_commission ELSE 0 END
          ), 0) FROM commission_ledger cl WHERE (cl.registration_agent_id = a.id OR cl.sales_agent_id = a.id)
            AND cl.status NOT IN ('rejected', 'cancelled')) as commission_earned,
        (SELECT COALESCE(SUM(cl.base_amount), 0) FROM commission_ledger cl WHERE cl.registration_agent_id = a.id OR cl.sales_agent_id = a.id) as sales,
        (SELECT COUNT(DISTINCT m.customer_id) FROM chit_members m WHERE m.agent_id = a.id) as customers
      FROM agents a
      LEFT JOIN branches b ON b.id = a.branch_id
      ${agentWhere}
      ORDER BY commission_earned DESC
      LIMIT 5
    `).all(...agentParams) as Record<string, unknown>[]

    // Monthly Collection + Commission Trend — last 6 calendar months.
    const monthlyCollectionTrend = db.prepare(`
      SELECT strftime('%Y-%m', cc.paid_at) as month, COALESCE(SUM(cc.amount),0) as total
      FROM chit_contributions cc JOIN chit_schemes cs ON cs.id = cc.scheme_id
      ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} cc.status = 'approved' AND date(cc.paid_at) >= date('now', '-5 months', 'start of month')
      GROUP BY month ORDER BY month
    `).all(...schemeParams)

    const commissionTrend = db.prepare(`
      SELECT strftime('%Y-%m', cl.created_at) as month, COALESCE(SUM(cl.total_commission),0) as total
      FROM commission_ledger cl JOIN chit_schemes cs ON cs.id = cl.scheme_id
      ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} date(cl.created_at) >= date('now', '-5 months', 'start of month')
      GROUP BY month ORDER BY month
    `).all(...schemeParams)

    // New Customers — first-created month for a customer who is also a chit
    // member in scope (no separate customer-acquisition table exists).
    const monthlyNewCustomers = db.prepare(`
      SELECT strftime('%Y-%m', c.created_at) as month, COUNT(DISTINCT c.id) as total
      FROM customers c
      JOIN chit_members m ON m.customer_id = c.id
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} date(c.created_at) >= date('now', '-5 months', 'start of month')
      GROUP BY month ORDER BY month
    `).all(...schemeParams)

    // Scheme Registrations — member enrollments per month.
    const monthlySchemeRegistrations = db.prepare(`
      SELECT strftime('%Y-%m', m.created_at) as month, COUNT(*) as total
      FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
      ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} date(m.created_at) >= date('now', '-5 months', 'start of month')
      GROUP BY month ORDER BY month
    `).all(...schemeParams)

    // Winner Timeline — draws grouped by month (winners settled per month).
    const winnerTimeline = db.prepare(`
      SELECT strftime('%Y-%m', d.draw_date) as month, COALESCE(SUM(d.settled_count),0) as winners
      FROM chit_draws d JOIN chit_schemes cs ON cs.id = d.scheme_id
      ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} date(d.draw_date) >= date('now', '-5 months', 'start of month')
      GROUP BY month ORDER BY month
    `).all(...schemeParams)

    // Top Selling Products — from actual redemption invoices (Task 11
    // invoice/stock integration), not the scheme's decorative default product.
    const topSellingProducts = db.prepare(`
      SELECT p.id as product_id, p.name as product_name,
        SUM(m.redeemed_qty) as qty_sold, SUM(m.redeemed_value) as total_value
      FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      JOIN products p ON p.id = m.redeemed_product_id
      ${schemeWhere ? schemeWhere + " AND" : "WHERE"} m.redemption_invoice_id IS NOT NULL
      GROUP BY p.id, p.name
      ORDER BY total_value DESC
      LIMIT 5
    `).all(...schemeParams)

    return {
      success: true,
      data: {
        ...stats,
        pending_remittance_total: money(pendingRemittanceTotal),
        agents_with_balance: agentsWithBalance.slice(0, 10),
        recent_draws: recentDraws,
        pending_final_claims: pendingFinalClaims,
        branch_ranking: branchRanking,
        agent_ranking: agentRanking,
        monthly_collection_trend: monthlyCollectionTrend,
        commission_trend: commissionTrend,
        monthly_new_customers: monthlyNewCustomers,
        monthly_scheme_registrations: monthlySchemeRegistrations,
        winner_timeline: winnerTimeline,
        top_selling_products: topSellingProducts,
      },
    }
  })
}
