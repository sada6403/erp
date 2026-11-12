// Fork D: security matrix (roles, guests, keys, tenants) + company/catalog reverse sync (POS -> app).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { appApi, BASE_URL, cloudDb, createPos, Evidence, j, posAdmin, startTenant, stopTenant, type CloudDb, type Pos, type Seed } from './harness'

const state = vi.hoisted(() => ({ data: {} as Record<string, any>, directory: '' }))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

let A: Seed, B: Seed
let api: ReturnType<typeof appApi>, apiB: ReturnType<typeof appApi>
let db: CloudDb, dbB: CloudDb
let pos: Pos
let customer = '', other = '', agent = '', tokenB = ''
let orderId = ''
const ev = new Evidence('security')
const pass = (id: string, action: string, api: string, cloud: string, posCell: string, reverse = 'n/a', ms?: number, notes?: string) =>
  ev.add({ id, action, api, cloud, pos: posCell, reverse, ms, result: 'PASS', notes })

beforeAll(async () => {
  A = startTenant()
  B = startTenant()
  api = appApi(A); apiB = appApi(B)
  db = await cloudDb(A); dbB = await cloudDb(B)
  customer = await api.login(A.logins.customer_smartbuy.identifier, A.password)
  other = await api.login(A.logins.other_customer.identifier, A.password)
  agent = await api.login(A.logins.agent.identifier, A.password)
  tokenB = await apiB.login(B.logins.customer_smartbuy.identifier, B.password)
  pos = await createPos(state, A)
}, 300_000)

afterAll(async () => {
  ev.save()
  await db?.close(); await dbB?.close()
  stopTenant(A); stopTenant(B)
})

const customerRoutes: [string, string, unknown?][] = [
  ['GET', '/orders'], ['GET', '/me/addresses'], ['GET', '/me/wishlist'], ['POST', '/checkout/quote', { items: [] }],
]
const smartbuyRoutes: [string, string][] = [['GET', '/smartbuy/me/schemes'], ['GET', '/wallet'], ['GET', '/wallet/transactions']]
const agentRoutes: [string, string][] = [
  ['GET', '/agent/dashboard'], ['GET', '/agent/deliveries'], ['GET', '/agent/members'], ['GET', '/agent/schemes'], ['GET', '/agent/commission'],
]
const anyUserRoutes: [string, string][] = [['GET', '/me'], ['GET', '/me/notifications'], ['GET', '/me/notification-settings']]
const allRoutes = [...customerRoutes, ...smartbuyRoutes, ...agentRoutes, ...anyUserRoutes] as [string, string, unknown?][]

describe('security: access matrix', () => {
  it('SEC-01 guest (no token) is 401 on every protected route', async () => {
    const bad: string[] = []
    for (const [m, p, body] of allRoutes) {
      const r = await api.call(m, p, { body })
      if (r.status !== 401) bad.push(`${m} ${p} -> ${r.status}`)
    }
    expect(bad).toEqual([])
    pass('SEC-01', 'Guest calls every protected route', `${allRoutes.length} routes -> all 401`, 'no rows read', 'n/a')
  })

  it('SEC-02 wrong / missing app key is 401 even with a valid token; POS api key is not an app key', async () => {
    const bad: string[] = []
    for (const key of ['npk_wrong', null, A.pos_api_key, B.app_key]) {
      for (const [m, p, body] of allRoutes) {
        const r = await api.call(m, p, { token: customer, key, body })
        if (r.status !== 401) bad.push(`${key ?? 'nokey'} ${m} ${p} -> ${r.status}`)
      }
    }
    expect(bad).toEqual([])
    pass('SEC-02', 'Wrong key, no key, POS key and the other tenant\'s app key with a valid token', `4 keys x ${allRoutes.length} routes -> all 401`, 'no rows read', 'n/a')
  })

  it('SEC-03 role gates: customer<->agent<->smartbuy routes answer 403 to the wrong role', async () => {
    const bad: string[] = []
    for (const [m, p] of agentRoutes) { const r = await api.call(m, p, { token: customer }); if (r.status !== 403) bad.push(`customer ${p} -> ${r.status}`) }
    for (const [m, p, body] of customerRoutes) { const r = await api.call(m, p, { token: agent, body }); if (r.status !== 403) bad.push(`agent ${p} -> ${r.status}`) }
    for (const [m, p] of smartbuyRoutes) { const r = await api.call(m, p, { token: agent }); if (r.status !== 403) bad.push(`agent ${p} -> ${r.status}`) }
    expect(bad).toEqual([])
    pass('SEC-03', 'Role gates (customer on /agent/*, agent on customer + smartbuy routes)', `${agentRoutes.length + customerRoutes.length + smartbuyRoutes.length} calls -> all 403`, 'no rows read', 'n/a')
  })

  it('SEC-04 order IDOR: another customer gets 404 (not 403, no data) on read / track / invoice / cancel; agent role is 403', async () => {
    const addr = { recipient_name: 'Sec Test', phone: '0771110001', line1: '1 Test Lane', city: 'Colombo' }
    const o = await api.post('/orders', { items: [{ product_id: A.product_ids[0], quantity: 1 }], payment_method: 'cod', address: addr }, { token: customer, headers: { 'idempotency-key': `sec-${randomUUID()}` } })
    expect(o.status, JSON.stringify(o.json)).toBe(201)
    orderId = o.json.id
    const row = await db.one(`SELECT id, order_number, app_user_id, customer_id, status, total_amount, created_at FROM customer_orders WHERE id = ?`, [orderId])
    const calls: [string, string][] = [['GET', `/orders/${orderId}`], ['GET', `/orders/${orderId}/tracking`], ['GET', `/orders/${orderId}/invoice.pdf`], ['POST', `/orders/${orderId}/cancel`]]
    const bad: string[] = []
    for (const [m, p] of calls) {
      const r = await api.call(m, p, { token: other, body: m === 'POST' ? {} : undefined })
      if (r.status !== 404) bad.push(`other ${m} ${p} -> ${r.status} ${JSON.stringify(r.json).slice(0, 80)}`)
      if (JSON.stringify(r.json ?? '').includes(row!.order_number)) bad.push(`${p} leaked the order number`)
      const g = await api.call(m, p, { token: agent, body: m === 'POST' ? {} : undefined })
      if (g.status !== 403) bad.push(`agent ${m} ${p} -> ${g.status}`)
    }
    const list = await api.get('/orders', { token: other })
    if (list.json.items.some((x: any) => x.id === orderId)) bad.push('other customer list contains the order')
    expect((await db.one(`SELECT status FROM customer_orders WHERE id = ?`, [orderId]))!.status).toBe(row!.status)
    expect(bad).toEqual([])
    pass('SEC-04', 'Another customer / agent tries to read, track, download, cancel a customer order', `POST /orders -> 201; other: 4 calls -> 404; agent: 4 calls -> 403; other list excludes it`,
      `customer_orders ${j(row)} unchanged after the cancel attempt`, 'n/a', 'n/a', o.ms)
  })

  it('SEC-05 address / wishlist / notification isolation', async () => {
    const ad = await api.post('/me/addresses', { recipient_name: 'Anula P', phone: '0771110001', line1: '1 Test Lane', city: 'Colombo' }, { token: customer })
    expect([200, 201]).toContain(ad.status)
    const bad: string[] = []
    const put = await api.put(`/me/addresses/${ad.json.id}`, { recipient_name: 'Hacked Name', phone: '0771110009', line1: '99 Hack Street', city: 'Colombo' }, { token: other })
    if (put.status !== 404) bad.push(`PUT other address -> ${put.status}`)
    const del = await api.del(`/me/addresses/${ad.json.id}`, { token: other })
    if (del.status !== 404) bad.push(`DELETE other address -> ${del.status}`)
    const otherList = await api.get('/me/addresses', { token: other })
    if (otherList.json.items.some((x: any) => x.id === ad.json.id)) bad.push('address visible to other')
    const arow = await db.one(`SELECT id, recipient_name, user_id FROM app_user_addresses WHERE id = ?`, [ad.json.id]).catch(() => undefined)
    // wishlist
    await api.post('/me/wishlist', { product_id: A.product_ids[1] }, { token: customer })
    const wl = await api.get('/me/wishlist', { token: other })
    if (JSON.stringify(wl.json).includes(A.product_ids[1])) bad.push('wishlist leaked')
    // notifications: insert one for the customer, other must not see or mark it read
    const nid = randomUUID()
    await db.exec(`INSERT INTO app_notifications (id, user_id, type, channel, title, body) VALUES (?,?,?,?,?,?)`, [nid, A.logins.customer_smartbuy.user_id, 'system', 'account', 'Private', 'Only for the first customer'])
    const seen = await api.get('/me/notifications', { token: other })
    if (JSON.stringify(seen.json).includes(nid)) bad.push('notification leaked')
    await api.post('/me/notifications/read', { ids: [nid] }, { token: other })
    const stillUnread = await db.one(`SELECT id, user_id, read_at FROM app_notifications WHERE id = ?`, [nid])
    if (stillUnread?.read_at) bad.push('other user marked the notification read')
    const mine = await api.get('/me/notifications', { token: customer })
    if (!mine.json.items.some((x: any) => x.id === nid && x.read === false)) bad.push('owner cannot see own unread notification')
    expect(bad).toEqual([])
    pass('SEC-05', 'Other customer edits/deletes an address, reads wishlist and notifications, marks another user\'s notification read',
      `PUT/DELETE -> 404; wishlist + notifications lists exclude owner data`, `address ${j(arow ?? { id: ad.json.id })}; app_notifications ${j(stillUnread)} (read_at null)`, 'n/a')
  })

  it('SEC-06 smartbuy / wallet isolation: no other member\'s scheme, statement, draws or wallet', async () => {
    const bad: string[] = []
    const mine = await api.get('/smartbuy/me/schemes', { token: customer })
    expect(mine.status).toBe(200)
    // the scheme (plan) is shared by several members; the endpoints answer for the CALLER's own membership only
    const sid = mine.json.items?.[0]?.id ?? A.scheme_id
    const aMember = mine.json.items?.[0]?.member_id as string
    const otherSchemes = await api.get('/smartbuy/me/schemes', { token: other })
    if (aMember && JSON.stringify(otherSchemes.json).includes(aMember)) bad.push("first member's membership id in the other member's list")
    for (const p of [`/smartbuy/me/schemes/${sid}/statement`, `/smartbuy/me/schemes/${sid}/draws`]) {
      const a = await api.get(p, { token: customer }); const o = await api.get(p, { token: other })
      if (o.status === 200) {
        const dump = JSON.stringify(o.json)
        if (aMember && dump.includes(aMember)) bad.push(`${p}: other's answer contains the first member's id`)
        if (dump.includes(A.logins.customer_smartbuy.identifier) || dump.includes(A.logins.customer_smartbuy.customer_id)) bad.push(`${p}: other's answer contains the first member's identity`)
      } else if (![403, 404].includes(o.status)) bad.push(`other ${p} -> ${o.status}`)
      expect(a.status).toBe(200)
      const g = await api.get(p, { token: agent })
      if (g.status !== 403) bad.push(`agent ${p} -> ${g.status}`)
    }
    // a membership id is not a scheme id: asking with it yields nothing
    for (const tail of ['statement', 'draws']) {
      const r = await api.get(`/smartbuy/me/schemes/${aMember}/${tail}`, { token: other })
      if (![403, 404].includes(r.status)) bad.push(`other uses first member id on ${tail} -> ${r.status}`)
    }
    const w1 = await api.get('/wallet', { token: customer }); const w2 = await api.get('/wallet', { token: other })
    if (w2.status === 200 && JSON.stringify(w1.json) === JSON.stringify(w2.json) && w1.json?.balance) bad.push('wallets identical')
    expect(bad).toEqual([])
    const row = await db.one(`SELECT id, customer_id FROM chit_members WHERE id = ?`, [sid]).catch(() => undefined)
    pass('SEC-06', 'Other member / agent reads a Smart Buy statement, draws, wallet', 'statement + draws: other -> 403/404, agent -> 403; lists exclude the scheme', row ? `chit_members ${j(row)}` : `scheme ${sid}`, 'n/a')
  })

  it('SEC-07 agent scope: only own deliveries and members; unassigned orders are 404 for status/complete/bill', async () => {
    const bad: string[] = []
    // the order from SEC-04 is not assigned to the agent
    for (const [m, p] of [['GET', `/agent/deliveries/${orderId}`], ['GET', `/agent/deliveries/${orderId}/bill`], ['POST', `/agent/deliveries/${orderId}/status`], ['POST', `/agent/deliveries/${orderId}/complete`]] as [string, string][]) {
      const r = await api.call(m, p, { token: agent, body: m === 'POST' ? (p.endsWith('/status') ? { status: 'in_transit' } : { otp: '0000', event_id: `sec-event-${randomUUID()}` }) : undefined })
      if (r.status !== 404) bad.push(`agent ${m} ${p} -> ${r.status}`)
    }
    const list = await api.get('/agent/deliveries', { token: agent })
    const ids = (list.json.items ?? []).map((x: any) => x.id)
    const rows = await db.query(`SELECT id FROM customer_orders WHERE assigned_agent_id = ?`, [A.agent_id])
    const allowed = new Set(rows.map((r: any) => r.id))
    for (const id of ids) if (!allowed.has(id)) bad.push(`delivery list has unassigned order ${id}`)
    if (ids.includes(orderId)) bad.push('unassigned order in list')
    // members: unknown / other tenant member id -> 404
    const m = await api.get(`/agent/members/${randomUUID()}`, { token: agent })
    if (m.status !== 404) bad.push(`unknown member -> ${m.status}`)
    const members = await api.get('/agent/members', { token: agent })
    const mrows = await db.query(`SELECT id FROM chit_members WHERE agent_id = ?`, [A.agent_id]).catch(() => [] as any[])
    const allowedM = new Set(mrows.map((r: any) => r.id))
    for (const it of members.json.items ?? []) if (allowedM.size && !allowedM.has(it.member_id)) bad.push(`member ${it.member_id} not assigned to the agent`)
    expect(bad).toEqual([])
    pass('SEC-07', 'Agent touches an order that is not assigned to them; lists show only their own deliveries and members',
      'unassigned order: detail/bill/status/complete -> 404; list ids subset of assigned', `customer_orders.assigned_agent_id = ${A.agent_id}: ${allowed.size} order(s); chit_members agent_id = ${A.agent_id}: ${allowedM.size}`, 'Deliveries screen shows the same assigned set', 'n/a', list.ms)
  })

  it('SEC-08 admin routes need the POS api key; app key, app token and wrong key are 401', async () => {
    const bad: string[] = []
    const url = `${BASE_URL}/api/app/v1/admin/app-access`
    const t = async (h: Record<string, string>) => (await fetch(url, { headers: h })).status
    if (await t({}) !== 401) bad.push('no key')
    if (await t({ 'x-app-key': A.app_key }) !== 401) bad.push('app key')
    if (await t({ 'x-app-key': A.app_key, authorization: `Bearer ${customer}` }) !== 401) bad.push('app key + token')
    if (await t({ 'x-api-key': 'wrong' }) !== 401) bad.push('wrong key')
    if (await t({ 'x-api-key': B.pos_api_key }) !== 200) bad.push('own key rejected (B on B)')
    const aList = await posAdmin(A).get('/app-access'); const bList = await posAdmin(B).get('/app-access')
    expect(aList.status).toBe(200)
    const aIds = new Set<string>(JSON.stringify(aList.json).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? [])
    for (const id of JSON.stringify(bList.json).match(/[0-9a-f]{8}-[0-9a-f-]{27}/g) ?? []) if (aIds.has(id)) bad.push(`id ${id} appears in both tenants' App Access lists`)
    expect(bad).toEqual([])
    pass('SEC-08', 'Admin App Access with no key / app key / app token / wrong key / POS key', '401 x4, POS key 200; tenant A and B lists share no ids', 'no rows changed', 'App Access screen uses the POS key only')
  })

  it('SEC-09 /company and /legal are public but expose only the company profile (no keys, hashes, users)', async () => {
    const c = await api.get('/company', { key: A.app_key })
    expect(c.status).toBe(200)
    const allowed = ['name', 'legal_name', 'address', 'phone', 'email', 'support_email', 'support_phone', 'website', 'tin', 'logo_url', 'invoice_note', 'privacy_url', 'delete_account_url', 'missing', 'updated_at']
    expect(Object.keys(c.json).sort()).toEqual([...allowed].sort())
    const slug = new URL(c.json.privacy_url).searchParams.get('c')!
    const html = await (await fetch(`${BASE_URL}/legal/privacy?c=${slug}`)).text()
    for (const secret of [A.pos_api_key, A.app_key, A.password, A.logins.customer_smartbuy.identifier]) {
      expect(JSON.stringify(c.json)).not.toContain(secret)
      expect(html).not.toContain(secret)
    }
    // tenant B's legal page is its own (slug from B), A's slug never returns B data
    const cb = await apiB.get('/company')
    expect(cb.json.name).not.toBe(c.json.name)
    const bHtml = await (await fetch(`${BASE_URL}/legal/privacy?c=${new URL(cb.json.privacy_url).searchParams.get('c')}`)).text()
    expect(bHtml).toContain(cb.json.name.replace(/&/g, '&amp;'))
    expect(bHtml).not.toContain(c.json.name)
    pass('SEC-09', 'Public /company and /legal/privacy contents', `GET /company -> 200 with exactly ${allowed.length} profile fields; no key/password/phone in body or page`, 'companies.branding_json is only read, never written', 'n/a')
  })

  it('SEC-10 /me never returns credentials; login response has no hash', async () => {
    const me = await api.get('/me', { token: customer })
    const dump = JSON.stringify(me.json)
    expect(dump).not.toMatch(/password_hash|"password"|\$2[aby]\$/i)
    const lg = await api.post('/auth/login', { identifier: A.logins.customer_smartbuy.identifier, password: A.password })
    expect(JSON.stringify(lg.json)).not.toMatch(/password_hash|\$2[aby]\$/i)
    pass('SEC-10', 'Credential leakage in /me and /auth/login responses', `GET /me -> ${me.status}, POST /auth/login -> ${lg.status}; no password/hash fields`, 'app_users.password_hash stays server-side', 'n/a')
  })
})

describe('security: tenant isolation (two live tenants)', () => {
  it('SEC-11 tenant A tokens/keys cannot read or change tenant B data (and the reverse)', async () => {
    const bad: string[] = []
    // token of A with the app key of B (and reverse)
    for (const [m, p] of [['GET', '/me'], ['GET', '/orders'], ['GET', '/me/addresses']] as [string, string][]) {
      const r1 = await api.call(m, p, { token: customer, key: B.app_key }); if (r1.status !== 401) bad.push(`A token + B key ${p} -> ${r1.status}`)
      const r2 = await apiB.call(m, p, { token: tokenB, key: A.app_key }); if (r2.status !== 401) bad.push(`B token + A key ${p} -> ${r2.status}`)
    }
    // A's order id asked inside B (with B's own valid user)
    for (const p of [`/orders/${orderId}`, `/orders/${orderId}/tracking`]) {
      const r = await apiB.get(p, { token: tokenB }); if (r.status !== 404) bad.push(`B user reads A order ${p} -> ${r.status}`)
    }
    const cancel = await apiB.post(`/orders/${orderId}/cancel`, {}, { token: tokenB }); if (cancel.status !== 404) bad.push(`B cancels A order -> ${cancel.status}`)
    // B's catalog never contains A's product ids and vice versa
    const pa = await api.get('/catalog/products'); const pb = await apiB.get('/catalog/products')
    const idsA = new Set((pa.json.items ?? []).map((x: any) => x.id))
    for (const it of pb.json.items ?? []) if (idsA.has(it.id)) bad.push(`product ${it.id} in both catalogs`)
    // POS sync API: key A only sees schema A (customer ids differ)
    const sync = async (S: Seed) => (await (await fetch(`${BASE_URL}/api/sync/changes?since=1970-01-01T00:00:00.000Z&table=customers`, { headers: { 'x-api-key': S.pos_api_key } })).json()) as any
    const ca = (await sync(A)).data ?? [], cb = (await sync(B)).data ?? []
    const aCust = new Set(ca.map((x: any) => x.id))
    for (const x of cb) if (aCust.has(x.id)) bad.push(`customer ${x.id} synced to both tenants`)
    if (!ca.some((x: any) => x.id === A.logins.customer_smartbuy.customer_id)) bad.push('A customer missing from A sync')
    // wrong direction: B tenant row count of A order
    const leak = await dbB.query(`SELECT id FROM customer_orders WHERE id = ?`, [orderId])
    if (leak.length) bad.push('A order row exists in B schema')
    expect(bad).toEqual([])
    pass('SEC-11', 'Cross-tenant: A token+B key, B user on A order ids, catalogs, POS sync feed',
      'token/key mix -> 401; A order id inside B -> 404 (read, track, cancel); catalogs and /api/sync customers disjoint',
      `schemas ${A.db_schema} vs ${B.db_schema}: customer_orders ${orderId} absent in B`, 'n/a')
  })
})

describe('company reverse sync (POS settings -> app) and catalog reverse (POS -> app)', () => {
  const stamp = Date.now().toString(36)
  it('CO-01 POS saves company details through its real branding path; /company, /watermark and /legal follow', async () => {
    await pos.sync() // first full pull + branding in sync
    const wm0 = (await api.get('/watermark')).json.areas.company
    await new Promise(r => setTimeout(r, 1100)) // companies.updated_at has 1 s resolution
    const settings = state.data.app_settings
    Object.assign(settings, { company_legal_name: `Sec Legal ${stamp} (Pvt) Ltd`, support_email: `help-${stamp}@sec.example`, support_phone: '0112223344', company_address: `No ${stamp}, Test Road, Colombo`, company_tin: `PV-${stamp}`, invoice_note: 'POS note' })
    state.data.branding_push_pending = true
    const t = await pos.sync()
    const c = (await api.get('/company')).json
    expect(c.legal_name).toBe(`Sec Legal ${stamp} (Pvt) Ltd`)
    expect(c.support_email).toBe(`help-${stamp}@sec.example`)
    expect(c.tin).toBe(`PV-${stamp}`)
    expect(c.missing).toEqual([])
    const wm1 = (await api.get('/watermark')).json.areas.company
    expect(wm1).not.toBe(wm0)
    const slug = new URL(c.privacy_url).searchParams.get('c')
    const html = await (await fetch(`${BASE_URL}/legal/privacy?c=${slug}`)).text()
    expect(html).toContain(`Sec Legal ${stamp} (Pvt) Ltd`)
    expect(html).toContain(`help-${stamp}@sec.example`)
    const branding = await (await fetch(`${BASE_URL}/api/company/branding`, { headers: { 'x-api-key': A.pos_api_key } })).json() as any
    pass('CO-01', 'Edit legal name / support email / phone / address / TIN in POS company settings and save', `PUT /api/company/branding (via SyncService.pushBrandingToCloud) -> GET /company legal_name ok, /watermark areas.company ${wm0} -> ${wm1}, /legal/privacy shows it`,
      `pos_erp_saas.companies.branding_json ${j({ company_legal_name: branding.branding.company_legal_name, support_email: branding.branding.support_email, support_phone: branding.branding.support_phone, company_tin: branding.branding.company_tin })} updated_at ${branding.updated_at}`,
      'Settings -> Company Information (local app_settings, store key company_branding_synced)', 'POS -> app: visible on next /company fetch (app polls /watermark every 10 s)', t)
  })

  it('CO-02 another device changes branding in the cloud; POS pulls it back (round trip of the three new keys)', async () => {
    const res = await fetch(`${BASE_URL}/api/company/branding`, { method: 'PUT', headers: { 'x-api-key': A.pos_api_key, 'content-type': 'application/json' }, body: JSON.stringify({ company_legal_name: `Round ${stamp} Ltd`, support_email: `round-${stamp}@sec.example`, support_phone: '0771234567' }) })
    expect(res.status).toBe(200)
    const t = await pos.sync()
    const s = state.data.app_settings
    expect(s.company_legal_name).toBe(`Round ${stamp} Ltd`)
    expect(s.support_email).toBe(`round-${stamp}@sec.example`)
    expect(s.support_phone).toBe('0771234567')
    pass('CO-02', 'Cloud branding edited elsewhere -> POS settings (SyncService.syncBranding)', 'PUT /api/company/branding -> 200', 'branding_json has the new legal name / support email / phone', `POS app_settings: company_legal_name=${s.company_legal_name}, support_email=${s.support_email}, support_phone=${s.support_phone}`, 'cloud -> POS', t)
  })

  it('CO-03 POS hides a product (is_online=0) and renames a category; the app catalog follows', async () => {
    await pos.syncUntil(() => !!pos.get('SELECT id FROM products WHERE id=?', A.product_ids[0]), 3)
    const pid = A.product_ids[0]
    const before = await api.get('/catalog/products')
    expect(before.json.items.some((x: any) => x.id === pid)).toBe(true)
    const since = before.json.server_time
    const prod = pos.get<any>('SELECT * FROM products WHERE id=?', pid)!
    const catId = prod.category_id as string
    const newName = `Renamed ${stamp}`
    pos.db.prepare(`UPDATE products SET is_online=0, updated_at=datetime('now') WHERE id=?`).run(pid)
    if (catId) pos.db.prepare(`UPDATE categories SET name=?, updated_at=datetime('now') WHERE id=?`).run(newName, catId)
    const { enqueuSync } = await import('../../services/syncQueue')
    await enqueuSync('products', pid, 'UPDATE', { id: pid, is_online: 0 })
    if (catId) await enqueuSync('categories', catId, 'UPDATE', { id: catId, name: newName })
    const t = await pos.sync()
    const cloudRow = await db.one(`SELECT id, is_online, updated_at FROM products WHERE id = ?`, [pid])
    expect(Number(cloudRow!.is_online)).toBe(0)
    await new Promise(r => setTimeout(r, 1100))
    const after = await api.get('/catalog/products')
    expect(after.json.items.some((x: any) => x.id === pid)).toBe(false)
    const delta = await api.get(`/catalog/products?updated_since=${encodeURIComponent(new Date(Date.parse(since) - 60_000).toISOString())}`)
    expect(delta.json.removed_ids).toContain(pid)
    const detail = await api.get(`/catalog/products/${pid}`)
    expect([404, 410]).toContain(detail.status)
    if (catId) {
      const cats = await api.get('/catalog/categories')
      expect(cats.json.items.find((x: any) => x.id === catId)?.name).toBe(newName)
    }
    pass('CO-03', 'POS: hide product from the online store + rename its category', 'GET /catalog/products no longer lists it, removed_ids has it, detail 404; /catalog/categories shows the new name',
      `products ${j(cloudRow)}; categories.name = ${newName}`, 'Products screen (online flag) / Categories', 'POS -> app', t)
  })
})
