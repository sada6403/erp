// STAGING ONLY: builds realistic catalog test data in the staging copy of the "test" (supermarket) company, using the
// REAL POS code paths (products:selectAndUploadImage -> /api/upload, products:create/update, stocks, discounts, then the
// normal sync push), so thumbnails, watermarks and the app catalog are produced exactly like in production.
// Then it places a mixed app order and converts it in the POS harness (invoice totals + FIFO stock deduction).
//
// Never touches production: refuses any base URL that is not staging/localhost and any schema that is not a *test copy*.
// Run:  STAGING_CATALOG_SEED=<phase> STAGING_SEED=<seed json> TEST_BASE_URL=https://staging-api.72-61-115-222.sslip.io \
//       ELECTRON_RUN_AS_NODE=1 electron vitest run --project=integration electron/__qa__/integration-app/staging-catalog-seed.integration.test.ts
//   phase = "data"  (photos + weight + variants + discounts + tax + stock states)   |   "order" (mixed order -> invoice -> FIFO check)
import fs from 'node:fs'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { appApi, BASE_URL, createPos, EVIDENCE_DIR, type Pos, type Seed } from './harness'

const hoisted = vi.hoisted(() => ({
  state: { data: {} as Record<string, any>, directory: '' },
  registry: new Map<string, (...args: unknown[]) => unknown>(),
  nextFile: '',
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
  // the product-form "choose image" dialog: answers with the file the test wants to upload
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [hoisted.nextFile] }) },
  shell: { openExternal: async () => {} }, protocol: { registerFileProtocol: () => {}, handle: () => {} },
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

const PHASE = process.env.STAGING_CATALOG_SEED || ''
const IMAGES = path.resolve(__dirname, '..', '..', '..', 'docs', 'mobile-app', 'test-images')
const REPORT = path.join(EVIDENCE_DIR, 'catalog-seed.json')
const DAY = 24 * 3600 * 1000

let seed: Seed, pos: Pos, api: ReturnType<typeof appApi>, customer: string
const log: Record<string, any> = fs.existsSync(REPORT) ? JSON.parse(fs.readFileSync(REPORT, 'utf8')) : {}
const sqlTime = (d: Date) => d.toISOString().slice(0, 19).replace('T', ' ')
const pid = (sku: string): string => {
  const row = pos.get<{ id: string }>('SELECT id FROM products WHERE sku = ?', sku)
  if (!row) throw new Error(`Product ${sku} not found in the POS copy`)
  return row.id
}
/** Edit a product the way the POS product form does (full row + the changed fields). */
async function edit(id: string, changes: Record<string, unknown>) {
  const cur = (await ipc('products:get', id)).data
  const { variants: _v, ...row } = cur
  const r = await ipc('products:update', id, { ...row, ...changes })
  expect(r.success, JSON.stringify(r)).toBe(true)
}
const setStock = async (id: string, qty: number, reason: string) => {
  const r = await ipc('stocks:adjustCorrection', { product_id: id, branch_id: seed.branches.main, quantity: qty, reason })
  expect(r.success, JSON.stringify(r)).toBe(true)
}

beforeAll(async () => {
  if (!PHASE) return
  if (!/staging-api\.|localhost|127\.0\.0\.1/.test(BASE_URL)) throw new Error(`Refusing: ${BASE_URL} is not staging/localhost`)
  const raw = JSON.parse(fs.readFileSync(String(process.env.STAGING_SEED), 'utf8'))
  if (!String(raw.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error(`Refusing schema ${raw.db_schema}`)
  seed = { ...raw, base_url: BASE_URL, branches: { main: raw.branch_id, kandy: raw.branch_id }, file: String(process.env.STAGING_SEED) } as Seed
  api = appApi(seed)
  pos = await createPos(state, seed)
  state.data.app_settings = { ...state.data.app_settings, business_type: 'supermarket', counter_prefix: PHASE === 'phone' ? 'QA3' : PHASE === 'reserve' ? `R${Date.now() % 100000}` : 'QA2' }
  const [{ registerOrderHandlers }, { registerInvoiceHandlers }, { registerProductHandlers }, { registerStockHandlers }, { registerDiscountHandlers }] = await Promise.all([
    import('../../ipc/orders'), import('../../ipc/invoices'), import('../../ipc/products'), import('../../ipc/stocks'), import('../../ipc/discounts')])
  registerOrderHandlers(fakeIpcMain); registerInvoiceHandlers(fakeIpcMain); registerProductHandlers(fakeIpcMain); registerStockHandlers(fakeIpcMain)
  registerDiscountHandlers() // registers on the electron ipcMain mock above
  await pos.sync()
  const admin = pos.get<{ id: string; name: string }>('SELECT id, name FROM users ORDER BY created_at LIMIT 1')
  state.data.auth_user = { id: admin?.id ?? 'stg-admin', name: admin?.name ?? 'Staging Admin', branch_id: seed.branches.main, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
  customer = await api.login(raw.logins.customer, raw.password)
}, 300_000)

afterAll(() => {
  if (!PHASE) return
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  fs.writeFileSync(REPORT, JSON.stringify(log, null, 2))
})

describe.skipIf(PHASE !== 'data')('catalog test data (staging copy of "test")', () => {
  it('SEED-01 photos: uploaded through the POS image path and attached to products', async () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(IMAGES, 'manifest.json'), 'utf8')) as Record<string, { sku: string; product: string }>
    const done: Record<string, { product_id: string; sku: string; image_url: string }> = {}
    for (const [slug, m] of Object.entries(manifest)) {
      const file = path.join(IMAGES, `${slug}.jpg`)
      if (!fs.existsSync(file)) continue
      hoisted.nextFile = file
      const up = await ipc('products:selectAndUploadImage')
      expect(up.success, JSON.stringify(up)).toBe(true)
      expect(up.local_only, `${slug} stayed on the device (cloud upload failed)`).toBeFalsy()
      const id = pid(m.sku)
      await edit(id, { image_url: up.data })
      done[slug] = { product_id: id, sku: m.sku, image_url: up.data }
    }
    log.photos = done
    expect(Object.keys(done).length).toBeGreaterThanOrEqual(10)
  }, 600_000)

  it('SEED-02 no photo on 3 products; one broken image URL', async () => {
    const none = ['PRD-016', 'PRD-018', 'PRD-015'] // KADALAI, AVAL, SALT POWDER
    for (const sku of none) await edit(pid(sku), { image_url: null })
    const broken = pid('PRD-080') // WELVET
    await edit(broken, { image_url: `${BASE_URL}/api/files/does-not-exist-broken-image.jpg` })
    log.no_photo = none.map(s => ({ sku: s, product_id: pid(s) }))
    log.broken_image = { sku: 'PRD-080', product_id: broken, image_url: `${BASE_URL}/api/files/does-not-exist-broken-image.jpg` }
  })

  it('SEED-03 two weight items (kg, sold by weight, decimal stock) with two FIFO batches on the rice', async () => {
    const cat = pos.get<{ category_id: string | null }>('SELECT category_id FROM products WHERE sku = ?', 'PRD-007')?.category_id ?? null
    const make = async (name: string, sku: string, price: number, cost: number, stock: number) => {
      const r = await ipc('products:create', { name, sku, selling_price: price, cost_price: cost, unit: 'kg', category_id: cat, min_stock_level: 5 })
      expect(r.success, JSON.stringify(r)).toBe(true)
      const id = r.data.id as string
      await edit(id, { sale_by: 'weight', unit: 'kg' })
      await setStock(id, stock, 'catalog test data')
      return id
    }
    const rice = await make('Rice Keeri Samba (Loose)', 'LOOSE-RICE-KS', 285, 240, 25.5)
    const sugar = await make('Sugar (Loose)', 'LOOSE-SUGAR', 245, 210, 40.25)
    // two receipt batches (older first) that add up to the stock row, so the FIFO order is observable
    const db = pos.db
    const batch = (id: string, no: string, quantity: number, cost: number, date: string) => {
      const row = { id: crypto.randomUUID(), product_id: id, branch_id: seed.branches.main, batch_number: no, quantity, cost_price: cost, selling_price: 285,
        purchase_date: date, original_quantity: quantity, sold_quantity: 0, returned_quantity: 0, damaged_quantity: 0, historical_cost_known: 1, status: 'available' }
      db.prepare(`INSERT INTO product_batches (id,product_id,branch_id,batch_number,quantity,cost_price,selling_price,purchase_date,original_quantity,sold_quantity,returned_quantity,damaged_quantity,historical_cost_known,status)
        VALUES (@id,@product_id,@branch_id,@batch_number,@quantity,@cost_price,@selling_price,@purchase_date,@original_quantity,@sold_quantity,@returned_quantity,@damaged_quantity,@historical_cost_known,@status)`).run(row)
      return row
    }
    const b1 = batch(rice, 'KS-OCT', 10, 240, '2026-10-01')
    const b2 = batch(rice, 'KS-NOV', 15.5, 250, '2026-11-05')
    const { enqueuSync } = await import('../../services/syncQueue')
    for (const b of [b1, b2]) await enqueuSync('product_batches', b.id, 'INSERT', b)
    log.weight_items = { rice: { id: rice, name: 'Rice Keeri Samba (Loose)', price_per_kg: 285, stock_kg: 25.5, batches: [{ id: b1.id, no: 'KS-OCT', kg: 10 }, { id: b2.id, no: 'KS-NOV', kg: 15.5 }] }, sugar: { id: sugar, name: 'Sugar (Loose)', price_per_kg: 245, stock_kg: 40.25 } }
  }, 120_000)

  it('SEED-04 variant product: Sunlight Soap 70g / 100g / 150g with own price + stock', async () => {
    const cat = pos.get<{ category_id: string | null }>('SELECT category_id FROM products WHERE sku = ?', 'PRD-078')?.category_id ?? null
    const r = await ipc('products:create', {
      name: 'Sunlight Soap', sku: 'SOAP-SUN', selling_price: 60, cost_price: 45, unit: 'pcs', category_id: cat,
      variants: [
        { variant_name: '70g', sku: 'SOAP-SUN-70', selling_price: 60, cost_price: 45, stock: 40, attributes: { size: '70g' } },
        { variant_name: '100g', sku: 'SOAP-SUN-100', selling_price: 85, cost_price: 64, stock: 25, attributes: { size: '100g' } },
        { variant_name: '150g', sku: 'SOAP-SUN-150', selling_price: 120, cost_price: 90, stock: 3, attributes: { size: '150g' } },
      ],
    })
    expect(r.success, JSON.stringify(r)).toBe(true)
    const id = r.data.id as string
    const vs = pos.all<{ id: string; variant_name: string; selling_price: number }>('SELECT id, variant_name, selling_price FROM product_variants WHERE product_id = ? ORDER BY sort_order', id)
    log.variant_product = { id, name: 'Sunlight Soap', variants: vs.map(v => ({ id: v.id, name: v.variant_name, price: v.selling_price })), stock: { '70g': 40, '100g': 25, '150g': 3 } }
    expect(vs.length).toBe(3)
  })

  it('SEED-05 10% discount on 2 products until +7 days; 10% tax on 1 product', async () => {
    const until = sqlTime(new Date(Date.now() + 7 * DAY))
    const from = sqlTime(new Date(Date.now() - 3600_000))
    const out: any[] = []
    for (const sku of ['PRD-020', 'PRD-026']) { // ANCHOR (400g), TEA POWDER
      const id = pid(sku)
      const name = pos.get<{ name: string }>('SELECT name FROM products WHERE id = ?', id)!.name
      const d = await ipc('discounts:create', { name: `10% off ${name}`, type: 'percentage', value: 10, scope: 'product', product_id: id, valid_from: from, valid_until: until, is_active: true })
      expect(d.success, JSON.stringify(d)).toBe(true)
      await edit(id, { discount_pct: 10 })
      out.push({ sku, product_id: id, discount_id: d.data.id, valid_until_utc: until })
    }
    log.discounts = out
    const taxed = pid('PRD-057') // MILO
    await edit(taxed, { tax_rate: 10 })
    log.taxed = { sku: 'PRD-057', product_id: taxed, tax_rate: 10, counter_price: pos.get<{ selling_price: number }>('SELECT selling_price FROM products WHERE id = ?', taxed)!.selling_price }
  })

  it('SEED-06 not for sale, out of stock, few left', async () => {
    const nfs = pid('PRD-011') // Kerosene Oil
    await edit(nfs, { not_for_sale: 1 })
    const oos = pid('PRD-073') // DIN MILK
    await setStock(oos, 0, 'catalog test data: out of stock')
    const few = pid('PRD-081') // LUX SHOP
    await setStock(few, 4, 'catalog test data: few left')
    log.stock_states = { not_for_sale: { sku: 'PRD-011', product_id: nfs }, out_of_stock: { sku: 'PRD-073', product_id: oos }, few_left: { sku: 'PRD-081', product_id: few, qty: 4 } }
  })

  it('SEED-07 push everything to staging and read it back through the app API', async () => {
    await pos.sync(); await pos.sync()
    const items = (await api.get('/catalog/products?limit=500', { token: customer })).json.items as any[]
    const byId = new Map(items.map(p => [p.id, p]))
    const photoIds = Object.values<any>(log.photos).map(p => p.product_id)
    const withThumb = photoIds.filter(id => byId.get(id)?.thumbnail_url)
    log.readback = { catalog_items: items.length, photos_with_thumbnail: `${withThumb.length}/${photoIds.length}`, sample_thumb: byId.get(photoIds[0])?.thumbnail_url }
    expect(withThumb.length).toBe(photoIds.length)
    expect(byId.has(log.stock_states.not_for_sale.product_id)).toBe(false)
  }, 300_000)
})

describe.skipIf(PHASE !== 'order')('mixed order: weight item + variant + discounted item -> POS invoice -> FIFO stock', () => {
  it('ORD-01 place, confirm, convert; totals = counter prices; stock deducted FIFO', async () => {
    const rice = log.weight_items.rice, v = log.variant_product, disc = log.discounts[0]
    const v100 = v.variants.find((x: any) => x.name === '100g')
    // Sunlight Soap was created before the POS pushed the aggregate stock row of variant products; re-save it so the
    // (fixed) POS handler pushes that row, then pull it back like a second desktop would.
    const vs = pos.all<any>('SELECT pv.id, pv.variant_name, pv.sku, pv.selling_price, pv.cost_price, pv.attributes_json, COALESCE(s.quantity,0) stock FROM product_variants pv LEFT JOIN product_variant_stocks s ON s.variant_id = pv.id WHERE pv.product_id = ? ORDER BY pv.sort_order', v.id)
    const cur = (await ipc('products:get', v.id)).data
    const { variants: _drop, ...row } = cur
    const re = await ipc('products:update', v.id, { ...row, variants: vs.map(x => ({ id: x.id, variant_name: x.variant_name, sku: x.sku, selling_price: x.selling_price, cost_price: x.cost_price, attributes: JSON.parse(x.attributes_json || '{}'), stock: x.stock })) })
    expect(re.success, JSON.stringify(re)).toBe(true)
    await pos.sync()
    const body = {
      items: [{ product_id: rice.id, quantity: 2.5 }, { product_id: v.id, variant_id: v100.id, quantity: 2 }, { product_id: disc.product_id, quantity: 1 }],
      branch_id: seed.branches.main, payment_method: 'cod',
      address: { recipient_name: 'Catalog Tester', phone: '0771110011', line1: '1 Temple Road', city: 'Kandy' },
    }
    const placed = await api.post('/orders', body, { token: customer, headers: { 'idempotency-key': crypto.randomUUID() } })
    expect(placed.status, JSON.stringify(placed.json)).toBe(201)
    const orderId = placed.json.id as string
    const cloudLines = placed.json.items ?? []
    await pos.syncUntil(() => !!pos.get('SELECT id FROM customer_orders WHERE id = ?', orderId))
    const stockOf = (id: string) => Number(pos.get<{ quantity: number }>('SELECT quantity FROM stocks WHERE product_id = ? AND branch_id = ?', id, seed.branches.main)?.quantity ?? 0)
    const before = { rice: stockOf(rice.id), anchor: stockOf(disc.product_id), v100: Number(pos.get<{ quantity: number }>('SELECT quantity FROM product_variant_stocks WHERE variant_id = ?', v100.id)?.quantity) }
    expect((await ipc('orders:updateStatus', orderId, 'confirmed')).success).toBe(true)
    const conv = await ipc('orders:convertToInvoice', orderId)
    expect(conv.success, JSON.stringify(conv)).toBe(true)
    const invoiceId = conv.data.id as string
    const inv = pos.get<any>('SELECT invoice_number, subtotal, discount_amount, tax_amount, total_amount FROM invoices WHERE id = ?', invoiceId)
    const lines = pos.all<any>('SELECT product_id, variant_id, quantity, unit_price, discount_amount, tax_amount, line_total FROM invoice_items WHERE invoice_id = ?', invoiceId)
    const alloc = pos.all<any>(`SELECT b.batch_number, a.quantity, a.unit_cost FROM sale_batch_allocations a JOIN product_batches b ON b.id = a.batch_id WHERE a.invoice_id = ? AND a.product_id = ? ORDER BY b.purchase_date`, invoiceId, rice.id)
    const after = { rice: stockOf(rice.id), anchor: stockOf(disc.product_id), v100: Number(pos.get<{ quantity: number }>('SELECT quantity FROM product_variant_stocks WHERE variant_id = ?', v100.id)?.quantity) }
    const batches = pos.all<any>('SELECT batch_number, quantity FROM product_batches WHERE product_id = ? ORDER BY purchase_date', rice.id)
    await pos.sync()
    const appStock = Object.fromEntries(((await api.get('/catalog/products?limit=500', { token: customer })).json.items as any[]).filter(p => [rice.id, disc.product_id, v.id].includes(p.id)).map(p => [p.name, p.available_qty]))
    log.order = { order_id: orderId, order_total: placed.json.total_amount, cloud_lines: cloudLines.length, invoice_id: invoiceId, invoice: inv, lines, stock_before: before, stock_after: after, fifo_allocations: alloc, batches_after: batches, app_stock_after: appStock }
    expect(Number(inv.total_amount)).toBe(Number(placed.json.total_amount))
    expect(before.rice - after.rice).toBeCloseTo(2.5, 5)
    expect(before.v100 - after.v100).toBe(2)
    expect(before.anchor - after.anchor).toBe(1)
    expect(alloc.length).toBe(1)
    expect(alloc[0].batch_number).toBe('KS-OCT') // the older batch is consumed first
    expect(Number(batches.find((b: any) => b.batch_number === 'KS-OCT').quantity)).toBeCloseTo(7.5, 5)
    expect(Number(batches.find((b: any) => b.batch_number === 'KS-NOV').quantity)).toBeCloseTo(15.5, 5)
  }, 300_000)
})

// The order placed BY HAND on the phone (0.5 kg rice + Sunlight Soap 150g + discounted TEA POWDER): PHONE_ORDER=ONL-1008
describe.skipIf(PHASE !== 'phone')('phone order -> POS invoice -> FIFO stock', () => {
  it('PHN-01 convert the phone order; totals = app total; stock deducted', async () => {
    const no = String(process.env.PHONE_ORDER)
    const list = (await api.get('/orders?limit=50', { token: customer })).json
    const order = (list.items ?? list.orders ?? list).find((o: any) => [o.order_number, o.number, o.order_no].includes(no))
    expect(order, `order ${no} not found for the test customer`).toBeTruthy()
    const orderId = order.id as string
    await pos.syncUntil(() => !!pos.get('SELECT id FROM customer_orders WHERE id = ?', orderId))
    const items = pos.all<any>('SELECT product_id, variant_id, quantity, unit_price FROM customer_order_items WHERE order_id = ?', orderId)
    const stockOf = (id: string) => Number(pos.get<{ quantity: number }>('SELECT quantity FROM stocks WHERE product_id = ? AND branch_id = ?', id, seed.branches.main)?.quantity ?? 0)
    const vStock = (id: string) => Number(pos.get<{ quantity: number }>('SELECT quantity FROM product_variant_stocks WHERE variant_id = ?', id)?.quantity ?? 0)
    const snap = () => Object.fromEntries(items.map(i => [i.variant_id || i.product_id, i.variant_id ? vStock(i.variant_id) : stockOf(i.product_id)]))
    const before = snap()
    expect((await ipc('orders:updateStatus', orderId, 'confirmed')).success).toBe(true)
    const conv = await ipc('orders:convertToInvoice', orderId)
    expect(conv.success, JSON.stringify(conv)).toBe(true)
    const invoiceId = conv.data.id as string
    const inv = pos.get<any>('SELECT invoice_number, subtotal, discount_amount, tax_amount, total_amount FROM invoices WHERE id = ?', invoiceId)
    const lines = pos.all<any>('SELECT product_id, variant_id, quantity, unit_price, discount_amount, tax_amount, line_total FROM invoice_items WHERE invoice_id = ?', invoiceId)
    const alloc = pos.all<any>('SELECT a.product_id, b.batch_number, a.quantity, a.unit_cost FROM sale_batch_allocations a JOIN product_batches b ON b.id = a.batch_id WHERE a.invoice_id = ? ORDER BY b.purchase_date', invoiceId)
    const after = snap()
    await pos.sync()
    log.phone_order = { order_no: no, order_id: orderId, app_total: order.total_amount, order_lines: items, invoice_id: invoiceId, invoice: inv, lines, stock_before: before, stock_after: after,
      deducted: Object.fromEntries(Object.keys(before).map(k => [k, Number((before[k] - after[k]).toFixed(3))])), fifo_allocations: alloc }
    expect(Number(inv.total_amount)).toBeCloseTo(Number(order.total_amount), 2)
    for (const i of items) expect(before[i.variant_id || i.product_id] - after[i.variant_id || i.product_id]).toBeCloseTo(Number(i.quantity), 5)
  }, 300_000)
})

describe.skipIf(PHASE !== 'reserve')('reservation released at conversion', () => {
  it('RSV-01 available stock = shelf stock after the POS converts an app order; no double count', async () => {
    const rice = log.weight_items.rice, disc = log.discounts[0]
    const shelf = (id: string) => Number(pos.get<{ quantity: number }>('SELECT quantity FROM stocks WHERE product_id = ? AND branch_id = ?', id, seed.branches.main)?.quantity ?? 0)
    const avail = async () => Object.fromEntries(((await api.get('/catalog/products?limit=500', { token: customer })).json.items as any[]).filter(p => [rice.id, disc.product_id].includes(p.id)).map(p => [p.id, Number(p.available_qty)]))
    const before = await avail()
    const shelfBefore = { [rice.id]: shelf(rice.id), [disc.product_id]: shelf(disc.product_id) }
    const placed = await api.post('/orders', { items: [{ product_id: rice.id, quantity: 1.5 }, { product_id: disc.product_id, quantity: 1 }], branch_id: seed.branches.main, payment_method: 'cod',
      address: { recipient_name: 'Catalog Tester', phone: '0771110011', line1: '1 Temple Road', city: 'Kandy' } }, { token: customer, headers: { 'idempotency-key': crypto.randomUUID() } })
    expect(placed.status, JSON.stringify(placed.json)).toBe(201)
    const orderId = placed.json.id as string
    const reserved = await avail()
    await pos.syncUntil(() => !!pos.get('SELECT id FROM customer_orders WHERE id = ?', orderId))
    expect((await ipc('orders:updateStatus', orderId, 'confirmed')).success).toBe(true)
    const conv = await ipc('orders:convertToInvoice', orderId)
    expect(conv.success, JSON.stringify(conv)).toBe(true)
    await pos.sync()
    const after = await avail()
    log.reservation = { order_id: orderId, available_before: before, available_reserved: reserved, available_after_conversion: after, shelf_after: { [rice.id]: shelf(rice.id), [disc.product_id]: shelf(disc.product_id) } }
    // Other open orders of this staging company still reserve stock, so compare the gap (shelf - available = reserved by OTHER orders):
    // it must be identical before placing and after converting. A leftover reservation of the converted order would widen it.
    const gap = (shelfAt: Record<string, number>, av: Record<string, number>, id: string) => Number((shelfAt[id] - av[id]).toFixed(3))
    const shelfNow = { [rice.id]: shelf(rice.id), [disc.product_id]: shelf(disc.product_id) }
    expect(before[rice.id] - reserved[rice.id]).toBeCloseTo(1.5, 5)          // placing reserves
    expect(after[rice.id]).toBeCloseTo(reserved[rice.id], 5)                  // converting does not take the goods a second time
    for (const id of [rice.id, disc.product_id]) expect(gap(shelfNow, after, id), `gap ${id}`).toBeCloseTo(gap(shelfBefore, before, id), 5)
  }, 300_000)
})
