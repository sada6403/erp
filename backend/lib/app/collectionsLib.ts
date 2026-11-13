// Smart Buy cash collection by agents (app side). The app only ever creates a chit_contributions row in status
// 'pending_verification' (method cash, collected_by_agent_id = the caller); the branch approves or rejects it in the POS with the
// existing chits:contributions:verify path, which is the single authority for member totals, credit and late fees.
// Due / late-fee figures here are a display port (collectionMath.ts) of the POS functions.
import { randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import { colomboDayRange } from './staffLib'
import { fail, optStr, reqStr, round2, toIso } from './http'
import { enqueueNotification } from './notify'
import { quoteCycle, type SchemeTerms } from './collectionMath'
import type { DbLike } from './catalogLib'
import type { CollectionDto, CollectionsTodayResponse, MemberDueDto, ReceiptDto } from './contracts/collections'

type Row = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const RECEIPT = /^[A-Za-z0-9][A-Za-z0-9-]{2,63}$/
const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const MAX_AGE_MS = 30 * 24 * 3600 * 1000

const termsOf = (s: Row): SchemeTerms => ({
  contribution_amount: Number(s.contribution_amount) || 0,
  start_date: String(s.start_date instanceof Date ? s.start_date.toISOString() : s.start_date).slice(0, 10),
  late_payment_days: Number(s.late_payment_days) || 0,
  late_fee_amount: Number(s.late_fee_amount) || 0,
  frequency: String(s.frequency || 'monthly'),
})

type CycleAgg = { approvedPaid: number; creditUsed: number; feeCharged: number; pendingPrincipal: number }
const empty = (): CycleAgg => ({ approvedPaid: 0, creditUsed: 0, feeCharged: 0, pendingPrincipal: 0 })

/** Cycle figures per member, exactly as the POS reads them (approved rows count; pending rows only for the fee dedupe and for display). */
async function loadCycles(company: AppCompany, memberIds: string[]) {
  const byMember = new Map<string, Map<number, CycleAgg>>()
  const last = new Map<string, { at: string | null; amount: number }>()
  if (!memberIds.length) return { byMember, last }
  const { rows } = await company.tp.query<Row>(
    `SELECT member_id, cycle_no, status, contribution_type, amount, late_fee_applied, credit_applied, paid_at FROM chit_contributions
      WHERE member_id IN (?) AND status IN ('approved','pending_verification')`, [memberIds])
  for (const r of rows) {
    const mid = String(r.member_id)
    const at = toIso(r.paid_at)
    const prev = last.get(mid)
    if (!prev || (at && prev.at && at > prev.at) || !prev.at) last.set(mid, { at, amount: Number(r.amount) || 0 })
    if (String(r.contribution_type) !== 'cycle' || r.cycle_no == null) continue
    const cyc = byMember.get(mid) ?? new Map<number, CycleAgg>()
    byMember.set(mid, cyc)
    const a = cyc.get(Number(r.cycle_no)) ?? empty()
    cyc.set(Number(r.cycle_no), a)
    const fee = Number(r.late_fee_applied) || 0
    const principal = (Number(r.amount) || 0) - fee
    a.feeCharged += fee
    if (String(r.status) === 'approved') { a.approvedPaid += principal; a.creditUsed += Number(r.credit_applied) || 0 }
    else a.pendingPrincipal += principal
  }
  return { byMember, last }
}

/** Current cycle = next number after the highest drawn one (same rule as the POS). */
async function currentCycles(company: AppCompany, schemeIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!schemeIds.length) return out
  const { rows } = await company.tp.query<Row>(`SELECT scheme_id, MAX(cycle_no) AS m FROM chit_draws WHERE scheme_id IN (?) GROUP BY scheme_id`, [schemeIds])
  for (const r of rows) out.set(String(r.scheme_id), Number(r.m) || 0)
  return out
}

export type MemberCtx = { memberId: string; schemeId: string; terms: SchemeTerms; creditBalance: number; memberStatus: string; schemeStatus: string }

/** Due figures for many members at once (agent members list). `members` rows need: id, scheme_id, credit_balance, status and the scheme columns. */
export async function dueFor(company: AppCompany, members: Row[], now = new Date()): Promise<Map<string, MemberDueDto>> {
  const out = new Map<string, MemberDueDto>()
  if (!members.length) return out
  const cyc = await loadCycles(company, members.map(m => String(m.id)))
  const drawn = await currentCycles(company, [...new Set(members.map(m => String(m.scheme_id)))])
  for (const m of members) {
    const id = String(m.id)
    const terms = termsOf(m)
    const cycleNo = (drawn.get(String(m.scheme_id)) ?? 0) + 1
    const cycles = cyc.byMember.get(id) ?? new Map<number, CycleAgg>()
    const agg = cycles.get(cycleNo) ?? empty()
    const q = quoteCycle(terms, cycleNo, now.toISOString(), agg, Number(m.credit_balance) || 0)
    let arrears = 0
    for (let n = 1; n < cycleNo; n++) {
      const a = cycles.get(n) ?? empty()
      arrears += Math.max(0, terms.contribution_amount - a.approvedPaid - a.creditUsed - a.pendingPrincipal)
    }
    const lp = cyc.last.get(id)
    out.set(id, {
      cycle_no: cycleNo, due_date: q.dueDate, installment_amount: q.installmentAmount, settled: round2(q.paidPrincipal + q.creditAlreadyUsed),
      pending_amount: round2(agg.pendingPrincipal), balance_due: q.balanceDue, late_fee: q.lateFee, is_late: q.isLate,
      collectable: round2(Math.max(0, q.cashPrincipalDue - agg.pendingPrincipal) + q.lateFee),
      arrears: round2(arrears), last_payment_at: lp?.at ?? null, last_payment_amount: lp ? round2(lp.amount) : null,
      frequency: terms.frequency === 'weekly' ? 'weekly' : 'monthly',
    })
  }
  return out
}

const SELECT_MEMBER = `SELECT m.id, m.scheme_id, m.customer_id, m.agent_id, m.status, m.credit_balance, cu.name AS customer_name,
       s.name AS scheme_name, s.scheme_number, s.status AS scheme_status, s.branch_id, s.contribution_amount, s.start_date, s.late_payment_days, s.late_fee_amount, s.frequency
  FROM chit_members m JOIN chit_schemes s ON s.id = m.scheme_id LEFT JOIN customers cu ON cu.id = m.customer_id`

export function collectionDto(r: Row, balanceAfter: number): CollectionDto {
  return {
    id: String(r.id), receipt_number: String(r.receipt_number ?? ''), member_id: String(r.member_id), customer_name: String(r.customer_name || 'Member'),
    scheme_id: String(r.scheme_id), scheme_name: String(r.scheme_name || ''), cycle_no: r.cycle_no != null ? Number(r.cycle_no) : null,
    amount: round2(Number(r.amount) || 0), late_fee_applied: round2(Number(r.late_fee_applied) || 0),
    status: (['approved', 'rejected'].includes(String(r.status)) ? String(r.status) : 'pending_verification') as CollectionDto['status'],
    rejected_reason: r.rejected_reason ? String(r.rejected_reason) : null, collected_at: toIso(r.paid_at) as string,
    agent_code: r.agent_code ? String(r.agent_code) : null, agent_name: r.agent_name ? String(r.agent_name) : null, balance_after: balanceAfter,
  }
}

const LIST_SQL = `SELECT cc.id, cc.member_id, cc.scheme_id, cc.cycle_no, cc.amount, cc.late_fee_applied, cc.status, cc.rejected_reason, cc.paid_at, cc.receipt_number,
       cu.name AS customer_name, s.name AS scheme_name, s.scheme_number, s.branch_id, a.code AS agent_code, a.name AS agent_name
  FROM chit_contributions cc
  JOIN app_collections ac ON ac.contribution_id = cc.id
  JOIN chit_members m ON m.id = cc.member_id
  LEFT JOIN customers cu ON cu.id = m.customer_id
  JOIN chit_schemes s ON s.id = cc.scheme_id
  LEFT JOIN agents a ON a.id = cc.collected_by_agent_id`

/** Cycle balance still owed after the rows that exist now (approved + pending counted). */
async function balancesAfter(company: AppCompany, rows: Row[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  const ids = [...new Set(rows.map(r => String(r.member_id)))]
  if (!ids.length) return out
  const cyc = await loadCycles(company, ids)
  const sch = await company.tp.query<Row>(`SELECT id, contribution_amount FROM chit_schemes WHERE id IN (?)`, [[...new Set(rows.map(r => String(r.scheme_id)))]])
  const expected = new Map(sch.rows.map(s => [String(s.id), Number(s.contribution_amount) || 0]))
  for (const r of rows) {
    const a = r.cycle_no != null ? cyc.byMember.get(String(r.member_id))?.get(Number(r.cycle_no)) : undefined
    const owed = (expected.get(String(r.scheme_id)) ?? 0) - (a ? a.approvedPaid + a.creditUsed + a.pendingPrincipal : 0)
    out.set(String(r.id), round2(Math.max(0, owed)))
  }
  return out
}

function parseDate(v: unknown): Date {
  const d = new Date(String(v ?? ''))
  if (Number.isNaN(d.getTime())) fail(400, 'VALIDATION', 'collected_at must be an ISO date')
  return d
}

/** Idempotent on client_event_id (which is also the contribution id). Scope: only members assigned to the calling agent. */
export async function createCollection(company: AppCompany, user: AppUserCtx, agentId: string, b: Row): Promise<{ collection: CollectionDto; created: boolean }> {
  const eventId = reqStr(b.client_event_id, 'client_event_id', 36, 36).toLowerCase()
  if (!UUID.test(eventId)) fail(400, 'VALIDATION', 'client_event_id must be a UUID')
  const memberId = reqStr(b.member_id, 'member_id', 1, 64)
  const receipt = reqStr(b.receipt_number, 'receipt_number', 3, 64)
  if (!RECEIPT.test(receipt)) fail(400, 'VALIDATION', 'receipt_number may use letters, digits and dashes only')
  const amount = round2(Number(b.amount))
  if (!Number.isFinite(amount) || amount <= 0) fail(400, 'VALIDATION', 'Enter a valid amount')
  const collectedAt = parseDate(b.collected_at)
  if (collectedAt.getTime() > Date.now() + 5 * 60 * 1000) fail(400, 'VALIDATION', 'collected_at is in the future')
  if (collectedAt.getTime() < Date.now() - MAX_AGE_MS) fail(400, 'VALIDATION', 'collected_at is too old')
  const notes = optStr(b.notes, 'notes', 300)

  const replay = async (): Promise<{ collection: CollectionDto; created: boolean } | null> => {
    const prior = await company.tp.query<Row>(`${LIST_SQL} WHERE cc.id = ? LIMIT 1`, [eventId])
    if (!prior.rows[0]) return null
    const row = prior.rows[0]
    const owner = await company.tp.query<Row>(`SELECT agent_id FROM app_collections WHERE contribution_id = ?`, [eventId])
    if (String(owner.rows[0]?.agent_id) !== agentId) fail(409, 'CONFLICT', 'This collection id is already used')
    const bal = await balancesAfter(company, [row])
    return { collection: collectionDto(row, bal.get(String(row.id)) ?? 0), created: false }
  }
  const done = await replay()
  if (done) return done

  // Scope: the member must be assigned to THIS agent; anything else answers 404.
  const mem = await company.tp.query<Row>(`${SELECT_MEMBER} WHERE m.id = ? AND m.agent_id = ? LIMIT 1`, [memberId, agentId])
  const m = mem.rows[0]
  if (!m) fail(404, 'NOT_FOUND', 'Member not found')
  if (m.status === 'redeemed') fail(409, 'CONFLICT', 'This member has already received their product: nothing more is due')
  if (m.status === 'withdrawn') fail(409, 'CONFLICT', 'This member has withdrawn from the scheme')
  if (m.scheme_status !== 'active') {
    const prior = await company.tp.query<Row>(`SELECT COUNT(*) AS c FROM chit_contributions WHERE member_id = ? AND status = 'approved'`, [memberId])
    if (m.scheme_status !== 'pending' || Number(prior.rows[0]?.c) === 0) fail(409, 'CONFLICT', `Cannot collect on a ${String(m.scheme_status)} scheme`)
  }

  const due = (await dueFor(company, [m], collectedAt)).get(memberId)!
  if (due.collectable <= 0.009) fail(409, 'CONFLICT', 'Nothing is due for this cycle (it is paid or already waiting for verification)', { collectable: 0 })
  if (amount > due.collectable + 0.009) fail(409, 'CONFLICT', `The most that can be collected now is Rs ${due.collectable.toFixed(2)}`, { collectable: due.collectable })
  // The row follows the POS convention: amount = principal + late fee, late_fee_applied = the fee part (charged once per cycle).
  const lateFee = due.late_fee > 0 && amount > due.late_fee ? due.late_fee : 0
  const seq = /(\d{1,9})$/.exec(receipt)

  const conn = await company.tp.connect()
  try {
    await conn.query('START TRANSACTION')
    try {
      await conn.query(
        `INSERT INTO app_collections (contribution_id, agent_id, member_id, receipt_number, receipt_seq) VALUES (?,?,?,?,?)`,
        [eventId, agentId, memberId, receipt, seq ? Number(seq[1]) : null])
    } catch (e) {
      await conn.query('ROLLBACK')
      const msg = String((e as { message?: string }).message || '')
      if (/Duplicate entry/i.test(msg) && /receipt/i.test(msg)) fail(409, 'CONFLICT', 'This receipt number is already used', { receipt_number: receipt })
      if (/Duplicate entry/i.test(msg)) { const r = await replay(); if (r) return r }
      throw e
    }
    await conn.query(
      `INSERT INTO chit_contributions (id, scheme_id, member_id, cycle_no, contribution_type, amount, method, receipt_number, status, collected_by_agent_id,
          branch_id, commission_amount, credit_applied, late_fee_applied, notes, paid_at)
       VALUES (?,?,?,?, 'cycle', ?, 'cash', ?, 'pending_verification', ?, ?, 0, 0, ?, ?, ?)`,
      [eventId, m.scheme_id, memberId, due.cycle_no, amount, receipt, agentId, m.branch_id ?? null, lateFee,
        lateFee > 0 ? `${notes ? `${notes} - ` : ''}Includes Rs.${lateFee} late fee` : notes, fmt(collectedAt)])
    await conn.query('COMMIT')
  } catch (e) {
    try { await conn.query('ROLLBACK') } catch { /* already rolled back */ }
    throw e
  } finally {
    conn.release()
  }

  const row = (await company.tp.query<Row>(`${LIST_SQL} WHERE cc.id = ? LIMIT 1`, [eventId])).rows[0]
  const bal = await balancesAfter(company, [row])
  try {
    const u = m.customer_id ? await company.tp.query<Row>(`SELECT id FROM app_users WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1`, [String(m.customer_id)]) : { rows: [] as Row[] }
    if (u.rows[0]) {
      await enqueueNotification(company.tp, {
        userId: String(u.rows[0].id), type: 'system', channel: 'smartbuy', title: 'Payment received',
        body: `Rs ${amount.toFixed(2)} was received by your agent for ${String(m.scheme_name)}. It shows as pending until the branch verifies it. Receipt ${receipt}.`,
        dedupeKey: `collect:${eventId}:pending`,
        email: { type: 'cash_receipt', entityId: eventId, data: { scheme: String(m.scheme_name), amount, receipt } },
      })
    }
  } catch (e) { console.error('[collections] member notification failed', e) }
  return { collection: collectionDto(row, bal.get(eventId) ?? 0), created: true }
}

export async function collectionsToday(company: AppCompany, agentId: string): Promise<CollectionsTodayResponse> {
  const { from, to } = colomboDayRange()
  const today = await company.tp.query<Row>(`${LIST_SQL} WHERE cc.collected_by_agent_id = ? AND cc.paid_at >= ? AND cc.paid_at < ? ORDER BY cc.paid_at DESC LIMIT 300`, [agentId, from, to])
  const bal = await balancesAfter(company, today.rows)
  const items = today.rows.map(r => collectionDto(r, bal.get(String(r.id)) ?? 0))
  const sum = (s: string) => round2(items.filter(i => i.status === s).reduce((a, i) => a + i.amount, 0))
  const hold = await company.tp.query<Row>(
    `SELECT
       (SELECT COALESCE(SUM(amount),0) FROM chit_contributions WHERE collected_by_agent_id = ? AND method = 'cash' AND status IN ('approved','pending_verification')) AS collected,
       (SELECT COALESCE(SUM(amount),0) FROM chit_contributions WHERE collected_by_agent_id = ? AND method = 'cash' AND status = 'pending_verification') AS pending,
       (SELECT COALESCE(SUM(amount),0) FROM agent_remittances WHERE agent_id = ?) AS remitted,
       (SELECT COALESCE(MAX(receipt_seq),0) FROM app_collections WHERE agent_id = ?) AS last_seq`, [agentId, agentId, agentId, agentId])
  const h = hold.rows[0] ?? {}
  return {
    items,
    summary: {
      count: items.filter(i => i.status !== 'rejected').length, total: round2(items.filter(i => i.status !== 'rejected').reduce((a, i) => a + i.amount, 0)),
      pending_total: sum('pending_verification'), approved_total: sum('approved'), rejected_total: sum('rejected'),
      cash_in_hand: round2(Math.max(0, Number(h.collected) - Number(h.remitted))), pending_remittance: round2(Number(h.pending) || 0),
    },
    last_receipt_seq: Number(h.last_seq) || 0,
  }
}

export async function receiptFor(company: AppCompany, agentId: string, id: string): Promise<ReceiptDto> {
  // Own collections only: someone else's id is a 404.
  const r = await company.tp.query<Row>(`${LIST_SQL} WHERE cc.id = ? AND cc.collected_by_agent_id = ? LIMIT 1`, [id, agentId])
  const row = r.rows[0]
  if (!row) fail(404, 'NOT_FOUND', 'Receipt not found')
  const bal = await balancesAfter(company, [row])
  const br = row.branch_id ? await company.tp.query<Row>(`SELECT name FROM branches WHERE id = ? LIMIT 1`, [String(row.branch_id)]) : { rows: [] as Row[] }
  return { ...collectionDto(row, bal.get(String(row.id)) ?? 0), company_name: company.name, branch_name: br.rows[0] ? String(br.rows[0].name) : null, scheme_number: row.scheme_number ? String(row.scheme_number) : null }
}

/** Called after the POS pushed a contribution row: tells the member "paid" and the agent the outcome (once per outcome). */
export async function onContributionStatusChanged(db: DbLike, contributionId: string): Promise<void> {
  const { rows } = await db.query<Row>(
    `SELECT cc.status, cc.amount, cc.receipt_number, cc.rejected_reason, cc.collected_by_agent_id, m.customer_id, s.name AS scheme_name
       FROM app_collections ac JOIN chit_contributions cc ON cc.id = ac.contribution_id JOIN chit_members m ON m.id = cc.member_id JOIN chit_schemes s ON s.id = cc.scheme_id
      WHERE ac.contribution_id = ? LIMIT 1`, [contributionId])
  const c = rows[0]
  if (!c || !['approved', 'rejected'].includes(String(c.status))) return
  const status = String(c.status)
  const amt = `Rs ${(Number(c.amount) || 0).toFixed(2)}`
  const member = c.customer_id ? await db.query<Row>(`SELECT id FROM app_users WHERE customer_id = ? AND deleted_at IS NULL LIMIT 1`, [String(c.customer_id)]) : { rows: [] as Row[] }
  if (member.rows[0]) {
    await enqueueNotification(db, status === 'approved'
      ? { userId: String(member.rows[0].id), type: 'system', channel: 'smartbuy', title: 'Payment confirmed', body: `Your payment of ${amt} for ${String(c.scheme_name)} is confirmed. Receipt ${String(c.receipt_number)}.`, dedupeKey: `collect:${contributionId}:approved` }
      : { userId: String(member.rows[0].id), type: 'system', channel: 'smartbuy', title: 'Payment not confirmed', body: `Your payment of ${amt} for ${String(c.scheme_name)} could not be confirmed. Please contact your agent or branch.`, dedupeKey: `collect:${contributionId}:rejected` })
  }
  if (status === 'rejected' && c.collected_by_agent_id) {
    const ag = await db.query<Row>(`SELECT id FROM app_users WHERE agent_id = ? AND deleted_at IS NULL LIMIT 1`, [String(c.collected_by_agent_id)])
    if (ag.rows[0]) {
      await enqueueNotification(db, {
        userId: String(ag.rows[0].id), type: 'system', channel: 'smartbuy', title: 'Collection rejected',
        body: `Receipt ${String(c.receipt_number)} (${amt}) was rejected${c.rejected_reason ? `: ${String(c.rejected_reason)}` : ''}.`, dedupeKey: `collect:${contributionId}:rejected:agent`,
      })
    }
  }
}
