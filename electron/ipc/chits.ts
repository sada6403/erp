import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import * as XLSX from 'xlsx'
import { safeHandle } from './ipcHandler'

const store = new Store()

const PHONE_RE = /^\+?\d{9,12}$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const NIC_RE = /^(\d{9}[vVxX]|\d{12})$/

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
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

// A member's own agent (if assigned) earns commission at that agent's own
// default rate; otherwise commission falls back to the scheme-wide rate —
// keeps existing single-agent schemes working unchanged.
function resolveCommissionPct(
  db: ReturnType<typeof getDb>,
  member: { agent_id?: unknown } | undefined,
  scheme: { agent_commission_pct?: unknown }
): number {
  const memberAgentId = member?.agent_id as string | undefined
  if (memberAgentId) {
    const agent = db.prepare('SELECT default_commission_pct FROM agents WHERE id=?')
      .get(memberAgentId) as { default_commission_pct?: number } | undefined
    if (agent?.default_commission_pct !== undefined && agent.default_commission_pct !== null) {
      return Number(agent.default_commission_pct)
    }
  }
  return Number(scheme.agent_commission_pct) || 0
}

function addMonths(date: string, months: number): string {
  const d = new Date(`${date}T00:00:00`)
  d.setMonth(d.getMonth() + months)
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

function canManage(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all || perms.customers || perms.chits)
}

// 'all'/'customers' are the existing global (all-branch) markers — unchanged.
// A caller with only 'chits' (the restricted Smart Buy Manager role) is
// never global, so this always confines them to their own branch even if
// a request tries to pass a different branch_id.
function isGlobalChitAccess(perms: Record<string, unknown>): boolean {
  return Boolean(perms.all || perms.customers)
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

export function registerChitHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'chits:list', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    const branchId = resolveScopedBranchId(perms, caller, filters.branch_id)

    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('cs.branch_id = ?'); params.push(branchId) }
    if (filters.status) { conditions.push('cs.status = ?'); params.push(filters.status) }
    if (filters.search) {
      conditions.push('(cs.name LIKE ? OR cs.scheme_number LIKE ?)')
      params.push(`%${filters.search}%`, `%${filters.search}%`)
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
    const scheme = db.prepare(`
      SELECT cs.*, b.name as branch_name, a.name as agent_name, a.code as agent_code, p.name as product_name
      FROM chit_schemes cs
      LEFT JOIN branches b ON b.id = cs.branch_id
      LEFT JOIN agents a ON a.id = cs.agent_id
      LEFT JOIN products p ON p.id = cs.product_id
      WHERE cs.id = ?
    `).get(id) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

    const members = db.prepare(`
      SELECT m.*, c.name as customer_name, c.phone as customer_phone,
        i.status as repayment_status, i.due_amount as repayment_due,
        ma.name as member_agent_name, ma.code as member_agent_code
      FROM chit_members m
      LEFT JOIN customers c ON c.id = m.customer_id
      LEFT JOIN installments i ON i.id = m.installment_id
      LEFT JOIN agents ma ON ma.id = m.agent_id
      WHERE m.scheme_id = ?
      ORDER BY m.join_order
    `).all(id)

    const draws = db.prepare(`
      SELECT d.*, c.name as winner_name
      FROM chit_draws d
      LEFT JOIN chit_members m ON m.id = d.winner_member_id
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE d.scheme_id = ?
      ORDER BY d.cycle_no
    `).all(id)

    const contributionSummary = db.prepare(`
      SELECT COALESCE(SUM(amount),0) as total_collected,
        COALESCE(SUM(commission_amount),0) as total_commission,
        COUNT(*) as contribution_count
      FROM chit_contributions WHERE scheme_id = ? AND status = 'approved'
    `).get(id)

    return { success: true, data: { scheme, members, draws, contributionSummary } }
  })

  safeHandle(ipcMain, 'chits:create', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const branchId = String(resolveScopedBranchId(perms, caller, payload.branch_id) || defaultBranchId())
    const name = String(payload.name || '').trim()
    const memberCount = Number(payload.member_count) || 0
    const cycleCount = Number(payload.cycle_count) || memberCount
    if (!name) return { success: false, error: 'Scheme name is required' }
    if (memberCount <= 0) return { success: false, error: 'Member count must be greater than 0' }
    if (cycleCount <= 0) return { success: false, error: 'Cycle count must be greater than 0' }

    const id = crypto.randomUUID()
    const schemeNumber = nextChitNumber(db, branchId)
    const row = {
      id, scheme_number: schemeNumber, name, branch_id: branchId,
      product_id: payload.product_id || null, agent_id: payload.agent_id || null,
      member_count: memberCount, cycle_count: cycleCount,
      frequency: payload.frequency || 'monthly',
      contribution_amount: money(Number(payload.contribution_amount) || 0),
      chit_value: money(Number(payload.chit_value) || 0),
      early_redemption_count: Number(payload.early_redemption_count) || 0,
      early_redemption_amount: money(Number(payload.early_redemption_amount) || 0),
      repayment_months: Number(payload.repayment_months) || 12,
      agent_commission_pct: Number(payload.agent_commission_pct) || 0,
      start_date: payload.start_date || new Date().toISOString().slice(0, 10),
      next_draw_date: payload.next_draw_date || null,
      status: 'active', notes: payload.notes || null, created_by: caller.id || null,
    }
    db.prepare(`
      INSERT INTO chit_schemes
        (id, scheme_number, name, branch_id, product_id, agent_id, member_count, cycle_count,
         frequency, contribution_amount, chit_value, early_redemption_count, early_redemption_amount,
         repayment_months, agent_commission_pct, start_date, next_draw_date, status, notes, created_by)
      VALUES (@id,@scheme_number,@name,@branch_id,@product_id,@agent_id,@member_count,@cycle_count,
         @frequency,@contribution_amount,@chit_value,@early_redemption_count,@early_redemption_amount,
         @repayment_months,@agent_commission_pct,@start_date,@next_draw_date,@status,@notes,@created_by)
    `).run(row)
    await enqueuSync('chit_schemes', id, 'INSERT', row)
    return { success: true, data: { id, scheme_number: schemeNumber } }
  })

  safeHandle(ipcMain, 'chits:update', async (_e, id: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const existing = db.prepare('SELECT id FROM chit_schemes WHERE id = ?').get(id)
    if (!existing) return { success: false, error: 'Chit scheme not found' }

    const update: Record<string, unknown> = { ...payload }
    delete update.id
    delete update.scheme_number
    const numericKeys = ['member_count', 'cycle_count', 'contribution_amount', 'chit_value',
      'early_redemption_count', 'early_redemption_amount', 'repayment_months', 'agent_commission_pct']
    for (const k of numericKeys) if (update[k] !== undefined) update[k] = Number(update[k]) || 0

    const fields = Object.keys(update).map(k => `${k} = @${k}`).join(', ')
    if (fields) db.prepare(`UPDATE chit_schemes SET ${fields}, updated_at = datetime('now') WHERE id = @id`).run({ ...update, id })
    await enqueuSync('chit_schemes', id, 'UPDATE', { id, ...update })
    return { success: true }
  })

  // ── Members: individual add ─────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:members:add', async (_e, schemeId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

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
    }

    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown> }> = []

    const memberId = crypto.randomUUID()
    const nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m + 1

    db.transaction(() => {
      if (!customerId) {
        customerId = crypto.randomUUID()
        const customerRow = {
          id: customerId, branch_id: scheme.branch_id,
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
        status: 'active', eligibility_note: null,
      }
      db.prepare(`
        INSERT INTO chit_members
          (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
           won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note)
        VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
           @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note)
      `).run(memberRow)
      enqueue.push({ table: 'chit_members', id: memberId, row: memberRow })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, 'INSERT', item.row)
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
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

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
    }

    const initialAmount = money(Number(payload.initial_amount) || 0)
    const agentId = payload.agent_id || null

    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
    const memberId = crypto.randomUUID()
    const nextOrder = (db.prepare('SELECT COALESCE(MAX(join_order),0) as m FROM chit_members WHERE scheme_id=?').get(schemeId) as { m: number }).m + 1
    let contributionId: string | null = null

    db.transaction(() => {
      if (!customerId) {
        customerId = crypto.randomUUID()
        const customerRow = {
          id: customerId, branch_id: scheme.branch_id,
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
      }
      db.prepare(`
        INSERT INTO chit_members
          (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
           won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note,
           paper_reference_code)
        VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
           @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note,
           @paper_reference_code)
      `).run(memberRow)
      enqueue.push({ table: 'chit_members', id: memberId, row: memberRow, op: 'INSERT' })

      if (initialAmount > 0) {
        contributionId = crypto.randomUUID()
        const method = String(payload.method || 'cash')
        const commission = money(initialAmount * resolveCommissionPct(db, { agent_id: agentId }, scheme) / 100)
        const contributionRow = {
          id: contributionId, scheme_id: schemeId, member_id: memberId, cycle_no: null,
          contribution_type: 'cycle', amount: initialAmount, method,
          receipt_number: payload.receipt_number || null, reference: payload.reference || null,
          status: 'approved', received_by: caller.id || null, collected_by_agent_id: agentId,
          branch_id: scheme.branch_id, commission_amount: commission, notes: 'Registered from paper record',
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
        newValues: { customerId, initialAmount, paperReferenceCode: payload.paper_reference_code },
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    return { success: true, data: { id: memberId, join_order: nextOrder, contributionId } }
  })

  safeHandle(ipcMain, 'chits:members:remove', async (_e, memberId: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.id, m.status, cs.branch_id FROM chit_members m
      JOIN chit_schemes cs ON cs.id = m.scheme_id
      WHERE m.id=?
    `).get(memberId) as { id: string; status: string; branch_id: unknown } | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertBranchScope(perms, caller, member.branch_id)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    if (member.status === 'redeemed') return { success: false, error: 'Cannot withdraw a member who has already received their product' }

    db.prepare(`UPDATE chit_members SET status='withdrawn', updated_at=datetime('now') WHERE id=?`).run(memberId)
    await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, status: 'withdrawn' })
    return { success: true }
  })

  safeHandle(ipcMain, 'chits:members:list', (_e, schemeId: string) => {
    const db = getDb()
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
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

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
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }

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
            id: customerId, branch_id: scheme.branch_id, name, phone,
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
          status: 'active', eligibility_note: null,
        }
        db.prepare(`
          INSERT INTO chit_members
            (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, redemption_type,
             won_cycle_no, product_received_at, contributions_paid, installment_id, status, eligibility_note)
          VALUES (@id,@scheme_id,@customer_id,@agent_id,@join_order,@is_early_redemption,@redemption_type,
             @won_cycle_no,@product_received_at,@contributions_paid,@installment_id,@status,@eligibility_note)
        `).run(memberRow)
        await enqueuSync('chit_members', memberId, 'INSERT', memberRow)
        imported++
      } catch (err: unknown) {
        errors.push(`Row ${rowNum}: ${(err as Error).message}`)
        skipped++
      }
    }

    return { success: true, imported, skipped, errors: errors.slice(0, 50) }
  })

  // ── Draws ────────────────────────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:draws:eligible', (_e, schemeId: string, cycleNo: number) => {
    const db = getDb()
    // A member is eligible if active, not yet redeemed, and has no unpaid
    // contribution for any prior cycle (standard chit practice — missed a
    // payment, sit out the draw until caught up).
    const rows = db.prepare(`
      SELECT m.*, c.name as customer_name, c.phone as customer_phone
      FROM chit_members m
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.scheme_id = ? AND m.status = 'active' AND m.redemption_type IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM chit_contributions cc
          WHERE cc.member_id = m.id AND cc.contribution_type = 'cycle'
            AND cc.cycle_no < ? AND cc.status = 'rejected'
        )
      ORDER BY m.join_order
    `).all(schemeId, cycleNo)
    return { success: true, data: rows }
  })

  safeHandle(ipcMain, 'chits:draws:conduct', async (_e, schemeId: string, cycleNo: number, options: { method?: 'random' | 'manual_pick'; winnerMemberId?: string } = {}) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(schemeId) as Record<string, unknown> | undefined
    if (!scheme) return { success: false, error: 'Chit scheme not found' }
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this scheme' }
    }

    const existingDraw = db.prepare('SELECT id FROM chit_draws WHERE scheme_id=? AND cycle_no=?').get(schemeId, cycleNo)
    if (existingDraw) return { success: false, error: `Cycle ${cycleNo} has already been drawn` }

    const eligible = db.prepare(`
      SELECT m.* FROM chit_members m
      WHERE m.scheme_id = ? AND m.status = 'active' AND m.redemption_type IS NULL
    `).all(schemeId) as Record<string, unknown>[]
    if (eligible.length === 0) return { success: false, error: 'No eligible members remain for this scheme' }

    const isFinalCycle = cycleNo >= Number(scheme.cycle_count)
    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []
    const drawId = crypto.randomUUID()

    db.transaction(() => {
      let winners: Record<string, unknown>[]
      let method: string

      if (isFinalCycle) {
        // Final cycle: every remaining member receives their product together.
        winners = eligible
        method = 'final_batch'
      } else {
        method = options.method || 'random'
        let winner: Record<string, unknown> | undefined
        if (method === 'manual_pick') {
          winner = eligible.find(m => m.id === options.winnerMemberId)
          if (!winner) throw new Error('Selected member is not eligible for this draw')
        } else {
          winner = eligible[crypto.randomInt(eligible.length)]
        }
        winners = [winner]
      }

      const drawRow = {
        id: drawId, scheme_id: schemeId, cycle_no: cycleNo,
        draw_date: new Date().toISOString().slice(0, 10),
        winner_member_id: winners.length === 1 ? winners[0].id : null,
        settled_count: winners.length, eligible_count: eligible.length,
        method, conducted_by: caller.id || null, notes: null,
      }
      db.prepare(`
        INSERT INTO chit_draws
          (id, scheme_id, cycle_no, draw_date, winner_member_id, settled_count, eligible_count, method, conducted_by, notes)
        VALUES (@id,@scheme_id,@cycle_no,@draw_date,@winner_member_id,@settled_count,@eligible_count,@method,@conducted_by,@notes)
      `).run(drawRow)
      enqueue.push({ table: 'chit_draws', id: drawId, row: drawRow, op: 'INSERT' })

      for (const winner of winners) {
        const principalRemaining = money(Number(scheme.chit_value) - Number(winner.contributions_paid || 0))
        const repayment = generateChitRepaymentSchedule(
          db, scheme, winner, principalRemaining,
          `${scheme.scheme_number}-M${winner.join_order}`
        )
        for (const item of repayment?.enqueue || []) enqueue.push({ ...item, op: 'INSERT' })

        db.prepare(`
          UPDATE chit_members
          SET redemption_type=?, won_cycle_no=?, product_received_at=date('now'),
              installment_id=?, status='redeemed', updated_at=datetime('now')
          WHERE id=?
        `).run(isFinalCycle ? 'final_batch' : 'draw', cycleNo, repayment?.installmentId || null, winner.id)
        enqueue.push({
          table: 'chit_members', id: String(winner.id), op: 'UPDATE',
          row: {
            id: winner.id, redemption_type: isFinalCycle ? 'final_batch' : 'draw',
            won_cycle_no: cycleNo, product_received_at: new Date().toISOString().slice(0, 10),
            installment_id: repayment?.installmentId || null, status: 'redeemed',
          },
        })
      }

      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: isFinalCycle ? 'CHIT_FINAL_SETTLEMENT' : 'CHIT_DRAW_CONDUCTED',
        tableName: 'chit_draws', recordId: drawId,
        newValues: { cycleNo, winnerCount: winners.length, method },
      })
    })()

    for (const item of enqueue) await enqueuSync(item.table, item.id, item.op, item.row)
    return { success: true, data: { drawId, isFinalCycle, settledCount: isFinalCycle ? eligible.length : 1 } }
  })

  safeHandle(ipcMain, 'chits:draws:list', (_e, schemeId: string) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT d.*, c.name as winner_name
      FROM chit_draws d
      LEFT JOIN chit_members m ON m.id = d.winner_member_id
      LEFT JOIN customers c ON c.id = m.customer_id
      WHERE d.scheme_id = ?
      ORDER BY d.cycle_no
    `).all(schemeId)
    return { success: true, data: rows }
  })

  // ── Early redemption ────────────────────────────────────────────────────
  safeHandle(ipcMain, 'chits:members:earlyRedeem', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!member.is_early_redemption) return { success: false, error: 'This member is not eligible for early redemption' }
    if (member.redemption_type) return { success: false, error: 'This member has already received their product' }

    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    const amount = money(Number(payload.amount) || 0)
    if (amount < Number(scheme.early_redemption_amount)) {
      return { success: false, error: `Early redemption requires at least Rs.${scheme.early_redemption_amount}` }
    }

    const contributionId = crypto.randomUUID()
    const enqueue: Array<{ table: string; id: string; row: Record<string, unknown>; op: 'INSERT' | 'UPDATE' }> = []

    db.transaction(() => {
      const commission = money(amount * resolveCommissionPct(db, member, scheme) / 100)
      const collectedByAgentId = payload.collected_by_agent_id !== undefined
        ? (payload.collected_by_agent_id || null)
        : (member.agent_id || null)
      const paidAt = payload.paid_at ? String(payload.paid_at) : new Date().toISOString()
      const contributionRow = {
        id: contributionId, scheme_id: member.scheme_id, member_id: memberId, cycle_no: null,
        contribution_type: 'early_redemption', amount, method: payload.method || 'cash',
        receipt_number: payload.receipt_number || null, reference: payload.reference || null,
        status: 'approved', received_by: caller.id || null, collected_by_agent_id: collectedByAgentId,
        branch_id: scheme.branch_id, commission_amount: commission, notes: payload.notes || null,
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
    return { success: true, data: { contributionId } }
  })

  // ── Contributions (pre-delivery waiting-period payments) ────────────────
  safeHandle(ipcMain, 'chits:contributions:record', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare('SELECT * FROM chit_members WHERE id=?').get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(member.scheme_id) as Record<string, unknown>
    if (!assertBranchScope(perms, caller, scheme.branch_id)) {
      return { success: false, error: 'You do not have access to this member' }
    }

    const amount = money(Number(payload.amount) || 0)
    if (amount <= 0) return { success: false, error: 'Enter a valid amount' }
    const method = String(payload.method || 'cash')
    const status = method === 'bank_transfer' ? 'pending_verification' : 'approved'
    const commission = money(amount * resolveCommissionPct(db, member, scheme) / 100)
    const contributionId = crypto.randomUUID()
    // Who physically collected the cash from the customer — defaults to the
    // member's own assigned agent, but can be overridden (a different agent
    // covering the visit). Distinct from received_by, the office user keying it in.
    const collectedByAgentId = payload.collected_by_agent_id !== undefined
      ? (payload.collected_by_agent_id || null)
      : (member.agent_id || null)
    // Backdatable for paper-record entry — defaults to now when omitted.
    const paidAt = payload.paid_at ? String(payload.paid_at) : new Date().toISOString()

    const row = {
      id: contributionId, scheme_id: member.scheme_id, member_id: memberId,
      cycle_no: payload.cycle_no || null, contribution_type: 'cycle', amount, method,
      receipt_number: payload.receipt_number || null, reference: payload.reference || null,
      status, received_by: caller.id || null, collected_by_agent_id: collectedByAgentId,
      branch_id: scheme.branch_id,
      commission_amount: status === 'approved' ? commission : 0, notes: payload.notes || null,
      paid_at: paidAt,
    }
    db.transaction(() => {
      db.prepare(`
        INSERT INTO chit_contributions
          (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number,
           reference, status, received_by, collected_by_agent_id, branch_id, commission_amount, notes, paid_at)
        VALUES (@id,@scheme_id,@member_id,@cycle_no,@contribution_type,@amount,@method,@receipt_number,
           @reference,@status,@received_by,@collected_by_agent_id,@branch_id,@commission_amount,@notes,@paid_at)
      `).run(row)
      if (status === 'approved') {
        db.prepare(`UPDATE chit_members SET contributions_paid=contributions_paid+?, updated_at=datetime('now') WHERE id=?`).run(amount, memberId)
      }
      logAudit(db, {
        userId: (caller.id as string) || null, branchId: (scheme.branch_id as string) || null,
        action: 'CHIT_CONTRIBUTION', tableName: 'chit_contributions', recordId: contributionId,
        newValues: { amount, method },
      })
    })()

    await enqueuSync('chit_contributions', contributionId, 'INSERT', row)
    if (status === 'approved') {
      await enqueuSync('chit_members', memberId, 'UPDATE', { id: memberId, contributions_paid: money(Number(member.contributions_paid || 0) + amount) })
    }
    return { success: true, data: { id: contributionId, status } }
  })

  safeHandle(ipcMain, 'chits:contributions:verify', async (_e, contributionId: string, action: 'approve' | 'reject', notes?: string) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const contribution = db.prepare('SELECT * FROM chit_contributions WHERE id=?').get(contributionId) as Record<string, unknown> | undefined
    if (!contribution) return { success: false, error: 'Contribution not found' }
    if (!assertBranchScope(perms, caller, contribution.branch_id)) {
      return { success: false, error: 'You do not have access to this contribution' }
    }

    if (action === 'reject') {
      db.prepare(`UPDATE chit_contributions SET status='rejected', verified_by=?, verified_at=datetime('now'), rejected_reason=?, updated_at=datetime('now') WHERE id=?`)
        .run(caller.id || null, notes || null, contributionId)
    } else {
      const scheme = db.prepare('SELECT * FROM chit_schemes WHERE id=?').get(contribution.scheme_id) as Record<string, unknown>
      const member = db.prepare('SELECT agent_id FROM chit_members WHERE id=?').get(contribution.member_id) as { agent_id?: unknown } | undefined
      const commission = money(Number(contribution.amount) * resolveCommissionPct(db, member, scheme) / 100)
      db.transaction(() => {
        db.prepare(`UPDATE chit_contributions SET status='approved', verified_by=?, verified_at=datetime('now'), commission_amount=?, updated_at=datetime('now') WHERE id=?`)
          .run(caller.id || null, commission, contributionId)
        db.prepare(`UPDATE chit_members SET contributions_paid=contributions_paid+?, updated_at=datetime('now') WHERE id=?`)
          .run(Number(contribution.amount), contribution.member_id)
      })()
    }

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (contribution.branch_id as string) || null,
      action: action === 'approve' ? 'CHIT_CONTRIBUTION_APPROVED' : 'CHIT_CONTRIBUTION_REJECTED',
      tableName: 'chit_contributions', recordId: contributionId, newValues: { notes },
    })
    await enqueuSync('chit_contributions', contributionId, 'UPDATE', {
      id: contributionId, status: action === 'approve' ? 'approved' : 'rejected',
      verified_by: caller.id || null, rejected_reason: notes || null,
    })
    if (action === 'approve') {
      await enqueuSync('chit_members', String(contribution.member_id), 'UPDATE', { id: contribution.member_id })
    }
    return { success: true }
  })

  safeHandle(ipcMain, 'chits:contributions:pendingTransfers', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
    const conditions = [`cc.status = 'pending_verification'`]
    const params: unknown[] = []
    if (filters.scheme_id) { conditions.push('cc.scheme_id = ?'); params.push(filters.scheme_id) }
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
  safeHandle(ipcMain, 'chits:reports', (_e, filters: { schemeId?: string; branchId?: string; dateFrom?: string; dateTo?: string } = {}) => {
    const db = getDb()
    const conditions: string[] = []
    const params: unknown[] = []
    if (filters.schemeId) { conditions.push('cs.id = ?'); params.push(filters.schemeId) }
    if (filters.branchId) { conditions.push('cs.branch_id = ?'); params.push(filters.branchId) }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = db.prepare(`
      SELECT cs.id, cs.scheme_number, cs.name, cs.member_count, cs.cycle_count, cs.chit_value, cs.status,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status != 'withdrawn') as members_enrolled,
        (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = cs.id AND m.status = 'redeemed') as members_redeemed,
        (SELECT COUNT(*) FROM chit_draws d WHERE d.scheme_id = cs.id) as cycles_completed,
        (SELECT COALESCE(SUM(amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as contributions_collected,
        (SELECT COALESCE(SUM(commission_amount),0) FROM chit_contributions c WHERE c.scheme_id = cs.id AND c.status = 'approved') as commission_accrued,
        cs.next_draw_date
      FROM chit_schemes cs
      ${where}
      ORDER BY cs.created_at DESC
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
        GROUP_CONCAT(DISTINCT cs.name) as scheme_names,
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
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (branchId) { conditions.push('a.branch_id = ?'); params.push(branchId) }
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
        (SELECT COALESCE(SUM(cc.commission_amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = a.id AND cc.status = 'approved') as commission_earned,
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
    const agent = db.prepare(`
      SELECT a.*, b.name as branch_name FROM agents a LEFT JOIN branches b ON b.id = a.branch_id WHERE a.id = ?
    `).get(agentId) as Record<string, unknown> | undefined
    if (!agent) return { success: false, error: 'Agent not found' }
    if (!assertBranchScope(perms, caller, agent.branch_id)) {
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
        (SELECT COALESCE(SUM(cc.commission_amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = ? AND cc.status = 'approved') as commission_earned,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc
          WHERE cc.collected_by_agent_id = ? AND cc.status = 'approved' AND cc.method = 'cash') as total_cash_collected,
        (SELECT COALESCE(SUM(r.amount), 0) FROM agent_remittances r WHERE r.agent_id = ?) as total_remitted
    `).get(agentId, agentId, agentId, agentId) as Record<string, unknown>

    stats.cash_balance = money(Number(stats.total_cash_collected || 0) - Number(stats.total_remitted || 0))

    const remittances = db.prepare(`
      SELECT r.*, u.name as received_by_name FROM agent_remittances r
      LEFT JOIN users u ON u.id = r.received_by
      WHERE r.agent_id = ? ORDER BY r.submitted_at DESC
    `).all(agentId)

    return { success: true, data: { agent, members, stats, remittances } }
  })

  // Every individual contribution row for one member — the payment history
  // ledger (date/amount/method/receipt/who collected/who recorded).
  safeHandle(ipcMain, 'chits:members:contributionHistory', (_e, memberId: string) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    const member = db.prepare(`
      SELECT m.id, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id = ?
    `).get(memberId) as { id: string; branch_id: unknown } | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertBranchScope(perms, caller, member.branch_id)) {
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

  // ── Agent cash remittance / settlement ──────────────────────────────────
  safeHandle(ipcMain, 'chits:remittances:record', async (_e, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const agentId = String(payload.agent_id || '')
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
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const conditions: string[] = []
    const params: unknown[] = []
    if (filters.agentId) { conditions.push('r.agent_id = ?'); params.push(filters.agentId) }
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
  safeHandle(ipcMain, 'chits:members:recordRedemption', async (_e, memberId: string, payload: Record<string, unknown>) => {
    const perms = currentPerms()
    if (!canManage(perms)) return { success: false, error: 'Customer management access required' }

    const db = getDb()
    const caller = authUser()
    const member = db.prepare(`
      SELECT m.*, cs.branch_id FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id WHERE m.id=?
    `).get(memberId) as Record<string, unknown> | undefined
    if (!member) return { success: false, error: 'Member not found' }
    if (!assertBranchScope(perms, caller, member.branch_id)) {
      return { success: false, error: 'You do not have access to this member' }
    }
    if (!member.redemption_type) return { success: false, error: 'This member has not received their product yet' }

    const productId = payload.product_id ? String(payload.product_id) : null
    const productName = String(payload.product_name || '').trim()
    if (!productName) return { success: false, error: 'Product name is required' }
    const qty = Math.max(1, Number(payload.qty) || 1)
    const value = payload.value !== undefined ? money(Number(payload.value) || 0) : null

    db.prepare(`
      UPDATE chit_members
      SET redeemed_product_id=?, redeemed_product_name=?, redeemed_qty=?, redeemed_value=?, updated_at=datetime('now')
      WHERE id=?
    `).run(productId, productName, qty, value, memberId)

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (member.branch_id as string) || null,
      action: 'CHIT_REDEMPTION_RECORDED', tableName: 'chit_members', recordId: memberId,
      newValues: { productId, productName, qty, value },
    })

    await enqueuSync('chit_members', memberId, 'UPDATE', {
      id: memberId, redeemed_product_id: productId, redeemed_product_name: productName,
      redeemed_qty: qty, redeemed_value: value,
    })
    return { success: true }
  })

  // ── Smart Buy Dashboard: everything on one screen ───────────────────────
  safeHandle(ipcMain, 'chits:dashboard', (_e, filters: { branchId?: string } = {}) => {
    const db = getDb()
    const caller = authUser()
    const perms = currentPerms(caller)
    const branchId = resolveScopedBranchId(perms, caller, filters.branchId)
    const schemeWhere = branchId ? 'WHERE cs.branch_id = ?' : ''
    const schemeParams = branchId ? [branchId] : []

    const stats = db.prepare(`
      SELECT
        (SELECT COUNT(*) FROM chit_schemes cs ${schemeWhere ? schemeWhere + " AND cs.status='active'" : "WHERE cs.status='active'"}) as active_schemes,
        (SELECT COUNT(*) FROM chit_members m JOIN chit_schemes cs ON cs.id = m.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} m.status != 'withdrawn') as members_enrolled,
        (SELECT COALESCE(SUM(cc.amount), 0) FROM chit_contributions cc JOIN chit_schemes cs ON cs.id = cc.scheme_id
          ${schemeWhere} ${schemeWhere ? 'AND' : 'WHERE'} cc.status = 'approved'
          AND strftime('%Y-%m', cc.paid_at) = strftime('%Y-%m', 'now')) as collected_this_month
    `).get(...schemeParams, ...schemeParams, ...schemeParams) as Record<string, unknown>

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

    const recentDraws = db.prepare(`
      SELECT d.cycle_no, d.draw_date, d.method, cs.name as scheme_name, cs.scheme_number,
        c.name as winner_name, wm.redeemed_product_name, wm.redeemed_qty, wm.contributions_paid
      FROM chit_draws d
      JOIN chit_schemes cs ON cs.id = d.scheme_id
      LEFT JOIN chit_members wm ON wm.id = d.winner_member_id
      LEFT JOIN customers c ON c.id = wm.customer_id
      ${schemeWhere}
      ORDER BY d.draw_date DESC
      LIMIT 10
    `).all(...schemeParams)

    return {
      success: true,
      data: {
        ...stats,
        pending_remittance_total: money(pendingRemittanceTotal),
        agents_with_balance: agentsWithBalance.slice(0, 10),
        recent_draws: recentDraws,
      },
    }
  })
}
