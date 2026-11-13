// App Control: banners (Colombo window, audience, order, link safety, languages), banner events, home layout, banner-stats admin route.
// Run through `npm test` (fresh seeded tenant + local dev server), same as app-api.test.mjs.
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
const BASE = process.env.TEST_BASE_URL || seed.base_url
const V1 = `${BASE}/api/app/v1`

async function call(method, p, { key = seed.app_key, token, body, headers = {} } = {}) {
  const h = { 'x-forwarded-for': `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${1 + Math.floor(Math.random() * 250)}`, ...headers }
  if (key) h['x-app-key'] = key
  if (token) h.authorization = `Bearer ${token}`
  if (body !== undefined) h['content-type'] = 'application/json'
  const res = await fetch(`${V1}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) })
  let json = null
  try { json = await res.json() } catch { /* none */ }
  return { status: res.status, json }
}
const login = async (identifier) => (await call('POST', '/auth/login', { body: { identifier, password: seed.password } })).json.tokens.access_token
const dbConn = () => mysql.createConnection({ host: process.env.MYSQL_HOST, port: +process.env.MYSQL_PORT, user: process.env.MYSQL_USER, password: process.env.MYSQL_PASSWORD, database: seed.db_schema })

// Asia/Colombo wall time, shifted by `hours`
const wall = (hours = 0) => new Date(Date.now() + 330 * 60000 + hours * 3600000).toISOString().slice(0, 19).replace('T', ' ')
const IMG = 'https://img.example.test/banner.png'

let db, memberToken, otherToken, memberCustomerId, otherCustomerId
const made = []
async function banner(o = {}) {
  const id = randomUUID()
  made.push(id)
  const r = { title: `T-${id.slice(0, 6)}`, is_active: 1, sort_order: 0, image_url: IMG, audience: 'all', link_type: 'none', ...o }
  const cols = Object.keys(r)
  await db.query(`INSERT INTO app_banners (id, ${cols.join(',')}) VALUES (?, ${cols.map(() => '?').join(',')})`, [id, ...cols.map(c => r[c])])
  return id
}
const ids = (res) => res.json.items.map(i => i.id).filter(i => made.includes(i))

before(async () => {
  await call('GET', '/status') // runs ensureTenantCompatibility (new columns / tables)
  db = await dbConn()
  await db.query(`DELETE FROM app_banners`) // the fresh test tenant: start from an empty banner list
  memberToken = await login(seed.logins.customer_smartbuy.identifier)
  otherToken = await login(seed.logins.other_customer.identifier)
  memberCustomerId = seed.logins.customer_smartbuy.customer_id
  otherCustomerId = seed.logins.other_customer.customer_id
  await db.query(`UPDATE chit_members SET status='active' WHERE customer_id = ?`, [memberCustomerId])
})
after(async () => {
  if (made.length) await db.query(`DELETE FROM app_banners WHERE id IN (?)`, [made])
  if (made.length) await db.query(`DELETE FROM app_banner_stats WHERE banner_id IN (?)`, [made])
  await db.query(`DELETE FROM app_settings WHERE setting_key = 'home_layout'`)
  await db.end()
})

test('banners: wrong or missing App Key is 401', async () => {
  assert.equal((await call('GET', '/catalog/banners', { key: 'npk_wrong' })).status, 401)
  assert.equal((await call('GET', '/catalog/banners', { key: null })).status, 401)
  assert.equal((await call('GET', '/catalog/home-layout', { key: 'npk_wrong' })).status, 401)
  assert.equal((await call('POST', '/catalog/banners/events', { key: 'npk_wrong', body: { events: [{ banner_id: 'x', type: 'tap' }] } })).status, 401)
})

test('banners: date window is Asia/Colombo wall time', async () => {
  const live = await banner({ starts_at: wall(-1), ends_at: wall(1) })
  const open = await banner({})
  const future = await banner({ starts_at: wall(1) })
  // would still look "live" if the wall time were read as UTC (UTC is 5.5 h behind Colombo): must be hidden
  const endedColombo = await banner({ ends_at: wall(-1) })
  const inactive = await banner({ is_active: 0 })
  const r = await call('GET', '/catalog/banners')
  assert.equal(r.status, 200)
  const got = ids(r)
  assert.ok(got.includes(live) && got.includes(open))
  for (const hidden of [future, endedColombo, inactive]) assert.ok(!got.includes(hidden))
  await db.query(`DELETE FROM app_banners WHERE id IN (?)`, [[live, open, future, endedColombo, inactive]])
})

test('banners: audience filtering for guest, customer and Smart Buy member', async () => {
  const all = await banner({ audience: 'all' }), g = await banner({ audience: 'guests' }), c = await banner({ audience: 'customers' }), m = await banner({ audience: 'members' })
  const guest = ids(await call('GET', '/catalog/banners'))
  assert.deepEqual([all, g].filter(x => guest.includes(x)).length, 2); assert.ok(!guest.includes(c) && !guest.includes(m))
  const badToken = ids(await call('GET', '/catalog/banners', { token: 'not-a-jwt' }))
  assert.ok(badToken.includes(g) && !badToken.includes(m)) // invalid token = guest
  const member = ids(await call('GET', '/catalog/banners', { token: memberToken }))
  assert.ok(member.includes(all) && member.includes(m) && !member.includes(g) && !member.includes(c))
  // a signed-in customer without an active membership is a plain customer
  await db.query(`UPDATE chit_members SET status='withdrawn' WHERE customer_id = ?`, [otherCustomerId])
  try {
    const cust = ids(await call('GET', '/catalog/banners', { token: otherToken }))
    assert.ok(cust.includes(all) && cust.includes(c) && !cust.includes(g) && !cust.includes(m))
  } finally {
    await db.query(`UPDATE chit_members SET status='active' WHERE customer_id = ? AND status='withdrawn'`, [otherCustomerId])
  }
  await db.query(`DELETE FROM app_banners WHERE id IN (?)`, [[all, g, c, m]])
})

test('banners: ordered by sort_order then newest, at most 10', async () => {
  await db.query(`DELETE FROM app_banners`)
  const a = await banner({ sort_order: 5, created_at: '2026-01-01 10:00:00' })
  const b = await banner({ sort_order: 1, created_at: '2026-01-01 09:00:00' })
  const c = await banner({ sort_order: 5, created_at: '2026-01-02 10:00:00' })
  assert.deepEqual(ids(await call('GET', '/catalog/banners')), [b, c, a])
  for (let i = 0; i < 12; i++) await banner({ sort_order: 100 + i })
  const r = await call('GET', '/catalog/banners')
  assert.equal(r.json.items.length, 10)
  assert.deepEqual(r.json.items.slice(0, 3).map(i => i.id), [b, c, a])
  assert.ok(r.json.items.every(i => typeof i.sort_order === 'number' && i.image_url))
  await db.query(`DELETE FROM app_banners`)
})

test('banners: only https links survive; old link_url reads as url; product/flash links', async () => {
  const js = await banner({ link_type: 'url', link_target: 'javascript:alert(1)' })
  const http = await banner({ link_type: 'url', link_target: 'http://example.com/x' })
  const custom = await banner({ link_type: 'none', link_url: 'lankahome://product/1' })
  const ok = await banner({ link_type: 'url', link_target: 'https://example.com/x' })
  const old = await banner({ link_type: 'none', link_url: 'https://example.com/old' })
  const prod = await banner({ link_type: 'product', link_target: 'p-123' })
  const flash = await banner({ link_type: 'flash', link_target: 'ignored' })
  const none = await banner({})
  const by = Object.fromEntries((await call('GET', '/catalog/banners')).json.items.map(i => [i.id, i]))
  assert.equal(by[js].link, null); assert.equal(by[http].link, null); assert.equal(by[custom].link, null); assert.equal(by[none].link, null)
  assert.deepEqual(by[ok].link, { type: 'url', target: 'https://example.com/x' })
  assert.deepEqual(by[old].link, { type: 'url', target: 'https://example.com/old' })
  assert.deepEqual(by[prod].link, { type: 'product', target: 'p-123' })
  assert.deepEqual(by[flash].link, { type: 'flash', target: null })
  await db.query(`DELETE FROM app_banners`)
})

test('banners: per-language image and optional title', async () => {
  const id = await banner({ title: '', image_ta: 'https://img.example.test/ta.png', image_si: null })
  const find = (res) => res.json.items.find(i => i.id === id)
  assert.equal(find(await call('GET', '/catalog/banners?lang=ta')).image_url, 'https://img.example.test/ta.png')
  assert.equal(find(await call('GET', '/catalog/banners?lang=si')).image_url, IMG)
  const en = find(await call('GET', '/catalog/banners?lang=en'))
  assert.equal(en.image_url, IMG); assert.ok(!('title' in en) || en.title == null)
  assert.equal(find(await call('GET', '/catalog/banners?lang=xx')).image_url, IMG)
  await db.query(`DELETE FROM app_banners`)
})

test('events: counts impressions and taps per Colombo day, ignores unknown banners, validates', async () => {
  const id = await banner({})
  const send = (events, o) => call('POST', '/catalog/banners/events', { body: { events }, ...o })
  const r = await send([{ banner_id: id, type: 'impression' }, { banner_id: id, type: 'impression' }, { banner_id: id, type: 'tap' }, { banner_id: 'no-such-banner', type: 'tap' }])
  assert.equal(r.status, 200); assert.equal(r.json.accepted, 3)
  await send([{ banner_id: id, type: 'impression' }])
  const [rows] = await db.query(`SELECT DATE_FORMAT(day,'%Y-%m-%d') AS day, impressions, taps FROM app_banner_stats WHERE banner_id = ?`, [id])
  assert.equal(rows.length, 1); assert.equal(rows[0].day, wall().slice(0, 10)); assert.equal(rows[0].impressions, 3); assert.equal(rows[0].taps, 1)
  const [junk] = await db.query(`SELECT 1 FROM app_banner_stats WHERE banner_id = 'no-such-banner'`)
  assert.equal(junk.length, 0)
  assert.equal((await send(Array.from({ length: 51 }, () => ({ banner_id: id, type: 'tap' })))).status, 400)
  assert.equal((await send([{ banner_id: id, type: 'click' }])).status, 400)
  assert.equal((await send([])).status, 400)
  assert.equal((await call('POST', '/catalog/banners/events', { body: { events: [{ banner_id: id, type: 'tap' }], user: 'x' } })).status, 400)
})

test('home-layout: default order, stored layout, bad JSON falls back', async () => {
  await db.query(`DELETE FROM app_settings WHERE setting_key = 'home_layout'`)
  const keys = ['banners', 'categories', 'flash_deals', 'smartbuy_promo', 'new_arrivals', 'featured']
  const d = await call('GET', '/catalog/home-layout')
  assert.equal(d.status, 200)
  assert.deepEqual(d.json.sections, keys.map(key => ({ key, enabled: true })))
  const stored = [{ key: 'featured', enabled: true }, { key: 'banners', enabled: false }, { key: 'bogus', enabled: true }, { key: 'categories', enabled: true }]
  await db.query(`INSERT INTO app_settings (id, setting_key, value) VALUES ('home_layout','home_layout',?)`, [JSON.stringify(stored)])
  const s = await call('GET', '/catalog/home-layout')
  assert.deepEqual(s.json.sections.map(x => x.key), ['featured', 'banners', 'categories', 'flash_deals', 'smartbuy_promo', 'new_arrivals'])
  assert.equal(s.json.sections[1].enabled, false)
  await db.query(`UPDATE app_settings SET value='{not json' WHERE setting_key='home_layout'`)
  assert.deepEqual((await call('GET', '/catalog/home-layout')).json.sections.map(x => x.key), keys)
})

test('admin banner-stats: 401 without key, 401 with an App Key, 200 with the POS key', async () => {
  assert.equal((await call('GET', '/admin/banner-stats', { key: null })).status, 401)
  assert.equal((await call('GET', '/admin/banner-stats')).status, 401) // x-app-key is not accepted here
  assert.equal((await call('GET', '/admin/banner-stats', { key: null, headers: { 'x-api-key': 'wrong' } })).status, 401)
  const id = await banner({})
  await call('POST', '/catalog/banners/events', { body: { events: [{ banner_id: id, type: 'impression' }, { banner_id: id, type: 'tap' }] } })
  const ok = await call('GET', '/admin/banner-stats', { key: null, headers: { 'x-api-key': seed.pos_api_key } })
  assert.equal(ok.status, 200)
  assert.deepEqual(ok.json.items.find(i => i.banner_id === id), { banner_id: id, impressions: 1, taps: 1 })
  assert.equal((await call('GET', '/admin/banner-stats?from=bad', { key: null, headers: { 'x-api-key': seed.pos_api_key } })).status, 400)
})

test('products: featured flag and created_at are exposed', async () => {
  const list = await call('GET', '/catalog/products?limit=5')
  assert.equal(list.status, 200)
  const p = list.json.items[0]
  assert.equal(p.featured, false); assert.ok(p.created_at)
  await db.query(`UPDATE products SET is_featured = 1 WHERE id = ?`, [p.id])
  try {
    const again = (await call('GET', '/catalog/products?limit=100')).json.items.find(i => i.id === p.id)
    assert.equal(again.featured, true)
  } finally { await db.query(`UPDATE products SET is_featured = 0 WHERE id = ?`, [p.id]) }
})
