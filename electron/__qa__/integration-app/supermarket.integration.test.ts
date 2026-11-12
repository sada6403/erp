// Supermarket catalog check (SYNTHETIC: no real supermarket database is available locally).
// A fresh tenant is switched to business_type=supermarket and given a grocery-style catalog (weight items, tax, discounts,
// variants, FIFO batches with batch prices, images, hidden / out-of-stock items). Then:
//   app API shows the right prices/stock/images and never cost data  ->  live POS edits (real SQLite + enqueuSync + SyncService)
//   reach the app within one sync cycle  ->  the app API never writes to products / stocks / batches (read-only guarantee).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { appApi, cloudDb, createPos, Evidence, j, startTenant, stopTenant, BASE_URL, type CloudDb, type Pos, type Seed } from './harness'

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

const ROOT = path.resolve(__dirname, '..', '..', '..')
const envFile = Object.fromEntries(fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8').split(/\r?\n/)
  .filter(l => l && !l.startsWith('#') && l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^['"]|['"]$/g, '')] })) as Record<string, string>
const UPLOAD_DIR = envFile.UPLOAD_DIR || path.join(ROOT, 'backend', 'uploads')
const MAIN_DB = envFile.MYSQL_DATABASE || 'pos_erp_saas'
const money = (n: number) => Math.round(n * 100) / 100
const COST_KEY = /cost|profit|margin|batch|supplier|purchase|expiry/i

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos, token: string
const ev = new Evidence('supermarket')
const P: Record<string, string> = {} // name -> product id
const imageFiles: string[] = []

// minimal valid 1x1 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')

const colCache = new Map<string, Set<string>>()
async function ins(table: string, row: Record<string, unknown>) {
  let cols = colCache.get(table)
  if (!cols) { cols = new Set((await db.query<{ Field: string }>(`SHOW COLUMNS FROM ${table}`)).map(r => r.Field)); colCache.set(table, cols) }
  const keys = Object.keys(row).filter(k => cols!.has(k))
  await db.exec(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, keys.map(k => row[k]))
}
function assertNoCostKeys(value: unknown, where: string, trail = ''): void {
  if (Array.isArray(value)) { value.forEach((v, i) => assertNoCostKeys(v, where, `${trail}[${i}]`)); return }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) {
      if (COST_KEY.test(k)) throw new Error(`${where}: forbidden key "${trail}.${k}"`)
      assertNoCostKeys(v, where, `${trail}.${k}`)
    }
  }
}
const list = async (qs = 'limit=500') => (await api.get(`/catalog/products?${qs}`)).json.items as any[]
const find = async (name: string) => (await list()).find(i => i.id === P[name])
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  db = await cloudDb(seed)
  token = await api.login(seed.logins.customer_smartbuy.identifier, seed.password)
  const main = seed.branches.main

  // ── supermarket mode (main DB, like the super-admin business-type switch) ──
  await db.exec(`UPDATE \`${MAIN_DB}\`.companies SET business_type = 'supermarket' WHERE id = ?`, [seed.company_id])
  // start from a clean synthetic catalog: remove the seeded products so counts/prices are exactly ours
  await db.exec(`DELETE FROM stock_reservations`); await db.exec(`DELETE FROM customer_order_items`); await db.exec(`DELETE FROM customer_orders`)
  await db.exec(`DELETE FROM product_variant_stocks`); await db.exec(`DELETE FROM product_variants`); await db.exec(`DELETE FROM stocks`)
  await db.exec(`DELETE FROM invoice_items`); await db.exec(`DELETE FROM sale_items`).catch(() => undefined)
  await db.exec(`DELETE FROM products`)
  await db.exec(`DELETE FROM categories`)

  const cat = { veg: randomUUID(), dairy: randomUUID(), dry: randomUUID() }
  await ins('categories', { id: cat.veg, name: 'Vegetables', sort_order: 1, is_active: 1 })
  await ins('categories', { id: cat.dairy, name: 'Dairy', sort_order: 2, is_active: 1 })
  await ins('categories', { id: cat.dry, name: 'Dry Rations', sort_order: 3, is_active: 1 })
  P.catVeg = cat.veg; P.catDairy = cat.dairy; P.catDry = cat.dry

  fs.mkdirSync(UPLOAD_DIR, { recursive: true })
  const img = `sm-test-${Date.now()}.png`
  fs.writeFileSync(path.join(UPLOAD_DIR, img), PNG); imageFiles.push(img)
  P.imageName = img

  const prod = async (key: string, name: string, v: Record<string, unknown>, stock: number | null = 50) => {
    const id = randomUUID(); P[key] = id
    await ins('products', { id, name, sku: `SM-${key.toUpperCase()}-${id.slice(0, 6)}`, cost_price: 111, selling_price: 100, tax_rate: 0, discount_pct: 0,
      is_active: 1, is_online: 1, not_for_sale: 0, is_manage_stock: 1, track_stock: 1, sale_by: 'normal', unit: 'pcs', category_id: cat.dry, ...v })
    if (stock !== null) await ins('stocks', { id: randomUUID(), product_id: id, branch_id: main, quantity: stock, damaged_qty: 0 })
    return id
  }
  await prod('carrot', 'Carrot', { selling_price: 400, sale_by: 'weight', unit: 'kg', category_id: cat.veg }, 20)
  await prod('cheese', 'Cheese Block', { selling_price: 2400, tax_rate: 8, sale_by: 'weight', unit: 'kg', category_id: cat.dairy }, 5)
  await prod('milk', 'Milk Powder 400g', { selling_price: 1050, discount_pct: 10, category_id: cat.dairy }, 30)
  await prod('biscuit', 'Biscuit Pack', { selling_price: 250, tax_rate: 18 }, 100)
  await prod('juice', 'Fruit Juice 1L', { selling_price: 500, discount_pct: 20, tax_rate: 10 }, 40)
  await prod('dhal', 'Dhal 1kg', { selling_price: 300, cost_price: 200 }, 15)
  await prod('sugar', 'Sugar 1kg', { selling_price: 260 }, 0)
  await prod('bread', 'Fresh Bread', { selling_price: 90, is_manage_stock: 0 }, null)
  await prod('hiddenNfs', 'Not For Sale Item', { not_for_sale: 1 }, 10)
  await prod('hiddenOffline', 'Offline Only Item', { is_online: 0 }, 10)
  await prod('hiddenInactive', 'Inactive Item', { is_active: 0 }, 10)
  await prod('pic', 'Item With Image', { selling_price: 75, image_url: `/api/files/${img}` }, 10)
  await prod('remotePic', 'Item With Remote Image', { selling_price: 80, image_url: 'https://example.invalid/pic.jpg' }, 10)
  await prod('drink', 'Soft Drink', { selling_price: 200 }, null)
  // variants
  const v1 = randomUUID(), v2 = randomUUID(); P.v500 = v1; P.v15 = v2
  await ins('product_variants', { id: v1, product_id: P.drink, variant_name: '500 ml', sku: `SD-500-${v1.slice(0, 4)}`, selling_price: 0, cost_price: 90, attributes_json: JSON.stringify({ Size: '500 ml' }), is_active: 1, sort_order: 1 })
  await ins('product_variants', { id: v2, product_id: P.drink, variant_name: '1.5 L', sku: `SD-15-${v2.slice(0, 4)}`, selling_price: 350, cost_price: 200, attributes_json: JSON.stringify({ Size: '1.5 L' }), is_active: 1, sort_order: 2 })
  await ins('product_variant_stocks', { id: randomUUID(), variant_id: v1, product_id: P.drink, branch_id: main, quantity: 10, damaged_qty: 0 })
  await ins('product_variant_stocks', { id: randomUUID(), variant_id: v2, product_id: P.drink, branch_id: main, quantity: 0, damaged_qty: 0 })
  // FIFO batches with batch selling prices (supermarket stock)
  const b = (q: number, price: number, date: string) => ins('product_batches', { id: randomUUID(), product_id: P.dhal, branch_id: main, batch_number: `B-${date}`, quantity: q, original_quantity: q, cost_price: 190, selling_price: price, purchase_date: date, status: 'active', historical_cost_known: 1 })
  await b(5, 280, '2026-10-01'); await b(10, 320, '2026-10-20')
  pos = await createPos(state, seed)
}, 600_000)

afterAll(async () => {
  ev.save()
  for (const f of imageFiles) { try { fs.rmSync(path.join(UPLOAD_DIR, f)); fs.rmSync(path.join(UPLOAD_DIR, 'thumbs', `${f}.300.webp`), { force: true }); fs.rmSync(path.join(UPLOAD_DIR, 'thumbs', `${f}.800.webp`), { force: true }) } catch { /* ignore */ } }
  await db?.close()
  stopTenant(seed)
})

describe('supermarket catalog (synthetic)', () => {
  it('SM-01 supermarket company hides Smart Buy and Installments (GET /status modules)', async () => {
    const s = await api.get('/status')
    const row = await db.one(`SELECT business_type FROM \`${MAIN_DB}\`.companies WHERE id = ?`, [seed.company_id])
    expect(s.status).toBe(200)
    ev.add({ id: 'SM-01', action: 'Company switched to supermarket: modules', api: `GET /status -> ${s.status} modules ${j(s.json.modules)}`,
      cloud: `[${MAIN_DB}] companies.business_type=${row.business_type}`, pos: 'n/a (POS hides the same modules by business type)', reverse: 'n/a', ms: s.ms,
      result: !s.json.modules.smartbuy && !s.json.modules.installments ? 'PASS' : 'FAIL' })
    expect(s.json.modules).toEqual({ smartbuy: false, installments: false })
  })

  it('SM-02 list: visibility, per-item prices (weight, tax-on-top, discount, both), stock flags', async () => {
    const t0 = Date.now()
    const r = await api.get('/catalog/products?limit=500')
    expect(r.status).toBe(200)
    const items = r.json.items as any[]
    const ids = new Set(items.map(i => i.id))
    for (const k of ['hiddenNfs', 'hiddenOffline', 'hiddenInactive']) expect(ids.has(P[k]), k).toBe(false)
    const by = (k: string) => items.find(i => i.id === P[k])
    expect(by('carrot')).toMatchObject({ sale_by: 'weight', unit: 'kg', qty_step: 0.25, min_qty: 0.25, price: 400, in_stock: true, available_qty: 20 })
    expect(by('cheese')).toMatchObject({ sale_by: 'weight', price: money(2400 * 1.08), original_price: null })
    expect(by('milk')).toMatchObject({ price: 945, original_price: 1050, discount_pct: 10 })
    expect(by('biscuit')).toMatchObject({ price: money(250 * 1.18) })
    expect(by('juice')).toMatchObject({ price: money(400 * 1.1), original_price: money(500 * 1.1) })
    expect(by('sugar')).toMatchObject({ in_stock: false, available_qty: 0 })
    expect(by('bread')).toMatchObject({ in_stock: true, available_qty: null })
    expect(by('dhal')).toMatchObject({ price: 300, available_qty: 15 })
    expect(items.length).toBe(11)
    const rows = await db.query(`SELECT name, selling_price, tax_rate, discount_pct, sale_by, unit, is_online, not_for_sale, is_active, updated_at FROM products ORDER BY name`)
    ev.add({ id: 'SM-02', action: 'Catalog list (grocery mix)', api: `GET /catalog/products -> ${r.status}, ${items.length} visible of ${rows.length}; carrot ${j(by('carrot').price)}/kg step 0.25; cheese ${by('cheese').price}; milk ${by('milk').price} (was ${by('milk').original_price}); juice ${by('juice').price}`,
      cloud: `[${seed.db_schema}] products ${j(rows)}`, pos: 'n/a (read side)', reverse: 'n/a', ms: Date.now() - t0, result: 'PASS' })
  })

  it('SM-03 detail + variants + categories', async () => {
    const d = await api.get(`/catalog/products/${P.drink}`)
    expect(d.status).toBe(200)
    expect(d.json.has_variants).toBe(true)
    expect(d.json.price).toBe(200) // cheapest variant (500 ml falls back to the product price)
    const names = d.json.variants.map((v: any) => [v.name, v.price, v.in_stock, v.available_qty])
    expect(names).toEqual([['500 ml', 200, true, 10], ['1.5 L', 350, false, 0]])
    for (const k of ['hiddenNfs', 'hiddenOffline', 'hiddenInactive']) expect((await api.get(`/catalog/products/${P[k]}`)).status).toBe(404)
    const c = await api.get('/catalog/categories')
    const counts = Object.fromEntries(c.json.items.map((x: any) => [x.name, x.product_count]))
    expect(counts).toMatchObject({ Vegetables: 1, Dairy: 2 })
    ev.add({ id: 'SM-03', action: 'Variants, hidden item detail 404, category counts', api: `GET /catalog/products/:id -> ${d.status} variants ${j(names)}; hidden -> 404; categories ${j(counts)}`,
      cloud: `[${seed.db_schema}] product_variants ${j(await db.query(`SELECT variant_name, selling_price, is_active FROM product_variants`))}; product_variant_stocks ${j(await db.query(`SELECT variant_id, quantity FROM product_variant_stocks`))}`,
      pos: 'n/a', reverse: 'n/a', ms: d.ms, result: 'PASS' })
  })

  it('SM-04 images: local upload resolves (HTTP 200 webp), remote URL passed through, no image = null', async () => {
    const pic = await find('pic')
    expect(pic.thumbnail_url).toContain(`/media/img/${P.imageName}`)
    const res = await fetch(pic.thumbnail_url)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('image/webp')
    const big = await fetch(pic.thumbnail_url.replace('w=300', 'w=800'))
    expect(big.status).toBe(200)
    const detail = await api.get(`/catalog/products/${P.pic}`)
    expect(detail.json.gallery[0].medium).toContain('w=800')
    const remote = await find('remotePic')
    expect(remote.thumbnail_url).toBe('https://example.invalid/pic.jpg')
    expect((await find('carrot')).thumbnail_url).toBeNull()
    expect((await fetch(`${BASE_URL}/api/app/v1/media/img/missing-${Date.now()}.png?w=300`)).status).toBe(404)
    ev.add({ id: 'SM-04', action: 'Product images', api: `thumb ${pic.thumbnail_url} -> ${res.status} ${res.headers.get('content-type')}; 800px ${big.status}; remote passthrough; missing file 404`,
      cloud: `[${seed.db_schema}] products.image_url ${j(await db.query(`SELECT name, image_url FROM products WHERE image_url IS NOT NULL`))}`, pos: 'n/a', reverse: 'n/a', result: 'PASS' })
  })

  it('SM-05 quote: fractional weight quantities, tax rounding like the counter, stock issues, hidden item', async () => {
    const q = async (items: any[]) => api.post('/checkout/quote', { items }, { token })
    const r = await q([{ product_id: P.carrot, quantity: 0.75 }, { product_id: P.cheese, quantity: 0.25 }, { product_id: P.biscuit, quantity: 3 }, { product_id: P.juice, quantity: 2 }, { product_id: P.milk, quantity: 2 }])
    expect(r.status).toBe(200)
    const line = (id: string) => r.json.lines.find((l: any) => l.product_id === id)
    const cheeseTaxable = money(2400 * 0.25)
    expect(line(P.carrot).line_total).toBe(300)
    expect(line(P.cheese).line_total).toBe(money(cheeseTaxable + money(cheeseTaxable * 0.08)))
    expect(line(P.biscuit).line_total).toBe(money(750 + money(750 * 0.18)))
    expect(line(P.juice).line_total).toBe(money(800 + money(800 * 0.1)))
    expect(line(P.milk).line_total).toBe(1890)
    const sum = money(r.json.lines.reduce((s: number, l: any) => s + l.line_total, 0))
    expect(r.json.subtotal).toBe(sum)
    const bad = await q([{ product_id: P.sugar, quantity: 1 }, { product_id: P.hiddenNfs, quantity: 1 }, { product_id: P.cheese, quantity: 50 }, { product_id: P.bread, quantity: 5 }])
    const issue = (id: string) => bad.json.lines.find((l: any) => l.product_id === id)?.issue
    expect(issue(P.sugar)).toBe('OUT_OF_STOCK')
    expect(['NOT_FOR_SALE', 'NOT_FOUND']).toContain(issue(P.hiddenNfs))
    expect(issue(P.cheese)).toBe('INSUFFICIENT_STOCK')
    expect(issue(P.bread)).toBeNull()
    expect(bad.json.can_order).toBe(false)
    ev.add({ id: 'SM-05', action: 'Quote with fractional weights + tax rounding + stock issues', api: `POST /checkout/quote -> ${r.status}; lines ${j(r.json.lines.map((l: any) => [l.name, l.quantity, l.unit_price, l.line_total]))}; subtotal ${r.json.subtotal}; issues sugar=${issue(P.sugar)} hidden=${issue(P.hiddenNfs)} over-qty=${issue(P.cheese)} unmanaged-bread=${issue(P.bread)}`,
      cloud: `[${seed.db_schema}] stocks ${j(await db.query(`SELECT product_id, quantity FROM stocks WHERE product_id IN (?,?)`, [P.cheese, P.sugar]))}`, pos: 'n/a', reverse: 'n/a', ms: r.ms, result: 'PASS' })
  })

  it('SM-06 FIFO batch prices: app shows the product selling price (documented rule), batch/cost data never exposed', async () => {
    const item = await find('dhal')
    const layers = await db.query(`SELECT batch_number, quantity, selling_price, cost_price FROM product_batches WHERE product_id = ? ORDER BY purchase_date`, [P.dhal])
    expect(item.price).toBe(300)
    // POS counter price for the next 6 kg = FIFO layers 5 @280 + 1 @320 (quoteBatchPrice) -> differs from the app's 300 display price
    const counter6 = money((5 * 280 + 1 * 320) / 6)
    const q = await api.post('/checkout/quote', { items: [{ product_id: P.dhal, quantity: 6 }] }, { token })
    expect(q.json.lines[0].unit_price).toBe(300)
    const detail = await api.get(`/catalog/products/${P.dhal}`)
    for (const [where, body] of [['list', await list()], ['detail', detail.json], ['quote', q.json]] as const) assertNoCostKeys(body, where)
    ev.add({ id: 'SM-06', action: 'Batch-priced item: price rule + no cost leak', api: `GET product -> price ${item.price}; quote 6 kg unit ${q.json.lines[0].unit_price}; no cost/profit/batch/supplier keys in list, detail, quote`,
      cloud: `[${seed.db_schema}] product_batches ${j(layers)}`, pos: `POS counter (supermarket stock) would price 6 kg at FIFO average ${counter6}; the app locks 300 on the order and POS conversion honours the locked price (covered by app-order-invoice.integration)`, reverse: 'n/a',
      result: 'PASS', notes: 'Open item: app display price = products.selling_price, counter price = FIFO batch price; they differ while layers carry their own selling price.' })
  })

  it('SM-07 read-only guarantee: many app reads never write products / stocks / batches / variants', { timeout: 300_000 }, async () => {
    const snap = async () => {
      const out: Record<string, unknown> = {}
      for (const t of ['products', 'stocks', 'product_batches', 'product_variants', 'product_variant_stocks', 'categories']) {
        out[t] = await db.one(`SELECT COUNT(*) AS n, MAX(updated_at) AS max_updated FROM ${t}`)
      }
      out.sums = {
        stocks: await db.one(`SELECT SUM(quantity) AS q, SUM(damaged_qty) AS d FROM stocks`),
        batches: await db.one(`SELECT SUM(quantity) AS q, SUM(sold_quantity) AS s FROM product_batches`),
        prices: await db.one(`SELECT SUM(selling_price) AS s, SUM(cost_price) AS c FROM products`),
      }
      return JSON.stringify(out)
    }
    const before = await snap()
    let calls = 0
    const go = async (p: string, o: any = {}) => { calls++; const r = await api.get(p, o); expect(r.status).toBeLessThan(500) }
    for (let i = 0; i < 2; i++) {
      await go('/catalog/products?limit=500'); await go('/catalog/products?limit=5&sort=price_asc'); await go('/catalog/categories')
      await go(`/catalog/products/${P.carrot}`); await go(`/catalog/products/${P.drink}`); await go('/catalog/search?q=ca'); await go('/catalog/suggest?q=su')
      await go('/catalog/banners'); await go('/status'); await go('/watermark'); await go('/company')
      await go('/catalog/products?limit=500', { token }); await go('/watermark', { token })
      await api.post('/checkout/quote', { items: [{ product_id: P.carrot, quantity: 1.25 }, { product_id: P.drink, quantity: 1 }] }, { token }); calls++
    }
    const after = await snap()
    expect(after).toBe(before)
    ev.add({ id: 'SM-07', action: `Read-only guarantee after ${calls} app reads/quotes (guest + customer)`, api: `${calls} calls, all < 500`,
      cloud: `[${seed.db_schema}] row counts, MAX(updated_at), SUM(quantity/sold/price/cost) of products, stocks, product_batches, product_variants, product_variant_stocks, categories identical before and after: ${before.slice(0, 600)}`,
      pos: 'n/a', reverse: 'n/a', result: 'PASS' })
  })

  it('SM-08 placing an order only reserves stock (stock_reservations); stocks/batches/products untouched; cancel releases', async () => {
    const snap = async () => JSON.stringify([
      await db.query(`SELECT id, quantity, damaged_qty, updated_at FROM stocks ORDER BY id`),
      await db.query(`SELECT id, quantity, sold_quantity, updated_at FROM product_batches ORDER BY id`),
      await db.query(`SELECT id, selling_price, updated_at FROM products ORDER BY id`),
    ])
    const before = await snap()
    const addr = { recipient_name: 'Anula', phone: '0771110001', line1: '10 Temple Road', city: 'Colombo' }
    const q = await api.post('/checkout/quote', { items: [{ product_id: P.carrot, quantity: 1.5 }] }, { token })
    const o = await api.post('/orders', { items: [{ product_id: P.carrot, quantity: 1.5 }], payment_method: 'cod', address: addr, expected_total: q.json.total }, { token, headers: { 'idempotency-key': `sm-${Date.now()}` } })
    expect(o.status, JSON.stringify(o.json)).toBe(201)
    const res = await db.query(`SELECT product_id, variant_id, branch_id, quantity, status, expires_at, created_at FROM stock_reservations WHERE order_id = ?`, [o.json.id])
    expect(res.length).toBe(1)
    expect(Number(res[0].quantity)).toBe(1.5)
    expect(await snap()).toBe(before)
    const afterOrder = await find('carrot')
    expect(afterOrder.available_qty).toBe(18.5)
    const itemRow = await db.one(`SELECT quantity, unit_price, net_unit_price, tax_rate, line_total FROM customer_order_items WHERE order_id = ?`, [o.json.id])
    expect(Number(itemRow.quantity)).toBe(1.5)
    const c = await api.post(`/orders/${o.json.id}/cancel`, {}, { token })
    expect(c.status).toBe(200)
    expect((await find('carrot')).available_qty).toBe(20)
    expect(await snap()).toBe(before)
    ev.add({ id: 'SM-08', action: 'Order of 1.5 kg: reservation path only', api: `POST /orders -> ${o.status}; available 20 -> ${afterOrder.available_qty}; cancel -> ${c.status}; available back to 20`,
      cloud: `[${seed.db_schema}] stock_reservations ${j(res)}; customer_order_items ${j(itemRow)}; stocks/product_batches/products rows unchanged`, pos: 'n/a (stock is deducted when the POS invoices the order)', reverse: 'n/a', ms: o.ms, result: 'PASS' })
  })
})

describe('live POS edits reach the app within one sync cycle', () => {
  const wm = async () => (await api.get('/watermark')).json.areas.catalog as string | null
  /** apply a POS-side edit through the real local SQLite + sync queue, push with one sync cycle, return ms */
  async function posEdit(table: string, id: string, patch: Record<string, unknown>): Promise<number> {
    const { enqueuSync } = await import('../../services/syncQueue')
    const sets = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
    pos.db.prepare(`UPDATE ${table} SET ${sets}, updated_at=datetime('now') WHERE id=@id`).run({ ...patch, id })
    // like the real POS stock paths, a stock push carries the whole row (identity + quantities)
    const full = table === 'stocks' ? pos.get<Record<string, unknown>>(`SELECT id, product_id, branch_id, warehouse_id, quantity, damaged_qty FROM stocks WHERE id=?`, id)! : { id, ...patch }
    await enqueuSync(table, id, 'UPDATE', full)
    return pos.sync()
  }

  it('SM-09 POS pulls the catalog (products, stocks, categories) from the cloud', async () => {
    const t = await pos.sync()
    const n = pos.get<{ n: number }>(`SELECT COUNT(*) AS n FROM products WHERE id IN (${Object.values(P).filter(v => v.length === 36).map(() => '?').join(',')})`, ...Object.values(P).filter(v => v.length === 36))
    expect(n!.n).toBeGreaterThanOrEqual(13)
    const carrot = pos.get<any>(`SELECT name, selling_price, sale_by, unit, tax_rate, discount_pct FROM products WHERE id=?`, P.carrot)
    expect(carrot).toMatchObject({ name: 'Carrot', selling_price: 400, sale_by: 'weight' })
    ev.add({ id: 'SM-09', action: 'POS pull of the supermarket catalog', api: 'n/a', cloud: `[${seed.db_schema}] ${n!.n} synthetic products`, pos: `Products screen rows in SQLite: ${j(carrot)}; ${n!.n} products; sync ${t} ms`, reverse: 'n/a', ms: t, result: 'PASS' })
  })

  it('SM-10 price change (POS -> app)', async () => {
    const w0 = await wm(); await sleep(1100)
    const ms = await posEdit('products', P.carrot, { selling_price: 450 })
    const item = await find('carrot')
    expect(item.price).toBe(450)
    const w1 = await wm()
    expect(w1).not.toBe(w0)
    ev.add({ id: 'SM-10', action: 'POS price edit Carrot 400 -> 450', api: `GET /catalog/products carrot.price ${item.price}; watermark.catalog ${w0} -> ${w1}`, cloud: `products ${j(await db.one(`SELECT selling_price, updated_at FROM products WHERE id=?`, [P.carrot]))}`, pos: 'Products > edit price (SQLite + sync queue)', reverse: 'POS -> app', ms, result: 'PASS' })
  })

  it('SM-11 tax rate and discount change', async () => {
    const ms1 = await posEdit('products', P.biscuit, { tax_rate: 8 })
    expect((await find('biscuit')).price).toBe(money(250 * 1.08))
    const ms2 = await posEdit('products', P.milk, { discount_pct: 20 })
    const milk = await find('milk')
    expect(milk).toMatchObject({ price: 840, original_price: 1050, discount_pct: 20 })
    const q = await api.post('/checkout/quote', { items: [{ product_id: P.biscuit, quantity: 3 }, { product_id: P.milk, quantity: 1 }] }, { token })
    expect(q.json.lines[0].line_total).toBe(money(750 + money(750 * 0.08)))
    expect(q.json.lines[1].line_total).toBe(840)
    ev.add({ id: 'SM-11', action: 'POS tax 18% -> 8% (biscuit), discount 10% -> 20% (milk)', api: `biscuit ${money(250 * 1.08)}; milk ${milk.price} (was ${milk.original_price}); quote lines ${j(q.json.lines.map((l: any) => l.line_total))}`,
      cloud: `products ${j(await db.query(`SELECT name, tax_rate, discount_pct, updated_at FROM products WHERE id IN (?,?)`, [P.biscuit, P.milk]))}`, pos: 'Products > edit tax/discount', reverse: 'POS -> app', ms: ms1 + ms2, result: 'PASS' })
  })

  it('SM-12 stock change (restock sold-out item, sell down a stocked one)', async () => {
    const sugarStock = pos.get<any>(`SELECT id, quantity FROM stocks WHERE product_id=? LIMIT 1`, P.sugar)
    expect(sugarStock, 'stock row pulled to POS').toBeTruthy()
    const ms1 = await posEdit('stocks', sugarStock.id, { quantity: 12 })
    let sugar = await find('sugar')
    const ok1 = sugar.in_stock === true && sugar.available_qty === 12
    const dhalStock = pos.get<any>(`SELECT id FROM stocks WHERE product_id=? LIMIT 1`, P.dhal)
    const ms2 = await posEdit('stocks', dhalStock.id, { quantity: 0 })
    const dhal = await find('dhal')
    const ok2 = dhal.in_stock === false
    ev.add({ id: 'SM-12', action: 'POS stock edit: Sugar 0 -> 12, Dhal 15 -> 0', api: `sugar in_stock=${sugar.in_stock} qty=${sugar.available_qty}; dhal in_stock=${dhal.in_stock}`,
      cloud: `stocks ${j(await db.query(`SELECT product_id, quantity, updated_at FROM stocks WHERE product_id IN (?,?)`, [P.sugar, P.dhal]))}`, pos: 'Stock screen (SQLite stocks + sync queue)', reverse: 'POS -> app', ms: ms1 + ms2, result: ok1 && ok2 ? 'PASS' : 'FAIL' })
    expect(ok1).toBe(true); expect(ok2).toBe(true)
  })

  it('SM-13 visibility toggle (is_online / not_for_sale) and category move', async () => {
    const ms1 = await posEdit('products', P.juice, { is_online: 0 })
    expect((await find('juice'))).toBeUndefined()
    expect((await api.get(`/catalog/products/${P.juice}`)).status).toBe(404)
    // delta feed tells the app to drop it
    const since = new Date(Date.now() - 60_000).toISOString()
    const delta = await api.get(`/catalog/products?updated_since=${encodeURIComponent(since)}&limit=500`)
    expect(delta.json.removed_ids).toContain(P.juice)
    const ms2 = await posEdit('products', P.juice, { is_online: 1 })
    expect((await find('juice')).id).toBe(P.juice)
    const ms3 = await posEdit('products', P.cheese, { category_id: P.catDry })
    const cheese = await find('cheese')
    expect(cheese.category_id).toBe(P.catDry)
    const cats = Object.fromEntries((await api.get('/catalog/categories')).json.items.map((x: any) => [x.name, x.product_count]))
    expect(cats.Dairy).toBe(1)
    ev.add({ id: 'SM-13', action: 'POS hides Juice (online off) then shows it; moves Cheese Dairy -> Dry Rations', api: `hidden: list gone, detail 404, delta removed_ids has it; shown again; cheese.category_id=${cheese.category_id}; category counts ${j(cats)}`,
      cloud: `products ${j(await db.query(`SELECT name, is_online, category_id, updated_at FROM products WHERE id IN (?,?)`, [P.juice, P.cheese]))}`, pos: 'Products > online store toggle / category', reverse: 'POS -> app', ms: ms1 + ms2 + ms3, result: 'PASS' })
  })

  it('SM-14 image change', async () => {
    const second = `sm-test-b-${Date.now()}.png`
    fs.writeFileSync(path.join(UPLOAD_DIR, second), PNG); imageFiles.push(second)
    const ms = await posEdit('products', P.carrot, { image_url: `/api/files/${second}` })
    const item = await find('carrot')
    expect(item.thumbnail_url).toContain(second)
    const res = await fetch(item.thumbnail_url)
    expect(res.status).toBe(200)
    ev.add({ id: 'SM-14', action: 'POS sets a product image', api: `carrot.thumbnail_url ${item.thumbnail_url} -> ${res.status}`, cloud: `products.image_url ${j(await db.one(`SELECT image_url FROM products WHERE id=?`, [P.carrot]))}`, pos: 'Products > image', reverse: 'POS -> app', ms, result: 'PASS' })
  })

  it('SM-15 new product created in the POS appears in the app; POS delete/deactivate removes it', async () => {
    const { enqueuSync } = await import('../../services/syncQueue')
    const id = randomUUID()
    const row = { id, name: 'POS Made Tomato', sku: `POS-TOM-${id.slice(0, 5)}`, cost_price: 80, selling_price: 220, tax_rate: 0, track_stock: 1, is_active: 1, is_online: 1, not_for_sale: 0, sale_by: 'weight', unit: 'kg', is_manage_stock: 1, category_id: P.catVeg }
    const cols = pos.all<{ name: string }>(`PRAGMA table_info(products)`).map(c => c.name)
    const keys = Object.keys(row).filter(k => cols.includes(k))
    pos.db.prepare(`INSERT INTO products (${keys.join(',')}) VALUES (${keys.map(k => '@' + k).join(',')})`).run(row)
    await enqueuSync('products', id, 'INSERT', Object.fromEntries(keys.map(k => [k, (row as any)[k]])))
    const stockId = randomUUID()
    pos.db.prepare(`INSERT INTO stocks (id, product_id, branch_id, quantity, damaged_qty) VALUES (?,?,?,?,0)`).run(stockId, id, seed.branches.main, 8)
    await enqueuSync('stocks', stockId, 'INSERT', { id: stockId, product_id: id, branch_id: seed.branches.main, quantity: 8, damaged_qty: 0 })
    const ms1 = await pos.sync()
    const r = (await list()).find(i => i.id === id)
    expect(r, 'new POS product visible in app').toBeTruthy()
    expect(r).toMatchObject({ price: 220, sale_by: 'weight', available_qty: 8 })
    const ms2 = await posEdit('products', id, { is_active: 0 })
    expect((await list()).find(i => i.id === id)).toBeUndefined()
    ev.add({ id: 'SM-15', action: 'New product made in POS (weight item + stock) then deactivated', api: `app shows ${r.name} ${r.price}/kg qty ${r.available_qty}; after deactivate: gone`, cloud: `products ${j(await db.one(`SELECT name, selling_price, sale_by, is_active FROM products WHERE id=?`, [id]))}`, pos: 'Products > add (SQLite INSERT + queue)', reverse: 'POS -> app (create + deactivate)', ms: ms1 + ms2, result: 'PASS' })
  })
})
