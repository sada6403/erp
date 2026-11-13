// Sales force v1.0: hierarchy scope, team performance, targets, field visits.
// Hierarchy comes ONLY from staff_assignments (never from the client, never from the JWT). Scope is re-resolved on every request.
// Out-of-scope ids answer 404. Mutations only on STRICT descendants, each with an audit_logs row.
import { randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import { fail, optNum, optStr, oneOf, reqStr, round2, toIso } from './http'

export const LEVELS = {
  director: 1, agm: 2, manager: 3, zonal_manager: 4, regional_manager: 5, branch_manager: 6, field_officer: 7,
} as const
export type LevelKey = keyof typeof LEVELS
export const LEVEL_KEYS = Object.keys(LEVELS) as LevelKey[]
export const VISIT_OUTCOMES = ['purchased', 'not_interested', 'come_back', 'not_at_home', 'already_member'] as const

type Row = Record<string, unknown>
type Org = {
  byStaff: Map<string, { id: string; staffId: string; level: LevelKey; rank: number; scopeType: string; scopeId: string | null; reportsTo: string | null }>
  children: Map<string, string[]>
}

/** All currently active assignments (a company has at most a few hundred staff). */
export async function loadOrg(company: AppCompany): Promise<Org> {
  const { rows } = await company.tp.query<Row>(
    `SELECT id, staff_id, level_key, scope_type, scope_id, reports_to_staff_id FROM staff_assignments
      WHERE active_from <= NOW() AND (active_to IS NULL OR active_to > NOW())`)
  const byStaff: Org['byStaff'] = new Map()
  for (const r of rows) {
    const level = String(r.level_key) as LevelKey
    if (!(level in LEVELS)) continue
    byStaff.set(String(r.staff_id), { id: String(r.id), staffId: String(r.staff_id), level, rank: LEVELS[level], scopeType: String(r.scope_type), scopeId: r.scope_id ? String(r.scope_id) : null, reportsTo: r.reports_to_staff_id ? String(r.reports_to_staff_id) : null })
  }
  const children: Org['children'] = new Map()
  for (const a of byStaff.values()) {
    // a report must rank strictly below the boss: a bad row can never create a loop or an upward link
    const boss = a.reportsTo ? byStaff.get(a.reportsTo) : undefined
    if (!boss || boss.rank >= a.rank) continue
    children.set(boss.staffId, [...(children.get(boss.staffId) ?? []), a.staffId])
  }
  return { byStaff, children }
}

export function descendantsOf(org: Org, staffId: string): string[] {
  const out: string[] = []; const seen = new Set<string>([staffId]); const queue = [staffId]
  while (queue.length) {
    for (const c of org.children.get(queue.shift() as string) ?? []) { if (!seen.has(c)) { seen.add(c); out.push(c); queue.push(c) } }
  }
  return out
}

export type StaffScope = { staffId: string; level: LevelKey; rank: number; org: Org; subtree: string[] }

/** The caller's scope, or null when the account has no active assignment (plain field officer / customer). */
export async function scopeOf(company: AppCompany, user: AppUserCtx): Promise<StaffScope | null> {
  if (!user.agentId) return null
  const org = await loadOrg(company)
  const me = org.byStaff.get(user.agentId)
  if (!me) return null
  return { staffId: me.staffId, level: me.level, rank: me.rank, org, subtree: descendantsOf(org, me.staffId) }
}

export async function requireScope(company: AppCompany, user: AppUserCtx): Promise<StaffScope> {
  const s = await scopeOf(company, user)
  if (!s) fail(403, 'FORBIDDEN', 'Not part of the sales team')
  return s
}

/** self or a descendant, otherwise 404 (an outside id never reveals existence). */
export function visible(scope: StaffScope, id: string): void {
  if (id !== scope.staffId && !scope.subtree.includes(id)) fail(404, 'NOT_FOUND', 'Not found')
}
/** strict descendant only (nobody changes their own target / peers / bosses). */
export function strictDescendant(scope: StaffScope, id: string): void {
  if (!scope.subtree.includes(id)) fail(404, 'NOT_FOUND', 'Not found')
}

// ── periods (calendar month, Colombo time; DB timestamps are UTC) ─────────────────────────
const COLOMBO_MS = 5.5 * 3600 * 1000
const fmt = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
export function currentPeriod(now = Date.now()): string {
  return new Date(now + COLOMBO_MS).toISOString().slice(0, 7)
}
export function parsePeriod(v: string | null | undefined): string {
  if (v == null || v === '') return currentPeriod()
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(v)) fail(400, 'VALIDATION', 'period must be YYYY-MM')
  return v
}
export function periodRange(period: string): { from: string; to: string } {
  const [y, m] = period.split('-').map(Number)
  return { from: fmt(new Date(Date.UTC(y, m - 1, 1) - COLOMBO_MS)), to: fmt(new Date(Date.UTC(y, m, 1) - COLOMBO_MS)) }
}
export function colomboDayRange(now = Date.now()): { from: string; to: string } {
  const local = new Date(now + COLOMBO_MS); local.setUTCHours(0, 0, 0, 0)
  const start = local.getTime() - COLOMBO_MS
  return { from: fmt(new Date(start)), to: fmt(new Date(start + 24 * 3600 * 1000)) }
}

// ── names ─────────────────────────────────────────────────────────────────────────────────
type Person = { id: string; code: string | null; name: string; branch_id: string | null }
async function people(company: AppCompany, ids: string[]): Promise<Map<string, Person>> {
  const out = new Map<string, Person>()
  if (!ids.length) return out
  const { rows } = await company.tp.query<Row>(`SELECT id, code, name, branch_id FROM agents WHERE id IN (${ids.map(() => '?').join(',')})`, ids)
  for (const r of rows) out.set(String(r.id), { id: String(r.id), code: r.code ? String(r.code) : null, name: String(r.name), branch_id: r.branch_id ? String(r.branch_id) : null })
  return out
}

// ── money achieved (rule 6 of the sales-force skill) ──────────────────────────────────────
const NOT_A_SALE = `('draft','cancelled','void','quotation','hold','held')`
export type Own = { sales_net: number; contributions: number; achieved: number; registrations: number }

/** One officer's own figures for the period. Credit = the officer stored on the invoice / contribution / member at the time. */
export async function ownFigures(company: AppCompany, staffId: string, code: string | null, period: string): Promise<Own> {
  const { from, to } = periodRange(period)
  const q = async (sql: string, p: unknown[]) => Number((await company.tp.query<Row>(sql, p)).rows[0]?.v ?? 0) || 0
  const attr = `(i.agent_id = ? OR (i.agent_id IS NULL AND ? IS NOT NULL AND i.agent_code = ?))`
  const a = [staffId, code, code]
  const sales = await q(`SELECT COALESCE(SUM(i.total_amount),0) v FROM invoices i WHERE ${attr} AND i.status NOT IN ${NOT_A_SALE} AND i.created_at >= ? AND i.created_at < ?`, [...a, from, to])
  // invoices paid with the Smart Buy wallet were already counted as contributions: exclude that part
  const wallet = await q(`SELECT COALESCE(SUM(p.amount),0) v FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE ${attr} AND p.method = 'smartbuy_wallet' AND i.status NOT IN ${NOT_A_SALE} AND i.created_at >= ? AND i.created_at < ?`, [...a, from, to])
  const returns = await q(`SELECT COALESCE(SUM(r.total_refund),0) v FROM returns r JOIN invoices i ON i.id = r.invoice_id WHERE ${attr} AND r.status <> 'cancelled' AND r.return_date >= ? AND r.return_date < ?`, [...a, from, to])
  const contributions = await q(`SELECT COALESCE(SUM(amount),0) v FROM chit_contributions WHERE collected_by_agent_id = ? AND status NOT IN ('rejected','cancelled','pending','pending_verification','failed') AND paid_at >= ? AND paid_at < ?`, [staffId, from, to])
  const registrations = await q(`SELECT COUNT(*) v FROM chit_members WHERE agent_id = ? AND created_at >= ? AND created_at < ?`, [staffId, from, to])
  const sales_net = round2(Math.max(0, sales - wallet - returns))
  return { sales_net, contributions: round2(contributions), achieved: round2(sales_net + contributions), registrations }
}

// ── targets ───────────────────────────────────────────────────────────────────────────────
type Target = { amount: number; registrations: number | null; source: 'own' | 'rollup' | 'none' }
async function ownTargets(company: AppCompany, ids: string[], period: string): Promise<Map<string, { amount: number; registrations: number | null }>> {
  const out = new Map<string, { amount: number; registrations: number | null }>()
  if (!ids.length) return out
  const { rows } = await company.tp.query<Row>(
    `SELECT staff_id, amount, registrations_target FROM staff_targets WHERE period = ? AND deactivated_at IS NULL AND staff_id IN (${ids.map(() => '?').join(',')}) ORDER BY active_from`, [period, ...ids])
  for (const r of rows) out.set(String(r.staff_id), { amount: Number(r.amount) || 0, registrations: r.registrations_target == null ? null : Number(r.registrations_target) })
  return out
}
/** Own active target; if none, the roll-up of the team's active targets (rule: a manager's target is the team's unless overridden). */
export function resolveTarget(org: Org, own: Map<string, { amount: number; registrations: number | null }>, id: string): Target {
  const mine = own.get(id)
  if (mine) return { ...mine, source: 'own' }
  let amount = 0; let regs: number | null = null; let any = false
  for (const c of org.children.get(id) ?? []) {
    const t = resolveTarget(org, own, c)
    if (t.source !== 'none') { any = true; amount += t.amount; if (t.registrations != null) regs = (regs ?? 0) + t.registrations }
  }
  return any ? { amount: round2(amount), registrations: regs, source: 'rollup' } : { amount: 0, registrations: null, source: 'none' }
}

export type PerformanceDto = {
  staff_id: string; name: string; code: string | null; level: LevelKey; period: string
  target: number; target_source: 'own' | 'rollup' | 'none'; registrations_target: number | null
  sales_net: number; contributions: number; achieved: number; registrations: number
  achievement_pct: number | null; team_size: number
}

/** Figures for each id: own figures plus the whole subtree (a manager's numbers are their team's). */
export async function performanceFor(company: AppCompany, org: Org, ids: string[], period: string): Promise<PerformanceDto[]> {
  const all = new Set<string>()
  for (const id of ids) { all.add(id); for (const d of descendantsOf(org, id)) all.add(d) }
  const list = [...all]
  const names = await people(company, list)
  const targets = await ownTargets(company, list, period)
  const figs = new Map<string, Own>()
  for (const id of list) figs.set(id, await ownFigures(company, id, names.get(id)?.code ?? null, period))
  return ids.map(id => {
    const me = org.byStaff.get(id)
    const members = [id, ...descendantsOf(org, id)]
    const sum = members.reduce((s, m) => { const f = figs.get(m)!; return { sales_net: s.sales_net + f.sales_net, contributions: s.contributions + f.contributions, achieved: s.achieved + f.achieved, registrations: s.registrations + f.registrations } }, { sales_net: 0, contributions: 0, achieved: 0, registrations: 0 })
    const t = resolveTarget(org, targets, id)
    return {
      staff_id: id, name: names.get(id)?.name ?? 'Unknown', code: names.get(id)?.code ?? null, level: me?.level ?? 'field_officer', period,
      target: t.amount, target_source: t.source, registrations_target: t.registrations,
      sales_net: round2(sum.sales_net), contributions: round2(sum.contributions), achieved: round2(sum.achieved), registrations: sum.registrations,
      achievement_pct: t.amount > 0 ? round2((sum.achieved / t.amount) * 100) : null, team_size: members.length - 1,
    }
  })
}

export async function teamList(company: AppCompany, scope: StaffScope, period: string) {
  const ids = [scope.staffId, ...scope.subtree]
  const perf = await performanceFor(company, scope.org, ids, period)
  return perf.map(p => ({ ...p, reports_to: scope.org.byStaff.get(p.staff_id)?.reportsTo ?? null, branch_id: null as string | null }))
}

// ── audit ─────────────────────────────────────────────────────────────────────────────────
export async function writeAudit(company: AppCompany, actor: string | null, action: string, table: string, recordId: string, oldV: unknown, newV: unknown): Promise<void> {
  await company.tp.query(`INSERT INTO audit_logs (id, user_id, action, table_name, record_id, old_values, new_values) VALUES (?,?,?,?,?,?,?)`,
    [randomUUID(), actor, action, table, recordId, oldV == null ? null : JSON.stringify(oldV), newV == null ? null : JSON.stringify(newV)])
}

/** Close the active target row for (staff, period) and add a new one. Never overwrites. */
export async function setTarget(company: AppCompany, actor: string | null, staffId: string, period: string, amount: number, regs: number | null): Promise<{ id: string }> {
  const old = await company.tp.query<Row>(`SELECT id, amount, registrations_target FROM staff_targets WHERE staff_id = ? AND period = ? AND deactivated_at IS NULL`, [staffId, period])
  await company.tp.query(`UPDATE staff_targets SET deactivated_at = NOW() WHERE staff_id = ? AND period = ? AND deactivated_at IS NULL`, [staffId, period])
  const id = randomUUID()
  await company.tp.query(`INSERT INTO staff_targets (id, staff_id, period, amount, registrations_target, set_by) VALUES (?,?,?,?,?,?)`, [id, staffId, period, amount, regs, actor])
  await writeAudit(company, actor, 'staff_target_set', 'staff_targets', id, old.rows[0] ?? null, { staff_id: staffId, period, amount, registrations_target: regs })
  return { id }
}
export function readTargetBody(b: Record<string, unknown>): { period: string; amount: number; regs: number | null } {
  const period = parsePeriod(typeof b.period === 'string' ? b.period : undefined)
  const amount = round2(optNum(b.amount, 'amount', 0, 1_000_000_000) ?? fail(400, 'VALIDATION', 'amount is required'))
  const r = optNum(b.registrations_target, 'registrations_target', 0, 100000)
  return { period, amount, regs: r == null ? null : Math.round(r) }
}
export async function targetHistory(company: AppCompany, staffId: string) {
  const { rows } = await company.tp.query<Row>(`SELECT id, period, amount, registrations_target, active_from, deactivated_at, set_by FROM staff_targets WHERE staff_id = ? ORDER BY period DESC, active_from DESC LIMIT 60`, [staffId])
  return rows.map(r => ({ id: String(r.id), period: String(r.period), amount: Number(r.amount), registrations_target: r.registrations_target == null ? null : Number(r.registrations_target), active_from: toIso(r.active_from), deactivated_at: toIso(r.deactivated_at), active: r.deactivated_at == null }))
}

// ── field visits ──────────────────────────────────────────────────────────────────────────
export type VisitDto = {
  id: string; staff_id: string; customer_id: string | null; prospect_name: string | null; prospect_phone: string | null
  lat: number | null; lng: number | null; gps_missing: boolean; visited_at: string | null; outcome: string; reason: string | null
  follow_up_at: string | null; notes: string | null; client_event_id: string
}
export function visitDto(r: Row): VisitDto {
  return {
    id: String(r.id), staff_id: String(r.staff_id), customer_id: r.customer_id ? String(r.customer_id) : null,
    prospect_name: r.prospect_name ? String(r.prospect_name) : null, prospect_phone: r.prospect_phone ? String(r.prospect_phone) : null,
    lat: r.lat == null ? null : Number(r.lat), lng: r.lng == null ? null : Number(r.lng), gps_missing: Number(r.gps_missing) === 1,
    visited_at: toIso(r.visited_at), outcome: String(r.outcome), reason: r.reason ? String(r.reason) : null,
    follow_up_at: toIso(r.follow_up_at), notes: r.notes ? String(r.notes) : null, client_event_id: String(r.client_event_id),
  }
}
const sqlTime = (d: Date) => fmt(d)
function dateField(v: unknown, field: string): Date | null {
  if (v == null || v === '') return null
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) fail(400, 'VALIDATION', `${field} must be an ISO date`)
  return d
}

/** Idempotent on (staff, client_event_id): a re-sent visit returns the stored row. */
export async function createVisit(company: AppCompany, staffId: string, b: Record<string, unknown>): Promise<{ visit: VisitDto; created: boolean }> {
  const eventId = reqStr(b.client_event_id, 'client_event_id', 8, 64)
  const prior = await company.tp.query<Row>(`SELECT * FROM field_visits WHERE staff_id = ? AND client_event_id = ?`, [staffId, eventId])
  if (prior.rows[0]) return { visit: visitDto(prior.rows[0]), created: false }
  const outcome = oneOf(b.outcome, 'outcome', VISIT_OUTCOMES)
  const customerId = optStr(b.customer_id, 'customer_id', 191)
  const prospect = optStr(b.prospect_name, 'prospect_name', 255)
  if (!customerId && !prospect) fail(400, 'VALIDATION', 'Choose a customer or enter a prospect name')
  if (customerId) {
    const c = await company.tp.query<Row>(`SELECT id FROM customers WHERE id = ? LIMIT 1`, [customerId])
    if (!c.rows[0]) fail(400, 'VALIDATION', 'Unknown customer')
  }
  const reason = optStr(b.reason, 'reason', 300)
  if (outcome === 'not_interested' && !reason) fail(400, 'VALIDATION', 'A reason is required')
  const followUp = dateField(b.follow_up_at, 'follow_up_at')
  if (outcome === 'come_back' && !followUp) fail(400, 'VALIDATION', 'A follow-up date is required')
  const visitedAt = dateField(b.visited_at, 'visited_at') ?? new Date()
  if (visitedAt.getTime() > Date.now() + 5 * 60 * 1000) fail(400, 'VALIDATION', 'visited_at is in the future')
  const lat = optNum(b.lat, 'lat', -90, 90); const lng = optNum(b.lng, 'lng', -180, 180)
  const gpsMissing = lat == null || lng == null
  const id = randomUUID()
  await company.tp.query(
    `INSERT INTO field_visits (id, staff_id, customer_id, prospect_name, prospect_phone, lat, lng, gps_missing, visited_at, outcome, reason, follow_up_at, notes, client_event_id)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, staffId, customerId, prospect, optStr(b.prospect_phone, 'prospect_phone', 40), gpsMissing ? null : lat, gpsMissing ? null : lng, gpsMissing ? 1 : 0,
      sqlTime(visitedAt), outcome, reason, followUp ? sqlTime(followUp) : null, optStr(b.notes, 'notes', 1000), eventId])
  const row = await company.tp.query<Row>(`SELECT * FROM field_visits WHERE id = ?`, [id])
  return { visit: visitDto(row.rows[0]), created: true }
}

export async function visitsToday(company: AppCompany, staffId: string) {
  const { from, to } = colomboDayRange()
  const today = await company.tp.query<Row>(`SELECT * FROM field_visits WHERE staff_id = ? AND visited_at >= ? AND visited_at < ? ORDER BY visited_at DESC`, [staffId, from, to])
  // follow-ups due today or overdue and not yet answered by a later visit to the same customer / prospect
  const due = await company.tp.query<Row>(
    `SELECT v.* FROM field_visits v
      WHERE v.staff_id = ? AND v.follow_up_at IS NOT NULL AND v.follow_up_at < ?
        AND NOT EXISTS (SELECT 1 FROM field_visits n WHERE n.staff_id = v.staff_id AND n.visited_at > v.visited_at
              AND ((v.customer_id IS NOT NULL AND n.customer_id = v.customer_id) OR (v.customer_id IS NULL AND n.prospect_name = v.prospect_name)))
      ORDER BY v.follow_up_at LIMIT 100`, [staffId, to])
  return { visits: today.rows.map(visitDto), follow_ups: due.rows.map(visitDto) }
}

/** Scoped report: per officer counts by outcome, GPS gaps and follow-up compliance (due vs done). */
export async function visitReport(company: AppCompany, scope: StaffScope, period: string, only?: string | null) {
  const ids = only ? [only] : [scope.staffId, ...scope.subtree]
  const { from, to } = periodRange(period)
  const names = await people(company, ids)
  const items = []
  for (const id of ids) {
    const r = await company.tp.query<Row>(
      `SELECT COUNT(*) total, SUM(outcome='purchased') purchased, SUM(outcome='not_interested') not_interested, SUM(outcome='come_back') come_back,
              SUM(outcome='not_at_home') not_at_home, SUM(outcome='already_member') already_member, SUM(gps_missing=1) gps_missing
         FROM field_visits WHERE staff_id = ? AND visited_at >= ? AND visited_at < ?`, [id, from, to])
    const due = await company.tp.query<Row>(
      `SELECT COUNT(*) due, SUM(EXISTS (SELECT 1 FROM field_visits n WHERE n.staff_id = v.staff_id AND n.visited_at > v.visited_at
              AND ((v.customer_id IS NOT NULL AND n.customer_id = v.customer_id) OR (v.customer_id IS NULL AND n.prospect_name = v.prospect_name)))) done
         FROM field_visits v WHERE v.staff_id = ? AND v.follow_up_at IS NOT NULL AND v.follow_up_at >= ? AND v.follow_up_at < ? AND v.follow_up_at < NOW()`, [id, from, to])
    const n = (k: string) => Number(r.rows[0]?.[k] ?? 0) || 0
    items.push({
      staff_id: id, name: names.get(id)?.name ?? 'Unknown', code: names.get(id)?.code ?? null, level: scope.org.byStaff.get(id)?.level ?? 'field_officer',
      total: n('total'), purchased: n('purchased'), not_interested: n('not_interested'), come_back: n('come_back'), not_at_home: n('not_at_home'),
      already_member: n('already_member'), gps_missing: n('gps_missing'),
      follow_ups_due: Number(due.rows[0]?.due ?? 0) || 0, follow_ups_done: Number(due.rows[0]?.done ?? 0) || 0,
    })
  }
  return { period, items }
}

// ── admin (POS desktop, company key) ──────────────────────────────────────────────────────
export async function adminAssignments(company: AppCompany) {
  const { rows } = await company.tp.query<Row>(`SELECT id, staff_id, level_key, scope_type, scope_id, reports_to_staff_id, active_from FROM staff_assignments WHERE active_to IS NULL ORDER BY active_from`)
  const names = await people(company, [...new Set(rows.flatMap(r => [String(r.staff_id), r.reports_to_staff_id ? String(r.reports_to_staff_id) : '']).filter(Boolean))])
  const ag = await company.tp.query<Row>(`SELECT id, code, name FROM agents WHERE COALESCE(status,'active') = 'active' ORDER BY name`)
  return {
    items: rows.map(r => ({ id: String(r.id), staff_id: String(r.staff_id), name: names.get(String(r.staff_id))?.name ?? 'Unknown', code: names.get(String(r.staff_id))?.code ?? null,
      level: String(r.level_key), scope_type: String(r.scope_type), scope_id: r.scope_id ? String(r.scope_id) : null,
      reports_to: r.reports_to_staff_id ? String(r.reports_to_staff_id) : null, reports_to_name: r.reports_to_staff_id ? names.get(String(r.reports_to_staff_id))?.name ?? null : null })),
    agents: ag.rows.map(r => ({ id: String(r.id), code: r.code ? String(r.code) : null, name: String(r.name) })),
    levels: LEVEL_KEYS.map(k => ({ key: k, rank: LEVELS[k] })),
  }
}

/** Put (or move) a person on the hierarchy. History is kept: the old row is closed, never edited. */
export async function adminAssign(company: AppCompany, actor: string | null, b: Record<string, unknown>) {
  const staffId = reqStr(b.staff_id, 'staff_id', 1, 191)
  const level = oneOf(b.level_key, 'level_key', LEVEL_KEYS)
  const reportsTo = optStr(b.reports_to_staff_id, 'reports_to_staff_id', 191)
  const scopeType = oneOf(b.scope_type ?? (level === 'field_officer' ? 'self' : level === 'branch_manager' ? 'branch' : level === 'regional_manager' ? 'region' : level === 'zonal_manager' ? 'zone' : 'company'), 'scope_type', ['company', 'zone', 'region', 'branch', 'self'] as const)
  const scopeId = optStr(b.scope_id, 'scope_id', 191)
  const ag = await company.tp.query<Row>(`SELECT id FROM agents WHERE id = ? LIMIT 1`, [staffId])
  if (!ag.rows[0]) fail(400, 'VALIDATION', 'Unknown staff member')
  if (level === 'director' && reportsTo) fail(400, 'VALIDATION', 'The Director reports to nobody')
  if (level !== 'director' && !reportsTo) fail(400, 'VALIDATION', 'Choose who this person reports to')
  if (reportsTo) {
    const org = await loadOrg(company)
    const boss = org.byStaff.get(reportsTo)
    if (!boss) fail(400, 'VALIDATION', 'The manager is not on the hierarchy')
    if (boss.rank >= LEVELS[level]) fail(400, 'VALIDATION', 'A person must report to a higher level')
    if (reportsTo === staffId || descendantsOf(org, staffId).includes(reportsTo)) fail(400, 'VALIDATION', 'That would create a loop')
  }
  const prior = await company.tp.query<Row>(`SELECT * FROM staff_assignments WHERE staff_id = ? AND active_to IS NULL`, [staffId])
  await company.tp.query(`UPDATE staff_assignments SET active_to = NOW() WHERE staff_id = ? AND active_to IS NULL`, [staffId])
  const id = randomUUID()
  await company.tp.query(`INSERT INTO staff_assignments (id, staff_id, level_key, scope_type, scope_id, reports_to_staff_id) VALUES (?,?,?,?,?,?)`, [id, staffId, level, scopeType, scopeId, reportsTo])
  await writeAudit(company, actor, 'staff_assignment_set', 'staff_assignments', id, prior.rows[0] ?? null, { staff_id: staffId, level_key: level, reports_to_staff_id: reportsTo })
  return { id }
}
export async function adminUnassign(company: AppCompany, actor: string | null, staffId: string) {
  const org = await loadOrg(company)
  if (descendantsOf(org, staffId).length) fail(409, 'CONFLICT', 'Move this person\'s team first')
  const prior = await company.tp.query<Row>(`SELECT * FROM staff_assignments WHERE staff_id = ? AND active_to IS NULL`, [staffId])
  if (!prior.rows[0]) fail(404, 'NOT_FOUND', 'Not found')
  await company.tp.query(`UPDATE staff_assignments SET active_to = NOW() WHERE staff_id = ? AND active_to IS NULL`, [staffId])
  await writeAudit(company, actor, 'staff_assignment_closed', 'staff_assignments', String(prior.rows[0].id), prior.rows[0], null)
}
