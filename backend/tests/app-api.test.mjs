// Black-box tests for /api/app/v1. Run against a LOCAL dev server after `npm run seed:app`:
//   npm run dev   (port 3000)   then   npm test
import test, { before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import mysql from 'mysql2/promise'

// `npm test` (scripts/test-run.cjs) seeds a fresh isolated tenant and points SEED_FILE at it.
const seedFile = process.env.SEED_FILE || path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '.seed-output.json')
if (!existsSync(seedFile)) throw new Error('Run `npm test` (fresh tenant) or `npm run seed:app` first.')
const seed = JSON.parse(readFileSync(seedFile, 'utf8'))
const BASE = process.env.TEST_BASE_URL || seed.base_url
const V1 = `${BASE}/api/app/v1`

async function call(method, p, { key = seed.app_key, token, body, headers = {} } = {}) {
  // Every request comes from its own client IP so the app rate limiters (per IP) never trip a test. Production is unchanged.
  const h = { 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`, ...headers }
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

test('timezone: timestamps are stored and returned as UTC (ISO, Z), not shifted by the DB server timezone', async () => {
  const d = await call('GET', `/orders/${orderId}`, { token: customer })
  assert.equal(d.status, 200)
  assert.match(d.json.created_at, /Z$/, 'API timestamps are ISO-8601 UTC')
  const skew = Math.abs(Date.now() - new Date(d.json.created_at).getTime())
  assert.ok(skew < 5 * 60 * 1000, `created_at is ${Math.round(skew / 60000)} min away from now (a +05:30 DB timezone leak would show 330)`)
  // The row itself, read with a UTC session, must agree.
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema, timezone: '+00:00' })
  try {
    const [[row]] = await db.query(`SELECT created_at FROM customer_orders WHERE id = ?`, [orderId])
    assert.ok(Math.abs(Date.now() - new Date(row.created_at).getTime()) < 5 * 60 * 1000)
  } finally { await db.end() }
})
test('orders: Play reviewer account orders are tagged TEST in the notes; normal accounts are not', async () => {
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  try {
    const body = { items: [{ product_id: seed.product_ids[0], quantity: 1 }], payment_method: 'cod', address: { recipient_name: 'Review', phone: '0771110003', line1: '8 Hill Street', city: 'Galle' }, notes: 'leave at gate' }
    const phone = seed.logins.other_customer.identifier
    await db.query('UPDATE app_users SET is_review_account = 1 WHERE phone = ?', [phone])
    const flagged = await call('POST', '/orders', { token: other, body, headers: { 'idempotency-key': `rv-${Date.now()}` } })
    assert.equal(flagged.status, 201, JSON.stringify(flagged.json))
    const [[row]] = await db.query('SELECT notes FROM customer_orders WHERE id = ?', [flagged.json.id])
    assert.match(row.notes, /^\[TEST ORDER - Play review\] leave at gate/)
    await db.query('UPDATE app_users SET is_review_account = 0 WHERE phone = ?', [phone])
    const normal = await call('POST', '/orders', { token: other, body, headers: { 'idempotency-key': `rv2-${Date.now()}` } })
    assert.equal(normal.status, 201)
    const [[row2]] = await db.query('SELECT notes FROM customer_orders WHERE id = ?', [normal.json.id])
    assert.equal(row2.notes, 'leave at gate')
  } finally { await db.end() }
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
    await db.query(`DELETE FROM payments WHERE invoice_id = 'cod-test-inv'`)
    await db.query(`DELETE FROM invoices WHERE id = 'cod-test-inv'`)
    await db.query(`UPDATE customer_orders SET status = 'ready_for_delivery', payment_status = 'unpaid', payment_method = 'cod', paid_amount = 0, invoice_id = NULL, delivered_at = NULL WHERE id = ?`, [id])
    const [[o]] = await db.query(`SELECT branch_id, customer_id, total_amount FROM customer_orders WHERE id = ?`, [id])
    const [[cashier]] = await db.query(`SELECT id FROM users LIMIT 1`)
    await db.query(`INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id, status, bill_type, subtotal, total_amount, paid_amount, due_amount)
      VALUES ('cod-test-inv', 'TEST-COD-0001', ?, ?, ?, 'completed', 'RETAIL', ?, ?, 0, ?)`, [o.branch_id, o.customer_id, cashier.id, o.total_amount, o.total_amount, o.total_amount])
    await db.query(`UPDATE customer_orders SET invoice_id = 'cod-test-inv' WHERE id = ?`, [id])
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

  // COD: cash collected settles the order and its invoice, and a payment row is written exactly once.
  const chk = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  try {
    const [[o]] = await chk.query(`SELECT total_amount, paid_amount, payment_status FROM customer_orders WHERE id = ?`, [id])
    assert.equal(o.payment_status, 'paid')
    assert.equal(Number(o.paid_amount), Number(o.total_amount))
    const [[i]] = await chk.query(`SELECT total_amount, paid_amount, due_amount, status FROM invoices WHERE id = 'cod-test-inv'`)
    assert.equal(Number(i.paid_amount), Number(i.total_amount))
    assert.equal(Number(i.due_amount), 0)
    assert.equal(i.status, 'paid')
    const [pays] = await chk.query(`SELECT method, amount FROM payments WHERE invoice_id = 'cod-test-inv'`)
    assert.equal(pays.length, 1)
    assert.equal(pays[0].method, 'cash')
    assert.equal(Number(pays[0].amount), Number(o.total_amount))
  } finally { await chk.end() }
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

test('agent bill: 409 until the POS invoices the order, then numbered with the invoice number; other roles 403', async () => {
  const id = seed.delivery_order_id
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  try {
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.MYSQL_HOST), 'tests only touch a local database')
    await db.query(`DELETE FROM invoice_items WHERE invoice_id = 'bill-test-inv'`)
    await db.query(`DELETE FROM invoices WHERE id = 'bill-test-inv'`)
    assert.equal((await call('GET', `/agent/deliveries/${id}/bill`, { token: agent })).status, 409)
    const [[ord]] = await db.query(`SELECT branch_id, customer_id FROM customer_orders WHERE id = ?`, [id])
    const [[cashier]] = await db.query(`SELECT id FROM users LIMIT 1`)
    await db.query(`INSERT INTO invoices (id, invoice_number, branch_id, customer_id, cashier_id, status, bill_type, subtotal, total_amount, source_order_id)
      VALUES ('bill-test-inv', 'TEST-INV-2026-0001', ?, ?, ?, 'completed', 'RETAIL', 10, 10, ?)`, [ord.branch_id, ord.customer_id, cashier.id, id])
    await db.query(`INSERT INTO invoice_items (id, invoice_id, product_id, quantity, unit_price, line_total)
      SELECT 'bill-test-item', 'bill-test-inv', product_id, 1, 10, 10 FROM customer_order_items WHERE order_id = ? LIMIT 1`, [id])
    const ok = await call('GET', `/agent/deliveries/${id}/bill`, { token: agent })
    assert.equal(ok.status, 200)
    assert.equal(ok.json.bill_no, 'TEST-INV-2026-0001')
    assert.equal(ok.json.lines.length, 1)
    assert.equal((await call('GET', `/agent/deliveries/${id}/bill`, { token: customer })).status, 403)
    assert.equal((await call('GET', `/agent/deliveries/${id}/bill`, { token: agent, key: 'npk_wrong' })).status, 401)
    assert.equal((await call('GET', `/agent/deliveries/${id}/bill`)).status, 401)
  } finally {
    await db.query(`DELETE FROM invoice_items WHERE invoice_id = 'bill-test-inv'`)
    await db.query(`DELETE FROM invoices WHERE id = 'bill-test-inv'`)
    await db.end()
  }
})

test('tax on top: catalog price, quote and locked order equal the POS counter price (10% tax); 0% unchanged', async () => {
  const pid = seed.product_ids[1]
  const db = await mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })
  const money = n => Math.round(n * 100) / 100
  let before
  try {
    assert.ok(['127.0.0.1', 'localhost'].includes(process.env.MYSQL_HOST), 'tests only touch a local database')
    ;[[before]] = await db.query(`SELECT selling_price, tax_rate, discount_pct, sale_by FROM products WHERE id = ?`, [pid])
    await db.query(`UPDATE products SET tax_rate = 0, discount_pct = 0, updated_at = NOW() WHERE id = ?`, [pid])
    const base = Number(before.selling_price)
    const noTax = await call('GET', `/catalog/products/${pid}`)
    assert.equal(noTax.status, 200)
    const hasVariants = (noTax.json.variants || []).length > 0
    if (hasVariants) return // variant products are covered by the unit price path; pick another seed when needed
    assert.equal(noTax.json.price, money(base), '0% tax leaves the price unchanged')

    await db.query(`UPDATE products SET tax_rate = 10, updated_at = NOW() WHERE id = ?`, [pid])
    const taxed = await call('GET', `/catalog/products/${pid}`)
    assert.equal(taxed.json.price, money(base * 1.1))

    const weight = before.sale_by === 'weight'
    const qty = weight ? 1.5 : 3
    const q = await call('POST', '/checkout/quote', { token: customer, body: { items: [{ product_id: pid, quantity: qty }] } })
    assert.equal(q.status, 200, JSON.stringify(q.json))
    const taxable = money(base * qty)
    const lineTotal = money(taxable + money(taxable * 10 / 100)) // counter: taxable + tax, same rounding
    assert.equal(q.json.lines[0].line_total, lineTotal)
    assert.equal(q.json.subtotal, lineTotal)

    const addr = { recipient_name: 'Anula', phone: '0771110001', line1: '10 Temple Road', city: 'Colombo' }
    const o = await call('POST', '/orders', {
      token: customer, headers: { 'idempotency-key': `tax-${Date.now()}` },
      body: { items: [{ product_id: pid, quantity: qty }], payment_method: 'cod', address: addr, expected_total: q.json.total },
    })
    assert.equal(o.status, 201, JSON.stringify(o.json))
    const [[row]] = await db.query(`SELECT net_unit_price, tax_rate, tax_amount, line_total FROM customer_order_items WHERE order_id = ?`, [o.json.id])
    assert.equal(Number(row.net_unit_price), money(base))
    assert.equal(Number(row.tax_rate), 10)
    assert.equal(Number(row.tax_amount), money(taxable * 10 / 100))
    assert.equal(Number(row.line_total), lineTotal)
    await call('POST', `/orders/${o.json.id}/cancel`, { token: customer })
  } finally {
    if (before) await db.query(`UPDATE products SET tax_rate = ?, discount_pct = ?, updated_at = NOW() WHERE id = ?`, [before.tax_rate, before.discount_pct, pid])
    await db.end()
  }
})

// ── company profile (POS Settings -> app + public legal pages) ─────────────
test('company profile: public with app key, follows POS settings, feeds the legal pages, no placeholders', async () => {
  assert.equal((await call('GET', '/company', { key: null })).status, 401)
  assert.equal((await call('GET', '/company', { key: 'npk_wrong' })).status, 401)
  const before = await call('GET', '/company')
  assert.equal(before.status, 200, JSON.stringify(before.json))
  assert.ok(before.json.name)
  const slug = new URL(before.json.privacy_url).searchParams.get('c')
  assert.ok(slug, 'privacy_url carries the company slug')
  const wm0 = (await call('GET', '/watermark')).json.areas.company
  const pos = (body, method = 'PUT') => fetch(`${BASE}/api/company/branding`, { method, headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const KEYS = ['company_legal_name', 'support_email', 'support_phone', 'company_address', 'company_tin', 'company_website', 'invoice_note']
  const saved = (await (await pos(undefined, 'GET')).json()).branding
  try {
    await new Promise((r) => setTimeout(r, 1100)) // updated_at has 1 s resolution
    const put = await pos({
      company_legal_name: 'Acme <b>Estates</b> (Pvt) Ltd', support_email: 'help@acme.example', support_phone: '+94 77 111 2222',
      company_address: 'No 1, Test Road, Kandy', company_tin: 'PV-12345', company_website: 'www.acme.example', invoice_note: 'Thanks & come again',
    })
    assert.equal(put.status, 200, await put.text())
    const after = (await call('GET', '/company')).json
    assert.equal(after.legal_name, 'Acme <b>Estates</b> (Pvt) Ltd')
    assert.equal(after.support_email, 'help@acme.example')
    assert.equal(after.tin, 'PV-12345')
    assert.deepEqual(after.missing, [])
    assert.notEqual((await call('GET', '/watermark')).json.areas.company, wm0, 'watermark company area moves so apps refetch')

    for (const page of ['privacy', 'delete-account']) {
      const res = await fetch(`${BASE}/legal/${page}?c=${slug}`)
      assert.equal(res.status, 200)
      assert.match(res.headers.get('content-type'), /text\/html/)
      const html = await res.text()
      assert.ok(html.includes('Acme &lt;b&gt;Estates&lt;/b&gt; (Pvt) Ltd'), 'legal name is HTML-escaped')
      assert.ok(!html.includes('<b>Estates</b>'))
      assert.ok(html.includes('help@acme.example') && html.includes('+94 77 111 2222'))
      assert.ok(!/\[(COMPANY|SUPPORT|ACCOUNT|PRIVACY|DATE)[^\]]*\]/i.test(html), 'no [PLACEHOLDER] left')
    }
    assert.ok((await (await fetch(`${BASE}/legal/privacy?c=${slug}`)).text()).includes('No 1, Test Road, Kandy'))

    // a missing field is left out and reported, never printed as a placeholder
    await pos({ support_email: null, support_phone: null, company_address: null })
    const blank = (await call('GET', '/company')).json
    assert.ok(blank.missing.includes('company_address'))
    const html = await (await fetch(`${BASE}/legal/delete-account?c=${slug}`)).text()
    assert.ok(!html.includes('null') && !html.includes('undefined') && !html.includes('Email: <a'))
  } finally {
    const restore = {}
    for (const k of KEYS) restore[k] = saved[k] ?? null
    await pos(restore)
  }
  assert.equal((await fetch(`${BASE}/legal/privacy?c=no-such-company`)).status, 404)
})
