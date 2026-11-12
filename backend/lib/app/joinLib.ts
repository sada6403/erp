// Smart Buy join requests: shared by the app (agent initiated / customer self join) and the POS review screens.
import { randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import { fail, only, optStr, reqStr, toIso } from './http'
import { getModules } from './settings'
import { maskPhone, normalizePhone } from './security'
import { enqueueNotification } from './notify'
import { deletePrivateImage } from './privateFiles'
import type { JoinRequestDto } from './contracts/smartbuy'
import type { AdminJoinRequestDto, AdminJoinDecisionResponse } from './contracts/admin'
import type { AppRole } from './contracts/common'

export const JOIN_FIELDS = ['scheme_id', 'full_name', 'phone', 'nic_number', 'address', 'notes', 'client_event_id']
const NIC_RE = /^(\d{9}[VvXx]|\d{12})$/

function isDup(e: unknown): boolean {
  return /ER_DUP_ENTRY|Duplicate entry/i.test(String((e as Error)?.message ?? e))
}

export function joinDto(r: Record<string, unknown>): JoinRequestDto {
  const status = String(r.status) as JoinRequestDto['status']
  return {
    id: String(r.id), source: String(r.source) === 'agent' ? 'agent' : 'self', scheme_id: String(r.scheme_id), scheme_name: String(r.scheme_name ?? ''),
    full_name: String(r.full_name), phone_masked: maskPhone(String(r.phone)), status,
    reject_reason: status === 'rejected' && r.reject_reason ? String(r.reject_reason) : null,
    created_at: toIso(r.created_at) ?? '', decided_at: toIso(r.decided_at),
  }
}

/** Same rule as the POS: enrollment is closed outside the scheme's registration window (Colombo day). */
function registrationError(s: Record<string, unknown>): string | null {
  const today = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10)
  const start = toIso(s.registration_start_date)?.slice(0, 10), end = toIso(s.registration_end_date)?.slice(0, 10)
  if (start && today < start) return `Registration for this scheme opens on ${start}`
  if (end && today > end) return `Registration for this scheme closed on ${end}`
  return null
}
const capacityOf = (s: Record<string, unknown>) => Number(s.max_customers || s.member_count)

/** NIC photos and NIC numbers are personal data: wiped this many days after approval/rejection (approved data lives in the POS customer). */
export const JOIN_RETENTION_DAYS = 30
const lastPurge = new Map<string, number>()

/**
 * Lazy retention (no scheduler needed): runs when the POS opens the list, and at most every 10 minutes when requests are submitted.
 * Removes the NIC number and both photos; name, phone, scheme and decision stay so the request history is still readable.
 */
export async function purgeJoinRetention(company: AppCompany, throttle = false): Promise<number> {
  if (throttle && Date.now() - (lastPurge.get(company.id) ?? 0) < 10 * 60_000) return 0
  lastPurge.set(company.id, Date.now())
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, nic_front_ref, nic_back_ref FROM smartbuy_join_requests
      WHERE status <> 'pending' AND purged_at IS NULL AND decided_at IS NOT NULL AND decided_at < DATE_SUB(NOW(), INTERVAL ${JOIN_RETENTION_DAYS} DAY) LIMIT 200`)
  for (const r of rows) {
    await deletePrivateImage(r.nic_front_ref ? String(r.nic_front_ref) : null)
    await deletePrivateImage(r.nic_back_ref ? String(r.nic_back_ref) : null)
    await company.tp.query(`UPDATE smartbuy_join_requests SET nic_number = '', nic_front_ref = NULL, nic_back_ref = NULL, purged_at = NOW() WHERE id = ?`, [String(r.id)])
  }
  return rows.length
}

const SELECT_JOIN = `SELECT j.*, s.name AS scheme_name FROM smartbuy_join_requests j LEFT JOIN chit_schemes s ON s.id = j.scheme_id`

/** Create a request. Returns { created:false } when the same client_event_id was already submitted (idempotent replay). */
export async function submitJoinRequest(
  company: AppCompany, user: AppUserCtx, fields: Record<string, string>, nicFrontRef: () => Promise<string>, nicBackRef: () => Promise<string>
): Promise<{ created: boolean; dto: JoinRequestDto }> {
  if (!(await getModules(company)).smartbuy) fail(403, 'MODULE_DISABLED', 'Smart Buy is not available.')
  await purgeJoinRetention(company, true).catch(() => 0)
  only(fields, JOIN_FIELDS)
  const eventId = reqStr(fields.client_event_id, 'client_event_id', 8, 64)
  const prior = await company.tp.query<Record<string, unknown>>(`${SELECT_JOIN} WHERE j.submitted_by_user_id = ? AND j.client_event_id = ?`, [user.userId, eventId])
  if (prior.rows[0]) return { created: false, dto: joinDto(prior.rows[0]) }

  const schemeId = reqStr(fields.scheme_id, 'scheme_id', 1, 191)
  const fullName = reqStr(fields.full_name, 'full_name', 2, 255)
  const phone = normalizePhone(reqStr(fields.phone, 'phone', 7, 20))
  if (!phone) fail(400, 'VALIDATION', 'Enter a valid mobile number (07XXXXXXXX)')
  const nic = reqStr(fields.nic_number, 'nic_number', 10, 12).toUpperCase()
  if (!NIC_RE.test(nic)) fail(400, 'VALIDATION', 'Enter a valid NIC number')
  const address = optStr(fields.address, 'address', 512)
  const notes = optStr(fields.notes, 'notes', 500)

  const sch = await company.tp.query<Record<string, unknown>>(`SELECT id, status, member_count, max_customers, registration_start_date, registration_end_date FROM chit_schemes WHERE id = ? LIMIT 1`, [schemeId])
  const scheme = sch.rows[0]
  if (!scheme || String(scheme.status) !== 'active') fail(404, 'NOT_FOUND', 'This scheme is not open for joining.')

  const closed = registrationError(scheme)
  if (closed) fail(409, 'CONFLICT', closed)
  // Cloud customers carry no NIC column (the POS keeps it locally), so membership is matched by phone here.
  const member = await company.tp.query(
    `SELECT 1 FROM chit_members m JOIN customers c ON c.id = m.customer_id WHERE m.scheme_id = ? AND m.status <> 'withdrawn' AND c.phone = ? LIMIT 1`,
    [schemeId, phone])
  if (member.rows[0]) fail(409, 'ALREADY_MEMBER', 'This person is already a member of the scheme.')
  const dupe = await company.tp.query(
    `SELECT 1 FROM smartbuy_join_requests WHERE scheme_id = ? AND status = 'pending' AND (phone = ? OR nic_number = ?) LIMIT 1`, [schemeId, phone, nic])
  if (dupe.rows[0]) fail(409, 'CONFLICT', 'A request for this person is already waiting for approval.')
  const taken = await company.tp.query<{ n: number }>(
    `SELECT (SELECT COUNT(*) FROM chit_members WHERE scheme_id = ? AND status <> 'withdrawn') + (SELECT COUNT(*) FROM smartbuy_join_requests WHERE scheme_id = ? AND status = 'pending') AS n`,
    [schemeId, schemeId])
  if (Number(taken.rows[0]?.n) >= capacityOf(scheme)) fail(409, 'SCHEME_FULL', 'This scheme is full.')

  const front = await nicFrontRef(), back = await nicBackRef()
  const id = randomUUID()
  const source = user.agentId ? 'agent' : 'self'
  try {
    await company.tp.query(
      `INSERT INTO smartbuy_join_requests (id, source, submitted_by_user_id, agent_id, customer_id, scheme_id, full_name, phone, nic_number, address, notes, nic_front_ref, nic_back_ref, client_event_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, source, user.userId, user.agentId, source === 'self' ? user.customerId : null, schemeId, fullName, phone, nic, address, notes, front, back, eventId])
  } catch (e) {
    if (!isDup(e)) throw e
    const again = await company.tp.query<Record<string, unknown>>(`${SELECT_JOIN} WHERE j.submitted_by_user_id = ? AND j.client_event_id = ?`, [user.userId, eventId])
    if (again.rows[0]) return { created: false, dto: joinDto(again.rows[0]) }
    throw e
  }
  const row = await company.tp.query<Record<string, unknown>>(`${SELECT_JOIN} WHERE j.id = ?`, [id])
  return { created: true, dto: joinDto(row.rows[0]) }
}

export async function adminJoinList(company: AppCompany, status: string | null): Promise<AdminJoinRequestDto[]> {
  await purgeJoinRetention(company).catch(() => 0)
  const where = status && ['pending', 'approved', 'rejected'].includes(status) ? `WHERE j.status = ?` : ''
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT j.*, s.name AS scheme_name, a.code AS agent_code, a.name AS agent_name
       FROM smartbuy_join_requests j LEFT JOIN chit_schemes s ON s.id = j.scheme_id LEFT JOIN agents a ON a.id = j.agent_id
       ${where} ORDER BY (j.status = 'pending') DESC, j.created_at DESC LIMIT 300`, where ? [status] : [])
  return rows.map(r => ({
    id: String(r.id), source: String(r.source) === 'agent' ? 'agent' as const : 'self' as const,
    agent_code: r.agent_code ? String(r.agent_code) : null, agent_name: r.agent_name ? String(r.agent_name) : null,
    scheme_id: String(r.scheme_id), scheme_name: String(r.scheme_name ?? ''), full_name: String(r.full_name), phone: String(r.phone),
    nic_number: String(r.nic_number), address: r.address ? String(r.address) : null, notes: r.notes ? String(r.notes) : null,
    has_nic_front: !!r.nic_front_ref, has_nic_back: !!r.nic_back_ref, customer_id: r.customer_id ? String(r.customer_id) : null,
    status: String(r.status) as AdminJoinRequestDto['status'], reject_reason: r.reject_reason ? String(r.reject_reason) : null,
    decided_by: r.decided_by ? String(r.decided_by) : null, decided_at: toIso(r.decided_at), member_id: r.member_id ? String(r.member_id) : null,
    created_at: toIso(r.created_at) ?? '',
  }))
}

/**
 * Approve = create (or reuse) the customer and the chit member in ONE transaction, exactly like the POS "add member":
 * same columns, next join_order, agent_id carried over so the agent keeps the credit. The rows sync down to the POS.
 */
export async function decideJoinRequest(
  company: AppCompany, id: string, decision: 'approve' | 'reject', reason: string | null, decidedBy: string | null
): Promise<AdminJoinDecisionResponse> {
  if (decision === 'reject' && !reason) fail(400, 'VALIDATION', 'A reason is required to reject.')
  const conn = await company.tp.connect()
  let memberId: string | null = null, customerId: string | null = null
  let submitter = '', requestPhone = ''
  try {
    await conn.query('START TRANSACTION')
    const jr = await conn.query<Record<string, unknown>>(`SELECT * FROM smartbuy_join_requests WHERE id = ? FOR UPDATE`, [id])
    const r = jr.rows[0]
    if (!r) { await conn.query('ROLLBACK'); fail(404, 'NOT_FOUND', 'Join request not found') }
    if (String(r.status) !== 'pending') { await conn.query('ROLLBACK'); fail(409, 'CONFLICT', `This request was already ${String(r.status)}.`) }
    submitter = String(r.submitted_by_user_id); requestPhone = String(r.phone)

    if (decision === 'approve') {
      const sch = await conn.query<Record<string, unknown>>(`SELECT * FROM chit_schemes WHERE id = ? FOR UPDATE`, [String(r.scheme_id)])
      const scheme = sch.rows[0]
      if (!scheme || !['active', 'pending'].includes(String(scheme.status))) { await conn.query('ROLLBACK'); fail(409, 'CONFLICT', 'The scheme is not open for new members.') }
      const cnt = await conn.query<Record<string, unknown>>(
        `SELECT COUNT(*) AS n, COALESCE(MAX(join_order), 0) AS m FROM chit_members WHERE scheme_id = ? AND status <> 'withdrawn'`, [String(r.scheme_id)])
      const closed = registrationError(scheme)
      if (closed) { await conn.query('ROLLBACK'); fail(409, 'CONFLICT', closed) }
      if (Number(cnt.rows[0].n) >= capacityOf(scheme)) { await conn.query('ROLLBACK'); fail(409, 'SCHEME_FULL', 'This scheme is full.') }
      const maxOrder = await conn.query<Record<string, unknown>>(`SELECT COALESCE(MAX(join_order), 0) AS m FROM chit_members WHERE scheme_id = ?`, [String(r.scheme_id)])
      const nextOrder = Number(maxOrder.rows[0].m) + 1

      // Customer: the one the self-join user already has, else same NIC / phone, else a new record.
      customerId = r.customer_id ? String(r.customer_id) : null
      if (!customerId) {
        const ex = await conn.query<Record<string, unknown>>(`SELECT id FROM customers WHERE phone = ? ORDER BY created_at LIMIT 1`, [requestPhone])
        customerId = ex.rows[0] ? String(ex.rows[0].id) : null
      }
      const agentBranch = r.agent_id ? await conn.query<Record<string, unknown>>(`SELECT branch_id FROM agents WHERE id = ?`, [String(r.agent_id)]) : null
      const branchId = (agentBranch?.rows[0]?.branch_id ? String(agentBranch.rows[0].branch_id) : null) ?? (scheme.branch_id ? String(scheme.branch_id) : null)
      if (!customerId) {
        customerId = randomUUID()
        await conn.query(
          `INSERT INTO customers (id, name, phone, address) VALUES (?, ?, ?, ?)`,
          [customerId, String(r.full_name), requestPhone, r.address ? String(r.address) : null])
      }
      const dup = await conn.query(`SELECT 1 FROM chit_members WHERE scheme_id = ? AND customer_id = ? LIMIT 1`, [String(r.scheme_id), customerId])
      if (dup.rows[0]) { await conn.query('ROLLBACK'); fail(409, 'ALREADY_MEMBER', 'This person is already a member of the scheme.') }
      memberId = randomUUID()
      await conn.query(
        `INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, is_early_redemption, contributions_paid, status, enrolled_branch_id)
         VALUES (?, ?, ?, ?, ?, ?, 0, 'active', ?)`,
        [memberId, String(r.scheme_id), customerId, r.agent_id ? String(r.agent_id) : null, nextOrder,
         nextOrder <= Number(scheme.early_redemption_count ?? 0) ? 1 : 0, branchId])
      // Same activation rule as the POS: a pending scheme becomes active once min_members is reached.
      if (String(scheme.status) === 'pending' && Number(cnt.rows[0].n) + 1 >= Number(scheme.min_members ?? 1)) {
        await conn.query(`UPDATE chit_schemes SET status = 'active' WHERE id = ?`, [String(r.scheme_id)])
      }
      await conn.query(
        `UPDATE smartbuy_join_requests SET status = 'approved', decided_by = ?, decided_at = NOW(), member_id = ?, customer_id = ? WHERE id = ?`,
        [decidedBy, memberId, customerId, id])
    } else {
      await conn.query(`UPDATE smartbuy_join_requests SET status = 'rejected', reject_reason = ?, decided_by = ?, decided_at = NOW() WHERE id = ?`, [reason, decidedBy, id])
    }
    await conn.query('COMMIT')
  } catch (e) {
    try { await conn.query('ROLLBACK') } catch { /* already rolled back */ }
    throw e
  } finally {
    conn.release()
  }

  // After commit: give a self-join user the smartbuy role, and tell the submitter (never NIC / phone in the text).
  if (decision === 'approve' && customerId) {
    const u = await company.tp.query<Record<string, unknown>>(`SELECT id, roles, customer_id FROM app_users WHERE id = ? LIMIT 1`, [submitter])
    const own = u.rows[0]
    if (own && (!own.customer_id || String(own.customer_id) === customerId)) {
      let roles: AppRole[] = []
      try { roles = JSON.parse(String(own.roles || '[]')) } catch { roles = [] }
      if (roles.includes('customer') && !roles.includes('smartbuy')) {
        await company.tp.query(`UPDATE app_users SET roles = ?, customer_id = COALESCE(customer_id, ?) WHERE id = ?`, [JSON.stringify([...roles, 'smartbuy']), customerId, submitter])
      }
    }
  }
  await enqueueNotification(company.tp, {
    userId: submitter, type: 'account', channel: 'smartbuy',
    title: decision === 'approve' ? 'Smart Buy request approved' : 'Smart Buy request not approved',
    body: decision === 'approve' ? 'A Smart Buy join request you submitted was approved.' : `A Smart Buy join request was not approved: ${reason}`,
    dedupeKey: `join:${id}:${decision}`,
  }).catch(() => undefined)
  return { ok: true, status: decision === 'approve' ? 'approved' : 'rejected', member_id: memberId, customer_id: customerId }
}
