// Customer self "Join Smart Buy": agent lookup, validation parity with the POS, ownership, auth, idempotency,
// POS approve/reject (branch + agent carried over), NIC kept out of customers, 30 day retention purge.
// Run through `npm test` (fresh seeded tenant + local dev server + local MySQL), same as app-api.test.mjs.
import test, { before, after } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import mysql from 'mysql2/promise'

const seedFile = process.env.SEED_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.seed-output.json')
if (!existsSync(seedFile)) throw new Error('Run `npm test` (fresh tenant) or `npm run seed:app` first.')
const seed = JSON.parse(readFileSync(seedFile, 'utf8'))
const V1 = `${process.env.TEST_BASE_URL || seed.base_url}/api/app/v1`
const ip = () => `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`
// 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

async function call(method, p, { token, body, form, key = seed.app_key, headers = {} } = {}) {
  const h = { 'x-forwarded-for': ip(), ...headers }
  if (key) h['x-app-key'] = key
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(`${V1}${p}`, { method, headers: h, body: form ?? (body === undefined ? undefined : JSON.stringify(body)) })
  let json = null
  try { json = await res.json() } catch { /* none */ }
  return { status: res.status, json }
}
const login = async (identifier) => (await call('POST', '/auth/login', { body: { identifier, password: seed.password } })).json.tokens.access_token
const admin = (method, p, body) => fetch(`${V1}${p}`, { method, headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null) }))

const db = () => mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema, timezone: '+00:00' })

let applicant, agentTok, schemeId
const created = { schemes: [], requests: [], customers: [] }

function joinForm(over = {}, { omit = [] } = {}) {
  const f = new FormData()
  const v = {
    client_event_id: randomUUID(), scheme_id: schemeId, full_name: 'Kamal Join Test', phone: '0775551234', nic_number: '901234567V',
    address: '5 Test Lane', agent_code: 'ag001', branch_id: seed.branches.kandy, ...over,
  }
  for (const [k, val] of Object.entries(v)) if (!omit.includes(k) && val !== undefined) f.append(k, val)
  if (!omit.includes('nic_front')) f.append('nic_front', new Blob([PNG], { type: 'image/png' }), 'f.png')
  if (!omit.includes('nic_back')) f.append('nic_back', new Blob([PNG], { type: 'image/png' }), 'b.png')
  return f
}

before(async () => {
  applicant = await login(seed.logins.other_customer.identifier)
  agentTok = await login(seed.logins.agent.identifier)
  const c = await db()
  try {
    schemeId = randomUUID()
    created.schemes.push(schemeId)
    await c.query(
      `INSERT INTO chit_schemes (id, scheme_number, name, branch_id, member_count, cycle_count, frequency, contribution_amount, chit_value, start_date, status)
       VALUES (?, ?, 'Join Test Scheme', ?, 10, 10, 'monthly', 1000, 10000, NOW(), 'active')`, [schemeId, `JT-${Date.now() % 100000}`, seed.branches.main])
  } finally { await c.end() }
})

after(async () => {
  const c = await db()
  try {
    await c.query(`DELETE FROM chit_members WHERE scheme_id = ?`, [schemeId])
    await c.query(`DELETE FROM smartbuy_join_requests WHERE scheme_id = ?`, [schemeId])
    await c.query(`DELETE FROM chit_schemes WHERE id = ?`, [schemeId])
    await c.query(`DELETE FROM customers WHERE phone IN ('0775551234', '0775551235')`)
  } finally { await c.end() }
})

test('JOIN-01 agent lookup: 401 no token, 401 wrong key, 404 unknown/inactive, 200 returns ONLY name + branch', async () => {
  assert.equal((await call('GET', '/smartbuy/agents/lookup?code=AG001')).status, 401)
  assert.equal((await call('GET', '/smartbuy/agents/lookup?code=AG001', { token: applicant, key: 'npk_wrong' })).status, 401)
  const unknown = await call('GET', '/smartbuy/agents/lookup?code=NOPE999', { token: applicant })
  assert.equal(unknown.status, 404)
  assert.equal((await call('GET', '/smartbuy/agents/lookup', { token: applicant })).status, 400)
  const ok = await call('GET', '/smartbuy/agents/lookup?code=%20ag001%20', { token: applicant })
  assert.equal(ok.status, 200)
  assert.deepEqual(Object.keys(ok.json).sort(), ['branch_id', 'branch_name', 'code', 'name'])
  assert.equal(ok.json.name, 'Ruwan Agent')
  const c = await db()
  try {
    await c.query(`UPDATE agents SET status = 'inactive' WHERE id = ?`, [seed.agent_id])
    assert.equal((await call('GET', '/smartbuy/agents/lookup?code=AG001', { token: applicant })).status, 404)
  } finally { await c.query(`UPDATE agents SET status = 'active' WHERE id = ?`, [seed.agent_id]); await c.end() }
})

test('JOIN-02 validation parity with the POS (NIC regex, phone, required agent code + branch + photos)', async () => {
  const bad = async (over, opts, msg) => {
    const r = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm(over, opts) })
    assert.ok([400, 404].includes(r.status), `${msg}: got ${r.status} ${JSON.stringify(r.json)}`)
    return r
  }
  await bad({ nic_number: '12345' }, {}, 'short nic')
  await bad({ nic_number: '90123456VV' }, {}, 'bad nic')
  await bad({ phone: '0112345678' }, {}, 'landline phone')
  await bad({ full_name: 'A' }, {}, 'short name')
  await bad({}, { omit: ['agent_code'] }, 'agent code required for customers')
  assert.equal((await bad({ agent_code: 'NOPE999' }, {}, 'unknown agent')).status, 404)
  await bad({}, { omit: ['branch_id'] }, 'branch required for customers')
  await bad({ branch_id: 'not-a-branch' }, {}, 'unknown branch')
  await bad({}, { omit: ['nic_front'] }, 'front photo required')
  await bad({}, { omit: ['nic_back'] }, 'back photo required')
  await bad({ surprise: 'x' }, {}, 'unknown field')
  const unknownScheme = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ scheme_id: 'nope' }) })
  assert.equal(unknownScheme.status, 404)
  // Accepted NIC spellings: 9 digits + V/X (any case), or 12 digits (covered by the happy path below).
})

test('JOIN-03 auth: no token 401, wrong key 401', async () => {
  assert.equal((await call('POST', '/smartbuy/join-requests', { form: joinForm() })).status, 401)
  assert.equal((await call('POST', '/smartbuy/join-requests', { token: applicant, key: 'npk_wrong', form: joinForm() })).status, 401)
  assert.equal((await call('GET', '/smartbuy/join-requests')).status, 401)
})

test('JOIN-04 submit: idempotent on client_event_id, stores agent + branch, owner-only list, POS sees it', async () => {
  const eventId = randomUUID()
  const first = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ client_event_id: eventId, nic_number: '199012345678' }) })
  assert.equal(first.status, 201, JSON.stringify(first.json))
  created.requests.push(first.json.id)
  assert.equal(first.json.status, 'pending')
  assert.equal(first.json.source, 'self')
  assert.equal(first.json.agent_name, 'Ruwan Agent')
  assert.equal(first.json.branch_name, 'Kandy')
  assert.ok(!('nic_number' in first.json) && !('phone' in first.json), 'the response never carries the NIC or the full phone')
  const again = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ client_event_id: eventId, nic_number: '199012345678' }) })
  assert.equal(again.status, 200)
  assert.equal(again.json.id, first.json.id)

  const mine = await call('GET', '/smartbuy/join-requests', { token: applicant })
  assert.equal(mine.status, 200)
  assert.ok(mine.json.items.some((r) => r.id === first.json.id))
  const agentView = await call('GET', '/smartbuy/join-requests', { token: agentTok })
  assert.ok(!agentView.json.items.some((r) => r.id === first.json.id), 'another account never sees it')

  const dup = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ nic_number: '199012345678' }) })
  assert.equal(dup.status, 409, 'a second pending request for the same person is refused')

  const list = await admin('GET', '/admin/join-requests?status=pending')
  assert.equal(list.status, 200)
  const row = list.json.items.find((r) => r.id === first.json.id)
  assert.ok(row)
  assert.equal(row.agent_code, 'AG001')
  assert.equal(row.branch_name, 'Kandy')
  assert.equal(row.nic_number, '199012345678')
})

test('JOIN-05 approve: member enrolled at the chosen branch under the typed agent, NIC never reaches customers, applicant notified; reject needs a reason', async () => {
  const sub = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ phone: '0775551235', nic_number: '801234567X' }) })
  assert.equal(sub.status, 201, JSON.stringify(sub.json))
  created.requests.push(sub.json.id)

  assert.equal((await admin('POST', `/admin/join-requests/${sub.json.id}/decision`, { decision: 'reject' })).status, 400)
  const ok = await admin('POST', `/admin/join-requests/${sub.json.id}/decision`, { decision: 'approve', decided_by: 'test' })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.status, 'approved')
  assert.equal((await admin('POST', `/admin/join-requests/${sub.json.id}/decision`, { decision: 'approve' })).status, 409, 'decided twice')

  const c = await db()
  try {
    const [[m]] = await c.query(`SELECT agent_id, enrolled_branch_id, status FROM chit_members WHERE id = ?`, [ok.json.member_id])
    assert.equal(m.agent_id, seed.agent_id, 'the typed agent keeps the credit')
    assert.equal(m.enrolled_branch_id, seed.branches.kandy, 'enrolled at the branch the applicant picked')
    const [cols] = await c.query(`SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'customers'`, [seed.db_schema])
    assert.ok(!cols.some((x) => /nic/i.test(x.c)), 'cloud customers has no NIC column')
    const [[n]] = await c.query(`SELECT COUNT(*) AS n FROM notification_jobs WHERE user_id = ? AND dedupe_key = ?`, [seed.logins.other_customer.user_id, `join:${sub.json.id}:approve`])
    assert.equal(Number(n.n), 1, 'push job queued for the applicant (inbox row is written alongside)')
  } finally { await c.end() }
  const mine = await call('GET', '/smartbuy/join-requests', { token: applicant })
  assert.equal(mine.json.items.find((r) => r.id === sub.json.id).status, 'approved')

  // Reject path with a reason, visible to the applicant.
  const sub2 = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ phone: '0775551236', nic_number: '701234567V' }) })
  assert.equal(sub2.status, 201, JSON.stringify(sub2.json))
  const rej = await admin('POST', `/admin/join-requests/${sub2.json.id}/decision`, { decision: 'reject', reason: 'NIC photo is blurry' })
  assert.equal(rej.status, 200)
  const after = await call('GET', '/smartbuy/join-requests', { token: applicant })
  const r2 = after.json.items.find((r) => r.id === sub2.json.id)
  assert.equal(r2.status, 'rejected')
  assert.equal(r2.reject_reason, 'NIC photo is blurry')
})

test('JOIN-06 retention: NIC number + photo refs are wiped 30 days after the decision, never before; pending is never purged', async () => {
  const sub = await call('POST', '/smartbuy/join-requests', { token: applicant, form: joinForm({ phone: '0775551237', nic_number: '601234567V' }) })
  assert.equal(sub.status, 201, JSON.stringify(sub.json))
  const id = sub.json.id
  const c = await db()
  try {
    // Pending and older than 30 days: untouched.
    await c.query(`UPDATE smartbuy_join_requests SET created_at = DATE_SUB(NOW(), INTERVAL 60 DAY) WHERE id = ?`, [id])
    await admin('GET', '/admin/join-requests')
    let [[row]] = await c.query(`SELECT nic_number, nic_front_ref, purged_at FROM smartbuy_join_requests WHERE id = ?`, [id])
    assert.equal(row.nic_number, '601234567V')
    assert.ok(row.nic_front_ref && !row.purged_at)

    // Rejected 29 days ago: kept.
    await admin('POST', `/admin/join-requests/${id}/decision`, { decision: 'reject', reason: 'test' })
    await c.query(`UPDATE smartbuy_join_requests SET decided_at = DATE_SUB(NOW(), INTERVAL 29 DAY) WHERE id = ?`, [id])
    await admin('GET', '/admin/join-requests')
    ;[[row]] = await c.query(`SELECT nic_number, nic_front_ref, purged_at FROM smartbuy_join_requests WHERE id = ?`, [id])
    assert.equal(row.nic_number, '601234567V')

    // Rejected 31 days ago: wiped; name, phone, decision stay.
    await c.query(`UPDATE smartbuy_join_requests SET decided_at = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE id = ?`, [id])
    await admin('GET', '/admin/join-requests')
    ;[[row]] = await c.query(`SELECT nic_number, nic_front_ref, nic_back_ref, purged_at, full_name, status FROM smartbuy_join_requests WHERE id = ?`, [id])
    assert.equal(row.nic_number, '')
    assert.equal(row.nic_front_ref, null)
    assert.equal(row.nic_back_ref, null)
    assert.ok(row.purged_at)
    assert.equal(row.full_name, 'Kamal Join Test')
    assert.equal(row.status, 'rejected')
  } finally { await c.end() }
})
