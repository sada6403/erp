// STAGING ONLY: Smart Buy cash collection by agents (cloud side). Idempotent offline replay, scope, due figures, late fee, receipt numbers,
// today's summary, receipts, and the POS approve / reject round trip (via /api/sync/push with the POS key): notifications, and the
// "counted only after approval" rule on the sales-force achievement. Creates its own rows in the staging copy of the "test" company and removes them.
// Run: STAGING_SEED=<seed json> TEST_BASE_URL=https://staging-api.72-61-115-222.sslip.io INT_MYSQL_HOST=127.0.0.1 INT_MYSQL_PORT=3307 INT_MYSQL_USER=.. INT_MYSQL_PASSWORD=.. \
//      ELECTRON_RUN_AS_NODE=1 electron vitest run --project=integration electron/__qa__/integration-app/agent-collections.integration.test.ts
import fs from 'node:fs'
import crypto from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { appApi, BASE_URL, cloudDb, posAdmin, type CloudDb, type Seed } from './harness'

const ENABLED = !!process.env.STAGING_SEED
const d = describe.skipIf(!ENABLED)
const run = crypto.randomBytes(3).toString('hex')
const period = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7)
const uuid = () => crypto.randomUUID()

let seed: Seed, api: ReturnType<typeof appApi>, admin: ReturnType<typeof posAdmin>, db: CloudDb
const A = { id: '', user: '', phone: '', token: '', code: '' }
const B = { id: '', user: '', phone: '', token: '', code: '' }
const D = { id: '', code: '' }
const cust: Record<string, { id: string; user: string; phone: string; token: string }> = {}
let sFuture = '', sPast = ''
const M: Record<string, string> = {}
let seq = 0
const receipt = (who: { code: string }) => `${who.code}-${String(++seq).padStart(6, '0')}`
const nowIso = () => new Date().toISOString()
const collect = (token: string, memberId: string, amount: number, extra: Record<string, unknown> = {}) => {
  const body = { client_event_id: uuid(), member_id: memberId, amount, receipt_number: receipt(token === B.token ? B : A), collected_at: nowIso(), ...extra }
  return { body, send: (t = token) => api.post('/agent/collections', body, { token: t }) }
}
const pushStatus = (id: string, status: string, extra: Record<string, unknown> = {}) =>
  fetch(`${BASE_URL}/api/sync/push`, {
    method: 'POST', headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'application/json' },
    body: JSON.stringify({ table: 'chit_contributions', operation: 'UPDATE', recordId: id, record: { id, status, ...extra }, eventId: uuid() }),
  })
const notes = (user: string, like: string) => db.query<{ title: string; body: string }>(`SELECT title, body FROM app_notifications WHERE user_id = ? AND title LIKE ?`, [user, like])
const dueOf = async (memberId: string) => (await api.get('/agent/members?limit=100', { token: A.token })).json.items.find((m: any) => m.member_id === memberId)?.collection

beforeAll(async () => {
  if (!ENABLED) return
  if (!/staging-api\.|localhost|127\.0\.0\.1/.test(BASE_URL)) throw new Error(`Refusing: ${BASE_URL} is not staging/localhost`)
  const raw = JSON.parse(fs.readFileSync(String(process.env.STAGING_SEED), 'utf8'))
  if (!String(raw.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error(`Refusing schema ${raw.db_schema}`)
  seed = { ...raw, base_url: BASE_URL, branches: { main: raw.branch_id, kandy: raw.branch_id }, file: String(process.env.STAGING_SEED) } as Seed
  api = appApi(seed); admin = posAdmin(seed); db = await cloudDb(seed)
  const hash = (await db.one<{ h: string }>(`SELECT password_hash h FROM app_users WHERE phone = ? AND deleted_at IS NULL LIMIT 1`, [raw.logins.customer]))!.h
  const base = String(1000 + Math.floor(Math.random() * 8999))
  let i = 0
  for (const [who, tag] of [[A, 'A'], [B, 'B']] as const) {
    i++
    who.id = uuid(); who.user = uuid(); who.code = `CO${run}${tag}`.toUpperCase(); who.phone = `0789${base}${String(i).padStart(2, '0')}`
    await db.exec(`INSERT INTO agents (id, code, name, phone, branch_id, status) VALUES (?,?,?,?,?,'active')`, [who.id, who.code, `CO ${tag} ${run}`, who.phone, raw.branch_id])
    await db.exec(`INSERT INTO app_users (id, phone, name, password_hash, must_change_password, agent_id, roles, status, created_by_source) VALUES (?,?,?,?,0,?,?, 'active', 'seed')`, [who.user, who.phone, `CO ${tag} ${run}`, hash, who.id, JSON.stringify(['agent'])])
  }
  D.id = uuid(); D.code = `CO${run}D`.toUpperCase()
  await db.exec(`INSERT INTO agents (id, code, name, phone, branch_id, status) VALUES (?,?,?,?,?,'active')`, [D.id, D.code, `CO D ${run}`, `0789${base}09`, raw.branch_id])
  for (const n of ['1', '2', '3', '4', '5']) {
    i++
    const c = { id: uuid(), user: uuid(), phone: `0786${base}${String(i).padStart(2, '0')}`, token: '' }
    await db.exec(`INSERT INTO customers (id, name, phone) VALUES (?,?,?)`, [c.id, `CO Member ${n} ${run}`, c.phone])
    await db.exec(`INSERT INTO app_users (id, phone, name, password_hash, must_change_password, customer_id, roles, status, created_by_source) VALUES (?,?,?,?,0,?,?, 'active', 'seed')`, [c.user, c.phone, `CO Member ${n}`, hash, c.id, JSON.stringify(['customer'])])
    cust[n] = c
  }
  const mk = async (name: string, startSql: string, lateDays: number, fee: number) => {
    const id = uuid()
    await db.exec(`INSERT INTO chit_schemes (id, scheme_number, name, branch_id, member_count, cycle_count, frequency, contribution_amount, chit_value, start_date, status, late_payment_days, late_fee_amount)
       VALUES (?,?,?,?,?,?, 'monthly', 1000, 12000, ${startSql}, 'active', ?, ?)`, [id, `CO-${run}-${name}`, `CO ${name} ${run}`, raw.branch_id, 50, 12, lateDays, fee])
    return id
  }
  sFuture = await mk('F', `DATE_ADD(CURDATE(), INTERVAL 2 MONTH)`, 5, 200) // cycle 1 due in the future: never late
  sPast = await mk('P', `DATE_SUB(CURDATE(), INTERVAL 3 MONTH)`, 5, 200) // cycle 1 due long ago: always late
  let order = 0
  const member = async (key: string, scheme: string, agent: string, c: string) => {
    const id = uuid(); order++
    await db.exec(`INSERT INTO chit_members (id, scheme_id, customer_id, agent_id, join_order, status) VALUES (?,?,?,?,?, 'active')`, [id, scheme, c, agent, order])
    M[key] = id
  }
  await member('m1', sFuture, A.id, cust['1'].id)
  await member('m2', sPast, A.id, cust['2'].id)
  await member('m3', sFuture, B.id, cust['3'].id) // belongs to the OTHER agent
  await member('m4', sFuture, A.id, cust['4'].id)
  await member('m5', sFuture, A.id, cust['5'].id)
  A.token = await api.login(A.phone, raw.password)
  B.token = await api.login(B.phone, raw.password)
  cust['1'].token = await api.login(cust['1'].phone, raw.password)
  // A is a field officer under a Director so the sales-force achievement can show what counts
  expect((await admin.post('/staff/assignments', { staff_id: D.id, level_key: 'director' })).status).toBe(200)
  expect((await admin.post('/staff/assignments', { staff_id: A.id, level_key: 'field_officer', reports_to_staff_id: D.id })).status).toBe(200)
}, 300_000)

afterAll(async () => {
  if (!db) return
  const agents = [A.id, B.id, D.id].filter(Boolean)
  const users = [A.user, B.user, ...Object.values(cust).map(c => c.user)].filter(Boolean)
  const members = Object.values(M)
  const q = (arr: unknown[]) => arr.map(() => '?').join(',')
  if (members.length) {
    await db.exec(`DELETE FROM app_collections WHERE member_id IN (${q(members)})`, members).catch(() => {})
    await db.exec(`DELETE FROM chit_contributions WHERE member_id IN (${q(members)})`, members).catch(() => {})
    await db.exec(`DELETE FROM chit_members WHERE id IN (${q(members)})`, members).catch(() => {})
  }
  for (const s of [sFuture, sPast].filter(Boolean)) await db.exec(`DELETE FROM chit_schemes WHERE id = ?`, [s]).catch(() => {})
  if (users.length) {
    for (const t of ['app_notifications', 'notification_jobs', 'app_refresh_tokens']) await db.exec(`DELETE FROM ${t} WHERE user_id IN (${q(users)})`, users).catch(() => {})
    await db.exec(`DELETE FROM app_users WHERE id IN (${q(users)})`, users).catch(() => {})
  }
  if (agents.length) {
    await db.exec(`DELETE FROM staff_assignments WHERE staff_id IN (${q(agents)})`, agents).catch(() => {})
    await db.exec(`DELETE FROM agents WHERE id IN (${q(agents)})`, agents).catch(() => {})
  }
  await db.exec(`DELETE FROM customers WHERE name LIKE ?`, [`CO Member % ${run}`]).catch(() => {})
  await db.exec(`DELETE FROM audit_logs WHERE action IN ('staff_assignment_set','staff_assignment_closed') AND new_values LIKE ?`, [`%${D.id}%`]).catch(() => {})
  await db.close()
})

d('due figures on the members list', () => {
  it('CO-01 a member shows this cycle\'s due, arrears and last payment; a late cycle shows the late fee', async () => {
    const m1 = await dueOf(M.m1)
    expect(m1).toMatchObject({ cycle_no: 1, installment_amount: 1000, balance_due: 1000, pending_amount: 0, late_fee: 0, is_late: false, collectable: 1000, arrears: 0, last_payment_at: null, frequency: 'monthly' })
    const m2 = await dueOf(M.m2)
    expect(m2).toMatchObject({ cycle_no: 1, is_late: true, late_fee: 200, collectable: 1200 })
    // members of another agent are not in this list at all
    const all = (await api.get('/agent/members?limit=100', { token: A.token })).json.items.map((m: any) => m.member_id)
    expect(all).not.toContain(M.m3)
  })
})

d('collecting cash', () => {
  it('CO-02 collect the due: a pending cash row owned by the agent, a receipt row, and the member is told', async () => {
    const c = collect(A.token, M.m1, 1000)
    const r = await c.send()
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    expect(r.json.duplicate).toBe(false)
    expect(r.json.collection).toMatchObject({ id: c.body.client_event_id, status: 'pending_verification', amount: 1000, receipt_number: c.body.receipt_number, cycle_no: 1, balance_after: 0 })
    const row = await db.one<any>(`SELECT * FROM chit_contributions WHERE id = ?`, [c.body.client_event_id])
    expect(row).toMatchObject({ status: 'pending_verification', method: 'cash', collected_by_agent_id: A.id, receipt_number: c.body.receipt_number })
    expect(Number(row.amount)).toBe(1000)
    expect(Number(row.commission_amount)).toBe(0)
    expect((await db.one<any>(`SELECT agent_id FROM app_collections WHERE contribution_id = ?`, [c.body.client_event_id]))!.agent_id).toBe(A.id)
    expect((await notes(cust['1'].user, 'Payment received')).length).toBe(1)
    const member = await db.one<any>(`SELECT contributions_paid FROM chit_members WHERE id = ?`, [M.m1])
    expect(Number(member.contributions_paid)).toBe(0) // the POS owns member totals, and only after approval
    M.c1 = c.body.client_event_id
  })

  it('CO-03 an offline replay (same client_event_id) is one row: 200 duplicate, no second receipt, no second notification', async () => {
    const c = collect(A.token, M.m4, 400)
    const first = await c.send()
    expect(first.status).toBe(201)
    for (let i = 0; i < 3; i++) {
      const again = await c.send()
      expect(again.status).toBe(200)
      expect(again.json.duplicate).toBe(true)
      expect(again.json.collection.id).toBe(c.body.client_event_id)
    }
    expect((await db.one<any>(`SELECT COUNT(*) n FROM chit_contributions WHERE id = ?`, [c.body.client_event_id]))!.n).toBe(1)
    expect((await db.one<any>(`SELECT COUNT(*) n FROM app_collections WHERE contribution_id = ?`, [c.body.client_event_id]))!.n).toBe(1)
    expect((await notes(cust['4'].user, 'Payment received')).length).toBe(1)
    M.c4a = c.body.client_event_id
  })

  it('CO-04 another agent cannot reuse the event id; a receipt number is unique per agent; the same number is fine for a different agent', async () => {
    const stolen = await api.post('/agent/collections', { client_event_id: M.c4a, member_id: M.m3, amount: 100, receipt_number: `${B.code}-900001`, collected_at: nowIso() }, { token: B.token })
    expect(stolen.status).toBe(409)
    const dupReceipt = await api.post('/agent/collections', { client_event_id: uuid(), member_id: M.m4, amount: 100, receipt_number: (await db.one<any>(`SELECT receipt_number r FROM app_collections WHERE contribution_id = ?`, [M.c4a]))!.r, collected_at: nowIso() }, { token: A.token })
    expect(dupReceipt.status).toBe(409)
    expect(dupReceipt.json.error.code).toBe('CONFLICT')
    const sameNumberOtherAgent = await api.post('/agent/collections', { client_event_id: uuid(), member_id: M.m3, amount: 100, receipt_number: 'SHARED-000001', collected_at: nowIso() }, { token: B.token })
    expect(sameNumberOtherAgent.status, JSON.stringify(sameNumberOtherAgent.json)).toBe(201)
    const sameNumberAgentA = await api.post('/agent/collections', { client_event_id: uuid(), member_id: M.m5, amount: 100, receipt_number: 'SHARED-000001', collected_at: nowIso() }, { token: A.token })
    expect(sameNumberAgentA.status, 'different agent, same number is allowed').toBe(201)
    M.c5 = sameNumberAgentA.json.collection.id
  })

  it('CO-05 scope: another agent\'s member is 404, a customer is 403, no token 401, wrong app key 401', async () => {
    expect((await collect(A.token, M.m3, 100).send()).status).toBe(404) // B's member
    expect((await collect(B.token, M.m2, 100).send()).status).toBe(404)
    expect((await collect(cust['1'].token, M.m1, 100).send()).status).toBe(403)
    expect((await api.post('/agent/collections', collect(A.token, M.m1, 1).body, { token: null })).status).toBe(401)
    expect((await api.post('/agent/collections', collect(A.token, M.m1, 1).body, { token: A.token, key: 'wrong-key' })).status).toBe(401)
    expect((await api.get('/agent/collections/today', { token: cust['1'].token })).status).toBe(403)
    expect((await api.get('/agent/collections/today', { token: null })).status).toBe(401)
  })

  it('CO-06 pending counts against the due: nothing more can be collected on a settled cycle; partial amounts are allowed up to the due', async () => {
    const due1 = await dueOf(M.m1)
    expect(due1).toMatchObject({ pending_amount: 1000, balance_due: 1000, collectable: 0 })
    const over = await collect(A.token, M.m1, 1).send()
    expect(over.status).toBe(409)
    expect(over.json.error.details.collectable).toBe(0)
    // m4: 400 pending, 600 left
    expect((await dueOf(M.m4)).collectable).toBe(600)
    expect((await collect(A.token, M.m4, 600.01).send()).status).toBe(409)
    expect((await collect(A.token, M.m4, 600).send()).status).toBe(201)
    expect((await collect(A.token, M.m4, 1).send()).status).toBe(409)
  })

  it('CO-07 a late cycle charges the fee once, inside the collected amount', async () => {
    const c = collect(A.token, M.m2, 1200)
    const r = await c.send()
    expect(r.status, JSON.stringify(r.json)).toBe(201)
    expect(r.json.collection.late_fee_applied).toBe(200)
    expect(r.json.collection.amount).toBe(1200)
    const row = await db.one<any>(`SELECT amount, late_fee_applied FROM chit_contributions WHERE id = ?`, [c.body.client_event_id])
    expect([Number(row.amount), Number(row.late_fee_applied)]).toEqual([1200, 200])
    const due = await dueOf(M.m2)
    expect(due.late_fee).toBe(0) // already charged for this cycle
    expect(due.collectable).toBe(0)
    M.c2 = c.body.client_event_id
  })

  it('CO-08 validation: bad amount, id, receipt, future or ancient time, unknown fields', async () => {
    const base = () => collect(A.token, M.m5, 10).body
    const post = (b: Record<string, unknown>) => api.post('/agent/collections', b, { token: A.token })
    expect((await post({ ...base(), amount: 0 })).status).toBe(400)
    expect((await post({ ...base(), amount: -5 })).status).toBe(400)
    expect((await post({ ...base(), amount: 'abc' })).status).toBe(400)
    expect((await post({ ...base(), client_event_id: 'not-a-uuid' })).status).toBe(400)
    expect((await post({ ...base(), receipt_number: 'a b' })).status).toBe(400)
    expect((await post({ ...base(), collected_at: new Date(Date.now() + 3600e3).toISOString() })).status).toBe(400)
    expect((await post({ ...base(), collected_at: new Date(Date.now() - 40 * 86400e3).toISOString() })).status).toBe(400)
    expect((await post({ ...base(), status: 'approved' })).status, 'cannot set the status').toBe(400)
    expect((await post({ ...base(), agent_id: B.id })).status, 'cannot set the agent').toBe(400)
  })
})

d('summary and receipt', () => {
  it('CO-09 today\'s summary: count, total, pending, cash in hand, last receipt number', async () => {
    const r = await api.get('/agent/collections/today', { token: A.token })
    expect(r.status).toBe(200)
    const items = r.json.items
    const mine = items.map((i: any) => i.id)
    for (const id of [M.c1, M.c4a, M.c2, M.c5]) expect(mine).toContain(id)
    expect(r.json.summary.count).toBe(items.length)
    expect(r.json.summary.total).toBe(items.reduce((a: number, i: any) => a + i.amount, 0))
    expect(r.json.summary.pending_total).toBe(r.json.summary.total) // nothing approved yet
    expect(r.json.summary.pending_remittance).toBe(r.json.summary.total)
    expect(r.json.summary.cash_in_hand).toBe(r.json.summary.total)
    expect(r.json.last_receipt_seq).toBeGreaterThanOrEqual(seq - 1)
    // another agent sees none of these
    const other = await api.get('/agent/collections/today', { token: B.token })
    expect(other.json.items.map((i: any) => i.id)).not.toContain(M.c1)
  })

  it('CO-10 receipt: company, member, scheme, cycle, amount, balance, agent; someone else\'s receipt is 404', async () => {
    const r = await api.get(`/agent/collections/${M.c1}/receipt`, { token: A.token })
    expect(r.status).toBe(200)
    expect(r.json).toMatchObject({ id: M.c1, amount: 1000, cycle_no: 1, balance_after: 0, agent_code: A.code, status: 'pending_verification' })
    expect(r.json.company_name).toBeTruthy()
    expect(r.json.customer_name).toContain('CO Member 1')
    expect(r.json.scheme_name).toContain('CO F')
    expect((await api.get(`/agent/collections/${M.c1}/receipt`, { token: B.token })).status).toBe(404)
    expect((await api.get(`/agent/collections/${uuid()}/receipt`, { token: A.token })).status).toBe(404)
  })
})

d('the POS decides: approve / reject round trip', () => {
  const figures = async () => {
    const r = await admin.get(`/staff/overview?period=${period}`)
    expect(r.status, JSON.stringify(r.json)).toBe(200)
    return r.json.items.find((i: any) => i.staff_id === A.id)
  }

  it('CO-11 commission / achievement counts a collection only after approval', async () => {
    const before = await figures()
    expect(before.contributions, 'pending rows do not count').toBe(0)
    expect(before.achieved).toBe(0)
    const res = await pushStatus(M.c1, 'approved', { verified_by: null, credit_applied: 0 })
    expect(res.status).toBe(200)
    const after = await figures()
    expect(after.contributions).toBe(1000)
    expect(after.achieved).toBe(1000)
  })

  it('CO-12 approval tells the member once (a repeated push does not repeat it); the agent\'s pending total drops', async () => {
    expect((await notes(cust['1'].user, 'Payment confirmed')).length).toBe(1)
    await pushStatus(M.c1, 'approved')
    expect((await notes(cust['1'].user, 'Payment confirmed')).length).toBe(1)
    const r = await api.get('/agent/collections/today', { token: A.token })
    const me = r.json.items.find((i: any) => i.id === M.c1)
    expect(me.status).toBe('approved')
    expect(r.json.summary.approved_total).toBeGreaterThanOrEqual(1000)
  })

  it('CO-13 rejection tells the agent the reason and the member; the rejected amount never counts', async () => {
    const before = (await figures()).contributions
    const res = await pushStatus(M.c2, 'rejected', { rejected_reason: 'Cash did not match the receipt' })
    expect(res.status).toBe(200)
    const agentNotes = await notes(A.user, 'Collection rejected')
    expect(agentNotes.length).toBe(1)
    expect(agentNotes[0].body).toContain('Cash did not match the receipt')
    expect((await notes(cust['2'].user, 'Payment not confirmed')).length).toBe(1)
    expect((await figures()).contributions).toBe(before)
    const r = await api.get('/agent/collections/today', { token: A.token })
    expect(r.json.items.find((i: any) => i.id === M.c2)).toMatchObject({ status: 'rejected', rejected_reason: 'Cash did not match the receipt' })
    expect(r.json.summary.rejected_total).toBe(1200)
  })

  it('CO-14 once the branch records the remittance, the cash in hand drops by it', async () => {
    const before = (await api.get('/agent/collections/today', { token: A.token })).json.summary
    const remit = await fetch(`${BASE_URL}/api/sync/push`, {
      method: 'POST', headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'application/json' },
      body: JSON.stringify({ table: 'agent_remittances', operation: 'INSERT', recordId: uuid(), record: { id: uuid(), agent_id: A.id, branch_id: seed.branch_id, amount: 1000, method: 'cash', submitted_at: nowIso() }, eventId: uuid() }),
    })
    expect(remit.status, await remit.clone().text()).toBe(200)
    const after = (await api.get('/agent/collections/today', { token: A.token })).json.summary
    expect(after.cash_in_hand).toBe(before.cash_in_hand - 1000)
    await db.exec(`DELETE FROM agent_remittances WHERE agent_id = ?`, [A.id])
  })
})
