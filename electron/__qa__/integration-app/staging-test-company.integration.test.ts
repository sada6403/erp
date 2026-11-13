// STAGING ONLY: the read-only copy of the production "test" company on the staging VPS.
// Real POS (SQLite + SyncService + the POS IPC handlers) <-> staging API <-> staging MySQL (SSH tunnel) <-> the phone's order.
// Never targets production: refuses any base URL that is not staging/localhost and any schema that is not a staging copy.
// Run: STAGING_SEED=<.seed-output-testcopy.json> TEST_BASE_URL=https://staging-api.72-61-115-222.sslip.io INT_MYSQL_HOST=127.0.0.1
//      INT_MYSQL_PORT=3307 INT_MYSQL_USER=pos_stg INT_MYSQL_PASSWORD=... (SSH tunnel to the staging DB) npm run test:staging-copy
import fs from 'node:fs'
import zlib from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appApi, BASE_URL, cloudDb, createPos, Evidence, j, type CloudDb, type Pos, type Seed } from './harness'

const hoisted = vi.hoisted(() => ({
  state: { data: {} as Record<string, any>, directory: '' },
  registry: new Map<string, (...args: unknown[]) => unknown>(),
}))
const state = hoisted.state
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.data[key] ?? fallback }
  set(key: string, value: unknown) { state.data[key] = value }
  delete(key: string) { delete state.data[key] }
} }))
vi.mock('electron', () => ({
  app: { getPath: () => state.directory, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} },
  BrowserWindow: { getAllWindows: () => [] },
  dialog: {}, shell: { openExternal: async () => {} }, protocol: { registerFileProtocol: () => {}, handle: () => {} },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))
const fakeIpcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} } as unknown as import('electron').IpcMain
const ipc = async (channel: string, ...args: unknown[]): Promise<any> => {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))
/** Solid-colour PNG (no image library needed). */
function png(w: number, h: number, [r, g, b]: [number, number, number]): Buffer {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0 })
  const crc = (buf: Buffer) => { let c = 0xffffffff; for (const x of buf) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, data: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())])
  const raw = Buffer.concat(Array.from({ length: h }, () => row))
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos
let customer: string, agent: string, agentId: string
const ev = new Evidence('staging')
const t: { orderId?: string; orderNo?: string; invoiceId?: string; otp?: string; custId?: string; newId?: string } = {}
const catalog = async () => (await api.get('/catalog/products?limit=500', { token: customer })).json.items as any[]
/** Poll the app API until `pick` is true. Returns ms since `t0`. */
async function appSees(t0: number, pick: (items: any[]) => boolean, maxMs = 60_000): Promise<number> {
  for (;;) {
    if (pick(await catalog())) return Date.now() - t0
    if (Date.now() - t0 > maxMs) throw new Error('app never saw the change')
    await sleep(1000)
  }
}

// Only runs when STAGING_SEED is set (see the header); the standard `npm run test:integration-app` skips it.
const RUN = !!process.env.STAGING_SEED

beforeAll(async () => {
  if (!RUN) return
  if (!/staging-api\.|localhost|127\.0\.0\.1/.test(BASE_URL)) throw new Error(`Refusing: ${BASE_URL} is not staging/localhost`)
  const file = process.env.STAGING_SEED
  if (!file) throw new Error('Set STAGING_SEED to the staging copy seed JSON')
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!String(raw.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error(`Refusing schema ${raw.db_schema}`)
  seed = { ...raw, base_url: BASE_URL, branches: { main: raw.branch_id, kandy: raw.branch_id }, file } as Seed
  api = appApi(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
  const [{ registerOrderHandlers }, { registerInvoiceHandlers }, { registerProductHandlers }, { registerStockHandlers }] = await Promise.all([
    import('../../ipc/orders'), import('../../ipc/invoices'), import('../../ipc/products'), import('../../ipc/stocks')])
  registerOrderHandlers(fakeIpcMain); registerInvoiceHandlers(fakeIpcMain); registerProductHandlers(fakeIpcMain); registerStockHandlers(fakeIpcMain)
  await pos.sync()
  if (process.env.STG_DEBUG) {
    const c = (tbl: string) => { try { return (pos.get<{ n: number }>(`SELECT COUNT(*) n FROM ${tbl}`) as any).n } catch (e) { return `ERR ${(e as Error).message}` } }
    console.log('DEBUG counts', Object.fromEntries(['branches', 'categories', 'products', 'stocks', 'customers', 'customer_orders', 'customer_order_items', 'users', 'agents'].map(x => [x, c(x)])))
    console.log('DEBUG state', JSON.stringify(Object.fromEntries(Object.entries(state.data).filter(([k]) => /sync|cursor|error|last/i.test(k))), null, 1).slice(0, 1500))
    try { console.log('DEBUG quarantine', JSON.stringify(pos.all('SELECT table_name, error_message, last_error, status FROM sync_pull_quarantine LIMIT 3'))) } catch (e) { try { console.log('DEBUG quarantine cols', JSON.stringify(pos.all('SELECT * FROM sync_pull_quarantine LIMIT 2').map((r: any) => ({ ...r, row_json: undefined, payload: undefined, data: undefined })))) } catch (e2) { console.log('DEBUG quarantine ERR', (e2 as Error).message) } }
  }
  const admin =pos.get<{ id: string; name: string }>('SELECT id, name FROM users ORDER BY created_at LIMIT 1')
  state.data.auth_user = { id: admin?.id ?? 'stg-admin', name: admin?.name ?? 'Staging Admin', branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
  customer = await api.login(raw.logins.customer, raw.password)
  agent = await api.login('0779990011', raw.password)
  agentId = (await db.one(`SELECT id FROM agents WHERE code = 'AG001'`))!.id
}, 300_000)

afterAll(async () => { if (RUN) ev.save(); await db?.close() })

describe.skipIf(!RUN)('staging copy of the real "test" company', () => {
  it('ST-01 POS pulls the real catalog: same product count and prices as the cloud and the app', async () => {
    const cloud = await db.query(`SELECT id, selling_price FROM products`)
    const local = pos.all<{ id: string; selling_price: number }>('SELECT id, selling_price FROM products')
    const lm = new Map(local.map(p => [p.id, p]))
    const bad = cloud.filter(c => !lm.has(c.id) || Number(lm.get(c.id)!.selling_price) !== Number(c.selling_price))
    const items = await catalog()
    const priceBad = items.filter(a => Number(a.price) !== Number(lm.get(a.id)?.selling_price))
    ev.add({ id: 'ST-01', action: 'POS bootstrap pull of the "test" copy', api: `GET /catalog/products -> ${items.length} items, ${priceBad.length} price mismatches vs POS`,
      cloud: `products ${cloud.length}`, pos: `SQLite products ${local.length}; ${bad.length} missing/price-different`, reverse: 'n/a', ms: 0, result: bad.length === 0 && priceBad.length === 0 ? 'PASS' : 'FAIL' })
    expect(bad.length).toBe(0)
    expect(priceBad.length).toBe(0)
  })

  it('ST-02 the order placed on the real phone reached the POS Orders screen (app-order list)', async () => {
    const row = await db.one(`SELECT id, order_number, status, total_amount, payment_method, customer_id, created_at FROM customer_orders ORDER BY created_at DESC LIMIT 1`)
    expect(row).toBeTruthy()
    Object.assign(t, { orderId: row.id, orderNo: row.order_number, custId: row.customer_id })
    const screen = (await ipc('orders:list', { channel: 'app' })).data.find((x: any) => x.id === row.id)
    ev.add({ id: 'ST-02', action: 'Order placed on the real phone shows in POS', api: 'n/a (placed in the app)', cloud: `customer_orders ${j(row)}`,
      pos: `Orders screen (orders:list channel=app) -> ${screen?.order_number} status=${screen?.status} total=${screen?.total_amount}`, reverse: 'n/a', ms: 0, result: screen ? 'PASS' : 'FAIL' })
    expect(screen).toBeTruthy()
  })

  it('ST-03 POS confirms, assigns the agent, converts to an invoice; totals = counter prices; stock drops in the app', async () => {
    const items = pos.all<{ product_id: string; quantity: number }>('SELECT product_id, quantity FROM customer_order_items WHERE order_id = ?', t.orderId)
    const pick = async () => Object.fromEntries((await catalog()).filter(p => items.some(i => i.product_id === p.id)).map(p => [p.id, p.available_qty]))
    const before = await pick()
    expect((await ipc('orders:updateStatus', t.orderId, 'confirmed')).success).toBe(true)
    expect((await ipc('orders:assignAgent', t.orderId, agentId)).success).toBe(true)
    const conv = await ipc('orders:convertToInvoice', t.orderId)
    expect(conv.success, JSON.stringify(conv)).toBe(true)
    t.invoiceId = conv.data.id
    const t0 = Date.now()
    await pos.sync()
    const inv = await db.one(`SELECT invoice_number, total_amount, tax_amount, due_amount, status, source_order_id FROM invoices WHERE id = ?`, [t.invoiceId])
    const order = await db.one(`SELECT status, assigned_agent_id, invoice_id, total_amount FROM customer_orders WHERE id = ?`, [t.orderId])
    const counter = items.reduce((s, i) => s + Number(i.quantity) * Number(pos.get<{ selling_price: number }>('SELECT selling_price FROM products WHERE id=?', i.product_id)!.selling_price), 0)
    const after = await pick()
    // The order already reserved these goods, so converting it (POS stock drops) must NOT lower the app's available stock again,
    // and the app must show exactly what is on the shelf in the POS (reservation released at conversion).
    const shelf = (id: string) => Number(pos.get<{ quantity: number }>('SELECT quantity FROM stocks WHERE product_id = ? AND branch_id = ?', id, seed.branches.main)?.quantity ?? 0)
    const unchanged = items.every(i => Number(before[i.product_id]) === Number(after[i.product_id]))
    const shelfEqualsAvailable = items.every(i => Number(after[i.product_id]) === shelf(i.product_id))
    const dropped = unchanged && shelfEqualsAvailable
    const ms = Date.now() - t0
    ev.add({ id: 'ST-03', action: 'POS confirm + assign agent + convert to invoice', api: `catalog stock ${j(before)} -> ${j(after)}`, cloud: `customer_orders ${j(order)}; invoices ${j(inv)}`,
      pos: `invoice total ${inv?.total_amount} vs counter price sum ${counter}`, reverse: 'POS -> cloud -> app catalog stock', ms,
      result: order?.status === 'ready_for_delivery' && order.assigned_agent_id === agentId && Number(inv?.total_amount) === counter && Number(inv?.total_amount) === Number(order.total_amount) && dropped ? 'PASS' : 'FAIL' })
    expect(order.status).toBe('ready_for_delivery')
    expect(Number(inv.total_amount)).toBe(counter)
    expect(unchanged, `available stock must not drop again at conversion: ${j(before)} -> ${j(after)}`).toBe(true)
    expect(shelfEqualsAvailable, `shelf stock must equal available stock after conversion: ${j(after)}`).toBe(true)
  })

  it('ST-04 delivery: out for delivery, wrong OTP rejected, right OTP completes + COD settles; app and POS agree', async () => {
    const mine = await api.get(`/orders/${t.orderId}`, { token: customer })
    t.otp = mine.json.delivery_otp
    expect(t.otp).toMatch(/^\d{4}$/)
    const st = await api.post(`/agent/deliveries/${t.orderId}/status`, { status: 'in_transit' }, { token: agent })
    expect(st.status, JSON.stringify(st.json)).toBe(200)
    const wrong = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: t.otp === '0000' ? '1111' : '0000', event_id: `w-${Date.now()}` }, { token: agent })
    const ok = await api.post(`/agent/deliveries/${t.orderId}/complete`, { otp: t.otp, event_id: `ok-${Date.now()}` }, { token: agent })
    expect(ok.status, JSON.stringify(ok.json)).toBe(200)
    const o = await db.one(`SELECT status, payment_status, total_amount, paid_amount, delivered_at FROM customer_orders WHERE id = ?`, [t.orderId])
    const inv = await db.one(`SELECT total_amount, paid_amount, due_amount, status FROM invoices WHERE id = ?`, [t.invoiceId])
    const ms = await pos.syncUntil(() => pos.get('SELECT status FROM customer_orders WHERE id=?', t.orderId)?.status === 'delivered')
    const lo = pos.get('SELECT status, payment_status, paid_amount FROM customer_orders WHERE id=?', t.orderId)
    const li = pos.get('SELECT paid_amount, due_amount, status FROM invoices WHERE id=?', t.invoiceId)
    const track = await api.get(`/orders/${t.orderId}/tracking`, { token: customer })
    ev.add({ id: 'ST-04', action: 'Delivery + OTP + COD collection (staging copy)', api: `wrong OTP -> ${wrong.status}; right -> ${ok.status}; tracking -> ${track.json.status}`, cloud: `customer_orders ${j(o)}; invoices ${j(inv)}`,
      pos: `SQLite order ${j(lo)}; invoice ${j(li)}`, reverse: 'cloud -> POS pull', ms,
      result: wrong.status === 400 && o.status === 'delivered' && o.payment_status === 'paid' && lo?.status === 'delivered' && Number(li?.due_amount) === 0 && track.json.status === 'delivered' ? 'PASS' : 'FAIL' })
    expect(wrong.status).toBe(400)
    expect(lo?.status).toBe('delivered')
    expect(Number(li?.due_amount)).toBe(0)
  })
})

describe.skipIf(!RUN)('live edits in the POS reach the app (delay = one POS sync cycle + API refresh)', () => {
  const pid = () => pos.get<{ id: string }>(`SELECT id FROM products WHERE is_active = 1 AND name LIKE 'SAMBA%' LIMIT 1`)!.id
  const edit = async (id: string, changes: Record<string, unknown>) => {
    const cur = (await ipc('products:get', id)).data
    const r = await ipc('products:update', id, { ...cur, ...changes })
    expect(r.success, JSON.stringify(r)).toBe(true)
  }
  const stamp = Date.now() % 100000

  it('LV-01 price edit', async () => {
    const id = pid(); const price = 301 + (stamp % 50)
    const t0 = Date.now(); await edit(id, { selling_price: price }); await pos.sync()
    const ms = await appSees(t0, items => items.find(p => p.id === id)?.price === price)
    ev.add({ id: 'LV-01', action: 'POS edits a selling price', api: `app catalog price -> ${price}`, cloud: 'products.selling_price', pos: `products:update selling_price=${price}`, reverse: 'POS -> cloud -> app', ms, result: 'PASS' })
  })
  it('LV-02 name edit', async () => {
    const id = pid(); const name = `SAMBA LIVE ${stamp}`
    const t0 = Date.now(); await edit(id, { name }); await pos.sync()
    const ms = await appSees(t0, items => items.find(p => p.id === id)?.name === name)
    ev.add({ id: 'LV-02', action: 'POS renames a product', api: `app catalog name -> ${name}`, cloud: 'products.name', pos: 'products:update name', reverse: 'POS -> cloud -> app', ms, result: 'PASS' })
  })
  it('LV-03 stock change', async () => {
    const id = pid(); const branch = seed.branches.main
    const cur = pos.get<{ quantity: number }>('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?', id, branch)
    const qty = Number(cur?.quantity ?? 0) + 7
    const t0 = Date.now()
    const r = await ipc('stocks:adjustCorrection', { product_id: id, branch_id: branch, quantity: qty, reason: 'staging live test' })
    expect(r.success, JSON.stringify(r)).toBe(true)
    await pos.sync()
    const ms = await appSees(t0, items => Number(items.find(p => p.id === id)?.available_qty) >= qty - 1)
    ev.add({ id: 'LV-03', action: 'POS corrects stock', api: `app available_qty -> ${qty}`, cloud: 'stocks.quantity', pos: `stocks:adjustCorrection ${qty}`, reverse: 'POS -> cloud -> app', ms, result: 'PASS' })
  })
  it('LV-04 add a product', async () => {
    const name = `NEW ITEM ${stamp}`
    const t0 = Date.now()
    const r = await ipc('products:create', { name, sku: `NEW-${stamp}`, selling_price: 123, cost_price: 100, unit: 'pcs' })
    expect(r.success, JSON.stringify(r)).toBe(true)
    const id = r.data?.id ?? pos.get<{ id: string }>('SELECT id FROM products WHERE sku = ?', `NEW-${stamp}`)!.id
    await ipc('stocks:adjustCorrection', { product_id: id, branch_id: seed.branches.main, quantity: 5, reason: 'staging live test' })
    await pos.sync()
    const ms = await appSees(t0, items => items.some(p => p.id === id && p.price === 123))
    t.newId = id
    ev.add({ id: 'LV-04', action: 'POS adds a product', api: 'appears in app catalog at Rs 123', cloud: 'products row', pos: 'products:create', reverse: 'POS -> cloud -> app', ms, result: 'PASS' })
  })
  it('LV-05 deactivate a product', async () => {
    const id = t.newId as string
    const t0 = Date.now()
    const r = await ipc('products:delete', id)
    expect(r.success, JSON.stringify(r)).toBe(true)
    await pos.sync()
    const ms = await appSees(t0, items => !items.some(p => p.id === id))
    ev.add({ id: 'LV-05', action: 'POS deactivates a product', api: 'disappears from app catalog', cloud: 'products.is_active=0', pos: 'products:delete', reverse: 'POS -> cloud -> app', ms, result: 'PASS' })
  })
  it('LV-06 image: a real uploaded image is served as an image', async () => {
    const id = pid()
    const up = await fetch(`${BASE_URL}/api/upload?filename=stg-live-${stamp}.png`, { method: 'POST', headers: { 'x-api-key': seed.pos_api_key, 'content-type': 'image/png' }, body: new Uint8Array(png(300, 300, [200, 80, 40])) })
    expect(up.status).toBe(200)
    const url = (await up.json()).url as string
    const t0 = Date.now(); await edit(id, { image_url: url }); await pos.sync()
    const ms = await appSees(t0, items => !!items.find(p => p.id === id)?.thumbnail_url)
    const thumb = (await catalog()).find(p => p.id === id).thumbnail_url as string
    const img = await fetch(thumb)
    ev.add({ id: 'LV-06', action: 'POS sets a product image', api: `thumbnail_url ${thumb} -> HTTP ${img.status} ${img.headers.get('content-type')}`, cloud: 'products.image_url', pos: 'products:update image_url', reverse: 'POS -> cloud -> app', ms,
      result: img.status === 200 && /image\//.test(String(img.headers.get('content-type'))) ? 'PASS' : 'FAIL' })
    expect(img.status).toBe(200)
  })
})
