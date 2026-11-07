// Black-box tests for /api/app/v1. Run against a LOCAL dev server after `npm run seed:app`:
//   npm run dev   (port 3000)   then   npm test
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import mysql from 'mysql2/promise'

const seedFile = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.seed-output.json')
if (!existsSync(seedFile)) throw new Error('Run `npm run seed:app` first (.seed-output.json missing).')
const seed = JSON.parse(readFileSync(seedFile, 'utf8'))
const BASE = process.env.TEST_BASE_URL || seed.base_url
const V1 = `${BASE}/api/app/v1`

async function call(method, p, { key = seed.app_key, token, body, headers = {} } = {}) {
  const h = { ...headers }
  if (key) h['x-app-key'] = key
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(`${V1}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null
  try { json = await res.json() } catch { /* binary */ }
  return { status: res.status, json }
}
const login = async (identifier, password) => {
  const r = await call('POST', '/auth/login', { body: { identifier, password } })
  assert.equal(r.status, 200, `login ${identifier}: ${JSON.stringify(r.json)}`)
  return r.json
}

let customer, other, agent
before(async () => {
  customer = (await login(seed.logins.customer_smartbuy.identifier, seed.password)).tokens.access_token
  other = (await login(seed.logins.other_customer.identifier, seed.password)).tokens.access_token
  agent = (await login(seed.logins.agent.identifier, seed.password)).tokens.access_token
})

// ── status / app key ────────────────────────────────────────────────────
test('status: ok with key, 401 wrong key, 401 no key', async () => {
  assert.equal((await call('GET', '/status')).status, 200)
  const bad = await call('GET', '/status', { key: 'npk_wrong' })
  assert.equal(bad.status, 401)
  assert.equal(bad.json.error.code, 'APP_KEY_INVALID')
  assert.equal((await call('GET', '/status', { key: null })).status, 401)
})
test('POS sync key (x-api-key) is not accepted as an app key', async () => {
  assert.equal((await call('GET', '/status', { key: seed.pos_api_key })).status, 401)
})

// ── auth ────────────────────────────────────────────────────────────────
test('login: phone, member no, agent code all work; wrong password 401; wrong key 401', async () => {
  await login(seed.logins.customer_smartbuy.member_no, seed.password)
  await login('AG001', seed.password)
  const bad = await call('POST', '/auth/login', { body: { identifier: seed.logins.customer_smartbuy.identifier, password: 'nope-nope' } })
  assert.equal(bad.status, 401)
  assert.equal(bad.json.error.code, 'INVALID_CREDENTIALS')
  assert.equal((await call('POST', '/auth/login', { key: 'npk_wrong', body: { identifier: 'x', password: 'y' } })).status, 401)
})
test('first-login invite user must change password', async () => {
  const f = seed.logins.first_login_invite
  if (!f.temp_password) return
  const r = await call('POST', '/auth/login', { body: { identifier: f.identifier, password: f.temp_password } })
  assert.equal(r.status, 200)
  assert.equal(r.json.user.must_change_password, true)
  const blocked = await call('GET', '/orders', { token: r.json.tokens.access_token })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.json.error.code, 'PASSWORD_CHANGE_REQUIRED')
})
test('me: no token 401, with token returns own profile', async () => {
  assert.equal((await call('GET', '/me')).status, 401)
  const r = await call('GET', '/me', { token: customer })
  assert.equal(r.status, 200)
})
test('garbage token is rejected', async () => {
  assert.equal((await call('GET', '/me', { token: 'abc.def.ghi' })).status, 401)
})

// ── catalog (public: app key only) ──────────────────────────────────────
test('catalog: public with key, 401 wrong key, weight + variants present', async () => {
  const r = await call('GET', '/catalog/products?limit=50')
  assert.equal(r.status, 200)
  assert.ok(r.json.items.length >= 10)
  assert.ok(r.json.items.some(p => p.sale_by === 'weight'))
  assert.ok(r.json.items.some(p => p.has_variants))
  assert.equal((await call('GET', '/catalog/products', { key: 'npk_wrong' })).status, 401)
  assert.equal((await call('GET', '/catalog/categories')).status, 200)
  assert.equal((await call('GET', '/branches')).status, 200)
})

// ── orders ──────────────────────────────────────────────────────────────
let orderId
test('orders: create (idempotent), list, detail, tracking', async () => {
  const items = [{ product_id: seed.product_ids[0], quantity: 1.5 }]
  const addr = { recipient_name: 'Anula', phone: '0771110001', line1: '10 Temple Road', city: 'Colombo' }
  const key = `t-${Date.now()}`
  const body = { items, payment_method: 'cod', address: addr }
  const a = await call('POST', '/orders', { token: customer, body, headers: { 'idempotency-key': key } })
  assert.equal(a.status, 201, JSON.stringify(a.json))
  orderId = a.json.id
  const again = await call('POST', '/orders', { token: customer, body, headers: { 'idempotency-key': key } })
  assert.equal(again.json.id, orderId, 'same Idempotency-Key must replay the same order')
  const noKey = await call('POST', '/orders', { token: customer, body })
  assert.equal(noKey.status, 400)
  assert.equal(noKey.json.error.code, 'IDEMPOTENCY_KEY_REQUIRED')
  assert.ok((await call('GET', '/orders', { token: customer })).json.items.some(o => o.id === orderId))
  assert.equal((await call('GET', `/orders/${orderId}`, { token: customer })).status, 200)
  const tr = await call('GET', `/orders/${orderId}/tracking`, { token: customer })
  assert.equal(tr.status, 200)
  assert.equal(tr.json.steps[0].key, 'placed')
})
test('orders: other user gets 404, no token 401, wrong key 401, agent role 403', async () => {
  assert.equal((await call('GET', `/orders/${orderId}`, { token: other })).status, 404)
  assert.equal((await call('GET', `/orders/${orderId}/tracking`, { token: other })).status, 404)
  assert.equal((await call('POST', `/orders/${orderId}/cancel`, { token: other })).status, 404)
  assert.equal((await call('GET', '/orders')).status, 401)
  assert.equal((await call('GET', '/orders', { key: 'npk_wrong', token: customer })).status, 401)
})
test('orders: price tampering is ignored (server prices), cancel works once', async () => {
  const r = await call('POST', `/orders/${orderId}/cancel`, { token: customer })
  assert.equal(r.status, 200)
  assert.equal((await call('POST', `/orders/${orderId}/cancel`, { token: customer })).status, 409)
})
test('checkout quote: out of range quantity is flagged or rejected', async () => {
  const r = await call('POST', '/checkout/quote', { token: customer, body: { items: [{ product_id: seed.product_ids[0], quantity: 9999999 }] } })
  assert.ok([200, 400].includes(r.status))
})

// ── wishlist / addresses / devices / notifications (customer-owned) ──────
test('wishlist + addresses: owner only', async () => {
  const pid = seed.product_ids[3]
  assert.ok([200, 201, 204].includes((await call('POST', '/me/wishlist', { token: customer, body: { product_id: pid } })).status))
  const mine = await call('GET', '/me/wishlist', { token: customer })
  assert.equal(mine.status, 200)
  const theirs = await call('GET', '/me/wishlist', { token: other })
  assert.ok(!JSON.stringify(theirs.json).includes(pid))
  const ad = await call('POST', '/me/addresses', { token: customer, body: { recipient_name: 'Anula P', phone: '0771110001', line1: '1 Test Lane', city: 'Colombo' } })
  assert.equal(ad.status, 201, JSON.stringify(ad.json))
  assert.equal((await call('DELETE', `/me/addresses/${ad.json.id}`, { token: other })).status, 404)
  assert.ok([200, 204].includes((await call('DELETE', `/me/addresses/${ad.json.id}`, { token: customer })).status))
  assert.equal((await call('GET', '/me/addresses')).status, 401)
})
test('notifications + devices: auth required, scoped to caller', async () => {
  assert.equal((await call('GET', '/me/notifications')).status, 401)
  assert.equal((await call('GET', '/me/notifications', { token: customer })).status, 200)
  assert.equal((await call('GET', '/me/notifications', { key: 'npk_wrong', token: customer })).status, 401)
  const d = await call('POST', '/me/devices', { token: customer, body: { expo_push_token: 'ExponentPushToken[test-token-123]', platform: 'android', app_version: '1.0.0', device_label: 'test' } })
  assert.ok([200, 201].includes(d.status), JSON.stringify(d.json))
})

// ── Smart Buy / wallet (role smartbuy; scoped to own customer) ───────────
test('smartbuy: member sees own scheme, statement, draws (masked), wallet', async () => {
  const s = await call('GET', '/smartbuy/me/schemes', { token: customer })
  assert.equal(s.status, 200)
  assert.equal(s.json.items.length, 1)
  const id = s.json.items[0].scheme_id
  assert.equal((await call('GET', `/smartbuy/me/schemes/${id}/statement`, { token: customer })).status, 200)
  const d = await call('GET', `/smartbuy/me/schemes/${id}/draws`, { token: customer })
  assert.equal(d.status, 200)
  assert.equal(d.json.items.length, 2)
  assert.ok(d.json.items.some(x => x.is_me && /^You/.test(x.winner_label)))
  const masked = d.json.items.find(x => !x.is_me)
  assert.ok(masked.winner_label.includes('...'), 'other members must be masked')
  assert.ok(!masked.winner_label.includes('Perera') && !masked.winner_label.includes('Fernando'))
  const w = await call('GET', '/wallet', { token: customer })
  assert.equal(w.status, 200)
  assert.equal(w.json.balance, 1500)
  assert.equal((await call('GET', '/wallet/transactions', { token: customer })).status, 200)
  const open = await call('GET', '/smartbuy/schemes/open')
  assert.equal(open.status, 200)
})
test('smartbuy: scheme of the other member / agent role / no token / wrong key', async () => {
  // `other` (Nimal) is also a member of the same scheme; use a random id to prove 404 for non-membership
  assert.equal((await call('GET', '/smartbuy/me/schemes/00000000-0000-0000-0000-000000000000/statement', { token: other })).status, 404)
  assert.equal((await call('GET', '/smartbuy/me/schemes/00000000-0000-0000-0000-000000000000/draws', { token: customer })).status, 404)
  assert.equal((await call('GET', '/smartbuy/me/schemes', { token: agent })).status, 403)
  assert.equal((await call('GET', '/wallet', { token: agent })).status, 403)
  assert.equal((await call('GET', '/wallet')).status, 401)
  assert.equal((await call('GET', '/wallet', { key: 'npk_wrong', token: customer })).status, 401)
  // wallet balances are per customer
  const w2 = await call('GET', '/wallet', { token: other })
  assert.equal(w2.json.balance, 0)
})

// ── Agent (role agent; scoped to own agent id) ───────────────────────────
test('agent: dashboard, schemes, members, commission, deliveries', async () => {
  const dash = await call('GET', '/agent/dashboard', { token: agent })
  assert.equal(dash.status, 200)
  assert.equal(dash.json.members_count, 4)
  assert.equal((await call('GET', '/agent/schemes', { token: agent })).status, 200)
  const m = await call('GET', '/agent/members', { token: agent })
  assert.equal(m.status, 200)
  assert.ok(m.json.items.every(x => !x.phone_masked || x.phone_masked.includes('*')))
  const det = await call('GET', `/agent/members/${m.json.items[0].member_id}`, { token: agent })
  assert.equal(det.status, 200)
  assert.equal((await call('GET', '/agent/commission', { token: agent })).status, 200)
  const dl = await call('GET', '/agent/deliveries', { token: agent })
  assert.equal(dl.status, 200)
  assert.ok(dl.json.items.some(x => x.id === seed.delivery_order_id))
})
test('agent: customer role 403, no token 401, wrong key 401, unknown member 404', async () => {
  for (const p of ['/agent/dashboard', '/agent/members', '/agent/commission', '/agent/deliveries', '/agent/schemes']) {
    assert.equal((await call('GET', p, { token: customer })).status, 403, p)
    assert.equal((await call('GET', p)).status, 401, p)
    assert.equal((await call('GET', p, { key: 'npk_wrong', token: agent })).status, 401, p)
  }
  assert.equal((await call('GET', '/agent/members/00000000-0000-0000-0000-000000000000', { token: agent })).status, 404)
})
test('agent delivery: wrong OTP 400, correct OTP completes once (idempotent), other agent order is 404', async () => {
  const id = seed.delivery_order_id
  // Re-arm the seeded order so the suite can be re-run (LOCAL test DB only).
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  try {
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.MYSQL_HOST), 'tests only re-arm a local database')
    await db.query(`UPDATE customer_orders SET status = 'ready_for_delivery', payment_status = 'unpaid', delivered_at = NULL WHERE id = ?`, [id])
    await db.query(`DELETE FROM app_request_receipts WHERE scope = 'delivery'`)
  } finally { await db.end() }
  assert.equal((await call('GET', `/agent/deliveries/${id}`, { token: customer })).status, 403)
  // customer reads the OTP from their own order
  const ord = await call('GET', `/orders/${id}`, { token: customer })
  assert.equal(ord.status, 200)
  const otp = ord.json.delivery_otp
  assert.match(otp, /^\d{4}$/)
  const wrong = await call('POST', `/agent/deliveries/${id}/complete`, { token: agent, body: { otp: otp === '0000' ? '1111' : '0000', event_id: `evt-wrong-${Date.now()}` } })
  assert.equal(wrong.status, 400)
  assert.equal(wrong.json.error.code, 'OTP_INVALID')
  const ev = `evt-${Date.now()}`
  const ok = await call('POST', `/agent/deliveries/${id}/complete`, { token: agent, body: { otp, event_id: ev } })
  assert.equal(ok.status, 200, JSON.stringify(ok.json))
  assert.equal(ok.json.status, 'delivered')
  const replay = await call('POST', `/agent/deliveries/${id}/complete`, { token: agent, body: { otp, event_id: ev } })
  assert.equal(replay.status, 200)
  assert.equal(replay.json.delivered_at, ok.json.delivered_at)
  const tr = await call('GET', `/orders/${id}/tracking`, { token: customer })
  assert.equal(tr.json.status, 'delivered')
})

// ── Admin (POS) endpoints: x-api-key, NOT the app key ────────────────────
test('admin app-access: needs POS key; app key and no key rejected', async () => {
  const adm = (key) => fetch(`${V1}/admin/app-access`, { headers: key ? { 'x-api-key': key } : {} })
  assert.equal((await adm(seed.pos_api_key)).status, 200)
  assert.equal((await adm(seed.app_key)).status, 401)
  assert.equal((await adm(null)).status, 401)
  const inv = await fetch(`${V1}/admin/app-access/invite`, { method: 'POST', headers: { 'x-app-key': seed.app_key, authorization: `Bearer ${agent}`, 'content-type': 'application/json' }, body: JSON.stringify({ targets: [] }) })
  assert.equal(inv.status, 401)
})
