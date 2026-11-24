// STAGING ONLY: proves POS -> cloud -> mobile-app live sync for the staging copy of TK Fresh Choice, using the REAL POS code paths
// (products:create/update, stocks:adjustCorrection, products:selectAndUploadImage -> /api/upload, then the normal sync push).
// For a few products it sets price, stock, a detail (name + description) and a PHOTO in the POS, syncs once, and reads the SAME product
// back through the app API (/api/app/v1/catalog/*) exactly like the phone does: price, in_stock, name/description, thumbnail + gallery.
//
// Never touches production: refuses any base URL that is not staging/localhost and any schema that is not a *test copy*.
// Run:  TK_SEED=<seed json> TEST_BASE_URL=https://staging-api.72-61-115-222.sslip.io \
//       ELECTRON_RUN_AS_NODE=1 electron vitest run --project=integration electron/__qa__/integration-app/tk-pos-to-app.integration.test.ts
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

const SEED_FILE = process.env.TK_SEED || ''
const IMAGES = path.resolve(__dirname, '..', '..', '..', 'docs', 'mobile-app', 'test-images')
const REPORT = path.join(EVIDENCE_DIR, 'tk-pos-to-app.json')
const log: Record<string, any> = {}
const FINAL = process.env.TK_FINAL === '1' // second run: only leave the proof products in a nice in-stock state for the phone screenshots

let seed: Seed, pos: Pos, api: ReturnType<typeof appApi>, token: string

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
const upload = async (file: string): Promise<string> => {
  hoisted.nextFile = path.join(IMAGES, file)
  const up = await ipc('products:selectAndUploadImage')
  expect(up.success, JSON.stringify(up)).toBe(true)
  expect(up.local_only, `${file} stayed on the device (cloud upload failed)`).toBeFalsy()
  return up.data as string
}
/** What the phone shows for one product (list card) - fetched like the app does. */
const card = async (id: string) => {
  const items = (await api.get('/catalog/products?limit=500', { token })).json.items as any[]
  return items.find(p => p.id === id)
}

beforeAll(async () => {
  if (!SEED_FILE) return
  if (!/staging-api\.|localhost|127\.0\.0\.1/.test(BASE_URL)) throw new Error(`Refusing: ${BASE_URL} is not staging/localhost`)
  const raw = JSON.parse(fs.readFileSync(SEED_FILE, 'utf8'))
  if (!String(raw.db_schema).startsWith('pos_erp_app_test_company_')) throw new Error(`Refusing schema ${raw.db_schema}`)
  seed = { ...raw, base_url: BASE_URL, branches: { main: raw.branch_id, kandy: raw.branch_id }, file: SEED_FILE } as Seed
  api = appApi(seed)
  pos = await createPos(state, seed)
  state.data.app_settings = { ...state.data.app_settings, business_type: 'supermarket' }
  const [{ registerProductHandlers }, { registerStockHandlers }] = await Promise.all([import('../../ipc/products'), import('../../ipc/stocks')])
  registerProductHandlers(fakeIpcMain); registerStockHandlers(fakeIpcMain)
  await pos.sync()
  const admin = pos.get<{ id: string; name: string }>('SELECT id, name FROM users ORDER BY created_at LIMIT 1')
  state.data.auth_user = { id: admin?.id ?? 'stg-admin', name: admin?.name ?? 'Staging Admin', branch_id: seed.branches.main, role: { permissions: { all: true } } }
  token = await api.login(raw.logins.customer, raw.password)
}, 300_000)

afterAll(() => {
  if (!SEED_FILE) return
  fs.mkdirSync(EVIDENCE_DIR, { recursive: true })
  fs.writeFileSync(REPORT, JSON.stringify(log, null, 2))
})

describe.skipIf(!SEED_FILE)('TK Fresh Choice (staging copy): POS change -> app, no manual step', () => {
  const ids: Record<string, string> = {}

  it.skipIf(FINAL)('BEFORE: the three TK products are Rs 0 and out of stock in the app', async () => {
    ids.milk = pid('PRD-010'); ids.aval = pid('PRD-027')
    log.before = { milk: await card(ids.milk), aval: await card(ids.aval) }
    expect(log.before.milk?.in_stock).toBe(false)
  })

  it.skipIf(FINAL)('SYNC-01 price + stock + detail + photo set in the POS reach the app after one POS sync', async () => {
    const t0 = Date.now()
    const photo = await upload('milk-powder.jpg')
    await edit(ids.milk, { selling_price: 1250, cost_price: 1100, name: 'Anchor Milk Powder 400g (STG-TEST)', short_description: 'Full cream milk powder, 400g pack', image_url: photo })
    await setStock(ids.milk, 24, 'TK POS->app proof')
    await pos.sync()
    const c = await card(ids.milk)
    log.milk = { ms: Date.now() - t0, card: c }
    expect(c.price).toBe(1250)
    expect(c.in_stock).toBe(true)
    expect(c.available_qty).toBe(24)
    expect(c.name).toBe('Anchor Milk Powder 400g (STG-TEST)')
    expect(c.short_description).toBe('Full cream milk powder, 400g pack')
    expect(c.thumbnail_url).toBeTruthy()
    // card image: the 300px thumbnail path answers with a real image
    const th = await fetch(c.thumbnail_url)
    log.milk.thumbnail = { url: c.thumbnail_url, status: th.status, type: th.headers.get('content-type'), bytes: (await th.arrayBuffer()).byteLength }
    expect(th.status).toBe(200); expect(String(log.milk.thumbnail.type)).toMatch(/^image\//)
    // product page: gallery thumb + medium (800px) from the same upload
    const d = (await api.get(`/catalog/products/${ids.milk}`, { token })).json
    log.milk.gallery = d.gallery
    expect(d.gallery?.length).toBeGreaterThan(0)
    const med = await fetch(d.gallery[0].medium)
    expect(med.status).toBe(200); expect(String(med.headers.get('content-type'))).toMatch(/^image\//)
  }, 300_000)

  it.skipIf(FINAL)('SYNC-02 a LATER edit (price, stock, detail) also flows on the next sync', async () => {
    await edit(ids.milk, { selling_price: 1325, short_description: 'Full cream milk powder, 400g pack (new price)' })
    await setStock(ids.milk, 5, 'TK POS->app proof: stock drop')
    await pos.sync()
    const c = await card(ids.milk)
    log.milk_update = c
    expect(c.price).toBe(1325); expect(c.available_qty).toBe(5); expect(c.short_description).toMatch(/new price/)
    await setStock(ids.milk, 0, 'TK POS->app proof: sold out')
    await pos.sync()
    const o = await card(ids.milk)
    log.milk_sold_out = o
    expect(o.in_stock).toBe(false)
  }, 300_000)

  it.skipIf(FINAL)('SYNC-03 weight item (kg): unit, sale_by, decimal stock, price per kg + photo', async () => {
    const id = pid('PRD-001'); ids.rice = id
    const photo = await upload('kuttha-rice.jpg')
    await edit(id, { selling_price: 215, cost_price: 190, sale_by: 'weight', unit: 'kg', image_url: photo })
    await setStock(id, 50.5, 'TK POS->app proof')
    await pos.sync()
    const c = await card(id)
    log.rice = c
    expect(c.sale_by).toBe('weight'); expect(c.unit).toBe('kg'); expect(c.price).toBe(215); expect(c.available_qty).toBe(50.5); expect(c.in_stock).toBe(true)
    expect(c.thumbnail_url).toBeTruthy()
  }, 300_000)

  it.skipIf(FINAL)('SYNC-04 L / ml / pack units: the unit text reaches the app (price shown is per item)', async () => {
    const mk = async (name: string, sku: string, unit: string, price: number, stock: number, img: string) => {
      const r = await ipc('products:create', { name, sku, selling_price: price, cost_price: Math.round(price * 0.8), unit, min_stock_level: 2 })
      expect(r.success, JSON.stringify(r)).toBe(true)
      const id = r.data.id as string
      await edit(id, { image_url: await upload(img) })
      await setStock(id, stock, 'TK POS->app proof')
      return id
    }
    ids.oil = await mk('Coconut Oil (STG-TEST)', 'STG-OIL-1L', 'L', 750, 30, 'oil.jpg')
    ids.essence = await mk('Vanilla Essence (STG-TEST)', 'STG-ESS-100ML', 'ml', 220, 12, 'soya.jpg')
    ids.pack = await mk('Biscuit Family Pack (STG-TEST)', 'STG-BIS-PACK', 'pack', 380, 40, 'biscuits.jpg')
    await pos.sync()
    const got = { oil: await card(ids.oil), essence: await card(ids.essence), pack: await card(ids.pack) }
    log.units = got
    expect(got.oil.unit).toBe('L'); expect(got.oil.price).toBe(750); expect(got.oil.in_stock).toBe(true)
    expect(got.essence.unit).toBe('ml'); expect(got.pack.unit).toBe('pack')
    for (const c of Object.values(got)) expect(c.thumbnail_url).toBeTruthy()
  }, 300_000)

  it.runIf(FINAL)('SYNC-05 leave the milk powder in stock (18) for the phone screenshots', async () => {
    const id = pid('PRD-010')
    await setStock(id, 18, 'TK POS->app proof: back in stock')
    await pos.sync()
    const c = await card(id)
    expect(c.in_stock).toBe(true); expect(c.available_qty).toBe(18)
  }, 300_000)
})
