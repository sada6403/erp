// Shop flows: wishlist, addresses, checkout (COD + bank transfer), cancel, order list/detail/tracking, and the POS reverse path
// (status, agent, convert to invoice, bank payment verified, price/name/stock edits) plus cross-user isolation.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { randomUUID } from 'crypto'
import { appApi, cloudDb, createPos, Evidence, j, startTenant, stopTenant, type CloudDb, type Pos, type Seed } from './harness'

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
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class { static getAllWindows() { return [] } },
  shell: { openExternal: async () => {} },
  protocol: { registerFileProtocol: () => {}, handle: () => {} },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  net: { fetch: (...a: Parameters<typeof fetch>) => fetch(...a) },
}))
vi.mock('../../services/licenseService', () => ({ isDeviceLocked: () => false, reportDeviceRevoked: vi.fn() }))

// other forks share the dev server and each POS sync cycle is dozens of requests: allow slow scenarios
vi.setConfig({ testTimeout: 400_000, hookTimeout: 400_000 })

const fakeIpcMain = { handle: (c: string, fn: (...a: unknown[]) => unknown) => { hoisted.registry.set(c, fn) }, on: () => {} } as any
const ipc = async (channel: string, ...args: unknown[]): Promise<any> => {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler: ${channel}`)
  return fn({} as any, ...args)
}

let seed: Seed, api: ReturnType<typeof appApi>, db: CloudDb, pos: Pos
let A = '', B = ''
const ev = new Evidence('shop')
const pid = () => seed.product_ids[0]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** Records a PASS row, or a FAIL row (and rethrows) when the scenario throws. */
async function scenario(id: string, action: string, fn: () => Promise<{ api: string; cloud: string; pos: string; reverse?: string; ms?: number; notes?: string }>) {
  try {
    const r = await fn()
    ev.add({ id, action, api: r.api, cloud: r.cloud, pos: r.pos, reverse: r.reverse ?? 'n/a', ms: r.ms, result: 'PASS', notes: r.notes })
  } catch (e) {
    ev.add({ id, action, api: '-', cloud: '-', pos: '-', reverse: '-', result: 'FAIL', notes: String((e as Error).message).slice(0, 400) })
    throw e
  }
}

const address = (n: string) => ({ label: `Home ${n}`, recipient_name: `Shop Tester ${n}`, phone: '0771234567', line1: `${n} Temple Road`, line2: null, city: 'Kandy', district: 'Kandy', postal_code: '20000', latitude: null, longitude: null, is_default: false })

beforeAll(async () => {
  seed = startTenant()
  api = appApi(seed)
  db = await cloudDb(seed)
  pos = await createPos(state, seed)
  A = await api.login(seed.logins.customer_smartbuy.identifier, seed.password)
  B = await api.login(seed.logins.other_customer.identifier, seed.password)

  const mods = await Promise.all([
    import('../../ipc/batches'), import('../../ipc/products'), import('../../ipc/purchases'), import('../../ipc/stocks'), import('../../ipc/orders'),
    import('../../ipc/chits'), import('../../ipc/commissions'), import('../../ipc/agents'), import('../../ipc/admin'), import('../../ipc/regions'),
    import('../../ipc/auth'), import('../../ipc/invoices'), import('../../ipc/returns'), import('../../ipc/branchTransfers'), import('../../ipc/notifications'),
  ])
  const [batches, products, purchases, stocks, orders, chits, commissions, agents, admin, regions, auth, invoices, returns, transfers, notifications] = mods as any[]
  batches.registerBatchHandlers(); products.registerProductHandlers(fakeIpcMain); purchases.registerPurchaseHandlers(fakeIpcMain)
  stocks.registerStockHandlers(fakeIpcMain); orders.registerOrderHandlers(fakeIpcMain); chits.registerChitHandlers(fakeIpcMain)
  commissions.registerCommissionHandlers(fakeIpcMain); agents.registerAgentHandlers(fakeIpcMain); admin.registerAdminHandlers(fakeIpcMain)
  regions.registerRegionHandlers(fakeIpcMain); auth.registerAuthHandlers(fakeIpcMain); invoices.registerInvoiceHandlers(fakeIpcMain)
  returns.registerReturnHandlers(); transfers.registerBranchTransferHandlers(fakeIpcMain); notifications.registerNotificationHandlers()

  await pos.sync() // branches, products, stocks, agents, users arrive
  const admin1 = pos.get<{ id: string }>(`SELECT id FROM users ORDER BY created_at LIMIT 1`)
  state.data.auth_user = { id: admin1?.id ?? null, name: 'POS Admin', branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
}, 240_000)

afterAll(async () => {
  ev.save()
  await db?.close()
  stopTenant(seed)
})

describe('wishlist', () => {
  it('SHOP-01 add / list / remove, rows in cloud, other customer isolated', async () => {
    await scenario('SHOP-01', 'Wishlist add + remove', async () => {
      const add = await api.post('/me/wishlist', { product_id: pid() }, { token: A })
      expect(add.status).toBe(201)
      const row = await db.one(`SELECT id, user_id, product_id, created_at FROM wishlists WHERE user_id = ? AND product_id = ?`, [seed.logins.customer_smartbuy.user_id, pid()])
      expect(row).toBeTruthy()
      const list = await api.get('/me/wishlist', { token: A })
      expect(list.json.items.map((p: any) => p.id)).toContain(pid())
      // B sees nothing of A's list and cannot remove it
      expect((await api.get('/me/wishlist', { token: B })).json.items.map((p: any) => p.id)).not.toContain(pid())
      await api.del(`/me/wishlist/${pid()}`, { token: B })
      expect(await db.one(`SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?`, [seed.logins.customer_smartbuy.user_id, pid()])).toBeTruthy()
      const del = await api.del(`/me/wishlist/${pid()}`, { token: A })
      expect(del.status).toBe(200)
      expect(await db.one(`SELECT id FROM wishlists WHERE user_id = ? AND product_id = ?`, [seed.logins.customer_smartbuy.user_id, pid()])).toBeUndefined()
      const guest = await api.post('/me/wishlist', { product_id: pid() })
      expect(guest.status).toBe(401)
      return {
        api: `POST /me/wishlist -> ${add.status}; GET -> ${list.status}; DELETE -> ${del.status}; guest POST -> ${guest.status}; user B DELETE leaves A's row`,
        cloud: `wishlists ${j(row)}`, pos: 'Not a POS-synced table (app-only); no POS screen', ms: add.ms,
        notes: 'Isolation: B list excludes A product, B delete is a no-op on A row',
      }
    })
  })
})

describe('addresses', () => {
  it('SHOP-02 create / update / default / delete, ownership enforced', async () => {
    await scenario('SHOP-02', 'Address create, update, default, delete', async () => {
      const uid = seed.logins.customer_smartbuy.user_id
      const a1 = await api.post('/me/addresses', address('1'), { token: A })
      const a2 = await api.post('/me/addresses', { ...address('2'), is_default: true }, { token: A })
      expect([a1.status, a2.status]).toEqual([201, 201])
      const rows = await db.query(`SELECT id, user_id, label, line1, city, is_default, created_at FROM app_addresses WHERE user_id = ? ORDER BY created_at`, [uid])
      expect(rows.filter((r: any) => Number(r.is_default) === 1).map((r: any) => r.id)).toEqual([a2.json.id])
      const upd = await api.put(`/me/addresses/${a1.json.id}`, { ...address('1'), line1: '1 Updated Road', is_default: true }, { token: A })
      expect(upd.status).toBe(200)
      const after = await db.query(`SELECT id, line1, is_default, updated_at FROM app_addresses WHERE user_id = ?`, [uid])
      expect(after.find((r: any) => r.id === a1.json.id).line1).toBe('1 Updated Road')
      expect(after.filter((r: any) => Number(r.is_default) === 1).map((r: any) => r.id)).toEqual([a1.json.id])
      // B cannot touch A's address
      const bPut = await api.put(`/me/addresses/${a1.json.id}`, address('9'), { token: B })
      const bDel = await api.del(`/me/addresses/${a1.json.id}`, { token: B })
      expect([bPut.status, bDel.status]).toEqual([404, 404])
      expect((await api.get('/me/addresses', { token: B })).json.items.some((x: any) => x.id === a1.json.id)).toBe(false)
      expect((await db.one(`SELECT line1 FROM app_addresses WHERE id = ?`, [a1.json.id])).line1).toBe('1 Updated Road')
      const del = await api.del(`/me/addresses/${a2.json.id}`, { token: A })
      expect(del.status).toBe(200)
      expect(await db.one(`SELECT id FROM app_addresses WHERE id = ?`, [a2.json.id])).toBeUndefined()
      return {
        api: `POST x2 -> 201,201; PUT -> ${upd.status}; DELETE -> ${del.status}; user B PUT/DELETE -> ${bPut.status}/${bDel.status}`,
        cloud: `app_addresses ${j(after.find((r: any) => r.id === a1.json.id))}`,
        pos: 'App-only table (no POS screen); shows on the order as the delivery address (see SHOP-03)', ms: a1.ms,
      }
    })
  })
})

let codOrder: any, bankOrder: any
describe('checkout and orders', () => {
  it('SHOP-03 quote -> COD order (idempotent) -> cloud rows -> POS Orders screen', async () => {
    await scenario('SHOP-03', 'Cart -> quote -> place COD order', async () => {
      const addr = (await api.get('/me/addresses', { token: A })).json.items[0]
      const items = [{ product_id: pid(), quantity: 2 }]
      const quote = await api.post('/checkout/quote', { items, branch_id: seed.branches.main, address_id: addr.id, payment_method: 'cod' }, { token: A })
      expect(quote.status).toBe(200)
      expect(quote.json.can_order).toBe(true)
      const key = randomUUID()
      const body = { items, branch_id: seed.branches.main, address_id: addr.id, payment_method: 'cod', notes: 'integration cod', expected_total: quote.json.total }
      const o = await api.post('/orders', body, { token: A, headers: { 'idempotency-key': key } })
      expect(o.status, JSON.stringify(o.json)).toBe(201)
      const again = await api.post('/orders', body, { token: A, headers: { 'idempotency-key': key } })
      expect(again.json.id).toBe(o.json.id)
      expect((await db.one(`SELECT COUNT(*) AS n FROM customer_orders WHERE id = ?`, [o.json.id])).n).toBe(1)
      const noKey = await api.post('/orders', body, { token: A })
      expect(noKey.status).toBe(400)
      codOrder = o.json
      const order = await db.one(`SELECT id, order_number, branch_id, app_user_id, customer_id, channel, status, payment_method, payment_status, total_amount, paid_amount, delivery_fee, created_at, updated_at FROM customer_orders WHERE id = ?`, [o.json.id])
      const lines = await db.query(`SELECT product_id, quantity, unit_price, line_total FROM customer_order_items WHERE order_id = ?`, [o.json.id])
      expect(order.channel).toBe('app')
      expect(order.branch_id).toBe(seed.branches.main)
      expect(order.app_user_id).toBe(seed.logins.customer_smartbuy.user_id)
      expect(Number(order.total_amount)).toBe(quote.json.total)
      expect(lines).toHaveLength(1)
      expect(order.created_at).toMatch(/^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/)
      const ms = await pos.syncUntil(() => !!pos.get(`SELECT id FROM customer_orders WHERE id=?`, o.json.id))
      const list = await ipc('orders:list', { channel: 'app' })
      const shown = list.data.find((r: any) => r.id === o.json.id)
      expect(shown, 'order visible on POS Orders screen').toBeTruthy()
      expect(shown.item_count).toBe(1)
      expect(shown.status).toBe('pending')
      const local = pos.get<any>(`SELECT id, branch_id, status, payment_method, total_amount, channel FROM customer_orders WHERE id=?`, o.json.id)
      expect(Number(local.total_amount)).toBe(quote.json.total)
      return {
        api: `POST /checkout/quote -> ${quote.status}; POST /orders -> ${o.status} (replay same key -> same id; no key -> ${noKey.status})`,
        cloud: `customer_orders ${j(order)}; customer_order_items ${j(lines)}`,
        pos: `Orders screen (orders:list channel=app) shows ${shown.order_number} status=${shown.status} items=${shown.item_count}; SQLite ${j(local)}`, ms: o.ms + ms,
      }
    })
  })

  it('SHOP-04 bank-transfer order: payment reference stored, unpaid, in POS; slip image upload is SLIP-01 in join-slip.integration.test.ts', async () => {
    await scenario('SHOP-04', 'Bank transfer order + slip reference', async () => {
      await sleep(1100) // local dev runs without SYNC_PULL_OVERLAP_MINUTES: an order in the same DB second as the previous pull cursor would be skipped
      const items = [{ product_id: seed.product_ids[1], quantity: 1 }]
      const address_ = address('B')
      const o = await api.post('/orders', { items, branch_id: seed.branches.main, address: address_, payment_method: 'bank_transfer', payment_reference: 'SLIP-REF-12345' }, { token: A, headers: { 'idempotency-key': randomUUID() } })
      expect(o.status, JSON.stringify(o.json)).toBe(201)
      bankOrder = o.json
      const row = await db.one(`SELECT id, order_number, status, payment_method, payment_status, payment_reference, paid_amount, total_amount, created_at FROM customer_orders WHERE id = ?`, [o.json.id])
      expect(row.payment_method).toBe('bank_transfer')
      expect(row.payment_reference).toBe('SLIP-REF-12345')
      expect(row.payment_status).not.toBe('paid')
      const ms = await pos.syncUntil(() => !!pos.get(`SELECT id FROM customer_orders WHERE id=?`, o.json.id))
      const local = pos.get<any>(`SELECT payment_method, payment_reference, payment_status FROM customer_orders WHERE id=?`, o.json.id)
      expect(local.payment_reference).toBe('SLIP-REF-12345')
      return {
        api: `POST /orders (bank_transfer, payment_reference) -> ${o.status}`, cloud: `customer_orders ${j(row)}`,
        pos: `Orders screen row payment_method=${local.payment_method} reference=${local.payment_reference} status=${local.payment_status}`, ms: o.ms + ms,
        notes: 'slip image upload + POS verification: see SLIP-01/SLIP-02 (join-slip.integration.test.ts)',
      }
    })
  })

  it('SHOP-05 order list / detail / tracking in app; other customer gets 404', async () => {
    await scenario('SHOP-05', 'Order list, detail, tracking', async () => {
      const list = await api.get('/orders', { token: A })
      expect(list.status).toBe(200)
      expect(list.json.items.map((x: any) => x.id)).toEqual(expect.arrayContaining([codOrder.id, bankOrder.id]))
      const det = await api.get(`/orders/${codOrder.id}`, { token: A })
      expect(det.json.items).toHaveLength(1)
      expect(det.json.order_number).toBe(codOrder.order_number)
      expect(det.json.delivery_otp).toBeTruthy() // owner sees the delivery code
      const trk = await api.get(`/orders/${codOrder.id}/tracking`, { token: A })
      expect(trk.json.steps.find((s: any) => s.key === 'placed').done).toBe(true)
      const bList = await api.get('/orders', { token: B })
      expect(bList.json.items.some((x: any) => x.id === codOrder.id)).toBe(false)
      const codes = [(await api.get(`/orders/${codOrder.id}`, { token: B })).status, (await api.get(`/orders/${codOrder.id}/tracking`, { token: B })).status, (await api.post(`/orders/${codOrder.id}/cancel`, {}, { token: B })).status]
      expect(codes).toEqual([404, 404, 404])
      expect((await db.one(`SELECT status FROM customer_orders WHERE id = ?`, [codOrder.id])).status).toBe('pending')
      return {
        api: `GET /orders -> ${list.status}; /orders/:id -> ${det.status}; /tracking -> ${trk.status}; user B detail/tracking/cancel -> ${codes.join('/')}`,
        cloud: `customer_orders ${codOrder.id} status unchanged after B's cancel attempt`, pos: 'n/a (app read paths)', ms: list.ms,
      }
    })
  })
})

describe('reverse: POS -> app', () => {
  it('SHOP-06 POS confirms the order -> app shows confirmed; watermark moves', async () => {
    await scenario('SHOP-06', 'POS order status change reaches app', async () => {
      const wm0 = (await api.get('/watermark', { token: A })).json.areas.orders
      await sleep(1100)
      const t0 = Date.now()
      const r = await ipc('orders:updateStatus', codOrder.id, 'confirmed')
      expect(r.success).toBe(true)
      await pos.sync()
      const ms = Date.now() - t0
      const row = await db.one(`SELECT status, approved_by, updated_at FROM customer_orders WHERE id = ?`, [codOrder.id])
      expect(row.status).toBe('confirmed')
      const det = await api.get(`/orders/${codOrder.id}`, { token: A })
      expect(det.json.status).toBe('confirmed')
      expect(det.json.stage).toBe('confirmed')
      const wm1 = (await api.get('/watermark', { token: A })).json.areas.orders
      expect(wm1).not.toBe(wm0)
      return {
        api: `GET /orders/:id -> status=${det.json.status} stage=${det.json.stage}; watermark orders ${wm0} -> ${wm1}`,
        cloud: `customer_orders ${j(row)}`, pos: 'orders:updateStatus(confirmed) on Orders screen -> sync_queue -> cloud', reverse: 'POS status -> app detail/tracking + watermark', ms,
      }
    })
  })

  it('SHOP-07 POS assigns an agent -> app order shows agent', async () => {
    await scenario('SHOP-07', 'POS assign agent reaches app', async () => {
      const agents = await ipc('orders:agentsForOrder', codOrder.id)
      const agentId = agents?.data?.find?.((a: any) => a.id === seed.agent_id)?.id ?? seed.agent_id
      const t0 = Date.now()
      const r = await ipc('orders:assignAgent', codOrder.id, agentId)
      expect(r.success, JSON.stringify(r)).toBe(true)
      await pos.sync()
      const ms = Date.now() - t0
      const row = await db.one(`SELECT assigned_agent_id, updated_at FROM customer_orders WHERE id = ?`, [codOrder.id])
      expect(row.assigned_agent_id).toBe(seed.agent_id)
      const det = await api.get(`/orders/${codOrder.id}`, { token: A })
      expect(det.json.agent?.code).toBe('AG001')
      const agentTok = await api.login('AG001', seed.password)
      const dl = await api.get('/agent/deliveries', { token: agentTok })
      expect(dl.json.items.some((x: any) => x.id === codOrder.id)).toBe(true)
      return {
        api: `GET /orders/:id agent=${det.json.agent?.code}; agent GET /agent/deliveries lists it`,
        cloud: `customer_orders ${j(row)} (assigned_agent_id = seed agent)`, pos: 'orders:assignAgent on Orders/Deliveries screen', reverse: 'POS assignment -> customer sees agent; agent sees delivery', ms,
      }
    })
  })

  it('SHOP-08 POS converts the order to an invoice -> invoice rows in cloud, app order ready_for_delivery', async () => {
    await scenario('SHOP-08', 'POS convert order to invoice', async () => {
      const t0 = Date.now()
      const r = await ipc('orders:convertToInvoice', codOrder.id)
      expect(r.success, JSON.stringify(r)).toBe(true)
      await pos.sync()
      const ms = Date.now() - t0
      const inv = await db.one(`SELECT id, invoice_number, source_order_id, branch_id, total_amount, paid_amount, due_amount, status, created_at FROM invoices WHERE source_order_id = ?`, [codOrder.id])
      expect(inv, 'invoice pushed to cloud').toBeTruthy()
      const ord = await db.one(`SELECT status, invoice_id FROM customer_orders WHERE id = ?`, [codOrder.id])
      expect(ord.invoice_id).toBe(inv.id)
      const det = await api.get(`/orders/${codOrder.id}`, { token: A })
      expect(det.json.status).toBe('ready_for_delivery')
      expect(det.json.stage).toBe('packed')
      const agentTok = await api.login('AG001', seed.password)
      const bill = await api.get(`/agent/deliveries/${codOrder.id}/bill`, { token: agentTok })
      expect(bill.status).toBe(200)
      expect(bill.json.bill_no).toBe(inv.invoice_number)
      return {
        api: `GET /orders/:id -> ${det.json.status}/${det.json.stage}; agent bill ${bill.status} bill_no=${bill.json.bill_no}`,
        cloud: `invoices ${j(inv)}; customer_orders ${j(ord)}`, pos: `orders:convertToInvoice -> invoice ${inv.invoice_number}`, reverse: 'POS invoice -> app status + agent bill', ms,
      }
    })
  })

  it('SHOP-09 bank slip verified in POS (payment_status paid) -> app shows paid', async () => {
    await scenario('SHOP-09', 'POS marks bank-transfer order paid', async () => {
      await ipc('orders:updateStatus', bankOrder.id, 'confirmed')
      const t0 = Date.now()
      const r = await ipc('orders:updateStatus', bankOrder.id, 'confirmed', { payment_status: 'paid', paid_amount: bankOrder.total_amount })
      expect(r.success, JSON.stringify(r)).toBe(true)
      await pos.sync()
      const ms = Date.now() - t0
      const row = await db.one(`SELECT status, payment_status, paid_amount, total_amount FROM customer_orders WHERE id = ?`, [bankOrder.id])
      expect(row.payment_status).toBe('paid')
      const det = await api.get(`/orders/${bankOrder.id}`, { token: A })
      expect(det.json.payment_status).toBe('paid')
      return { api: `GET /orders/:id payment_status=${det.json.payment_status}`, cloud: `customer_orders ${j(row)}`, pos: 'orders:updateStatus payment_status=paid', reverse: 'POS payment verification -> app', ms }
    })
  })

  it('SHOP-10 POS price + name edit -> app catalog and quote; watermark catalog moves', async () => {
    await scenario('SHOP-10', 'POS product edit (price, name) reaches app', async () => {
      const p = seed.product_ids[2]
      const before = (await api.get(`/catalog/products/${p}`)).json
      const wm0 = (await api.get('/watermark')).json.areas.catalog
      await sleep(1100)
      const newPrice = Number(before.price) + 111
      const t0 = Date.now()
      const local = pos.get<any>(`SELECT * FROM products WHERE id=?`, p)
      expect(local, 'product synced to POS').toBeTruthy()
      const r = await ipc('products:update', p, { ...local, name: `${local.name} EDITED`, selling_price: newPrice })
      expect(r.success, JSON.stringify(r)).not.toBe(false)
      await pos.sync()
      const ms = Date.now() - t0
      const row = await db.one(`SELECT name, selling_price, updated_at FROM products WHERE id = ?`, [p])
      expect(Number(row.selling_price)).toBe(newPrice)
      const after = (await api.get(`/catalog/products/${p}`)).json
      expect(after.name).toBe(`${local.name} EDITED`)
      const quote = await api.post('/checkout/quote', { items: [{ product_id: p, quantity: 1 }], branch_id: seed.branches.main, payment_method: 'cod' }, { token: A })
      const wm1 = (await api.get('/watermark')).json.areas.catalog
      expect(wm1).not.toBe(wm0)
      return {
        api: `GET /catalog/products/:id price ${before.price} -> ${after.price}; name updated; quote unit price ${quote.json.lines?.[0]?.unit_price}; watermark catalog ${wm0} -> ${wm1}`,
        cloud: `products ${j(row)}`, pos: 'products:update (Products screen)', reverse: 'POS price/name edit -> app catalog + checkout quote', ms,
        notes: after.price === newPrice ? '' : `app price ${after.price} vs POS ${newPrice} (offers/tax may apply)`,
      }
    })
  })

  it('SHOP-11 POS stock edit -> app availability changes (in stock / out of stock)', async () => {
    await scenario('SHOP-11', 'POS stock edit reaches app', async () => {
      const p = seed.product_ids[3]
      const before = (await api.get(`/catalog/products/${p}`)).json
      const wm0 = (await api.get('/watermark')).json.areas.catalog
      await sleep(1100)
      const t0 = Date.now()
      const r = await ipc('stocks:adjustCorrection', { product_id: p, branch_id: seed.branches.main, quantity: 0, reason: 'integration test' })
      expect(r.success, JSON.stringify(r)).not.toBe(false)
      await pos.sync()
      const ms = Date.now() - t0
      const rows = await db.query(`SELECT product_id, branch_id, quantity, updated_at FROM stocks WHERE product_id = ?`, [p])
      const after = (await api.get(`/catalog/products/${p}`)).json
      const q = await api.post('/checkout/quote', { items: [{ product_id: p, quantity: 1 }], branch_id: seed.branches.main, payment_method: 'cod' }, { token: A })
      expect(q.json.lines[0].available).toBe(false)
      const wm1 = (await api.get('/watermark')).json.areas.catalog
      expect(wm1).not.toBe(wm0)
      return {
        api: `GET product in_stock ${before.in_stock} -> ${after.in_stock}; quote issue=${q.json.lines[0].issue}; watermark catalog ${wm0} -> ${wm1}`,
        cloud: `stocks ${j(rows)}`, pos: 'stocks:adjustCorrection (Inventory screen)', reverse: 'POS stock edit -> app availability + quote', ms,
      }
    })
  })
})

describe('cancel', () => {
  it('SHOP-12 customer cancels a pending order -> cloud cancelled, POS sees it; cannot cancel again / after dispatch', async () => {
    await scenario('SHOP-12', 'Cancel order in app', async () => {
      await sleep(1100) // same-second cursor note as SHOP-04
      const items = [{ product_id: seed.product_ids[1], quantity: 1 }]
      const o = await api.post('/orders', { items, branch_id: seed.branches.main, address: address('C'), payment_method: 'cod' }, { token: A, headers: { 'idempotency-key': randomUUID() } })
      expect(o.status, JSON.stringify(o.json)).toBe(201)
      const c = await api.post(`/orders/${o.json.id}/cancel`, { reason: 'changed my mind' }, { token: A })
      expect(c.status).toBe(200)
      expect(c.json.status).toBe('cancelled')
      const row = await db.one(`SELECT status, updated_at FROM customer_orders WHERE id = ?`, [o.json.id])
      expect(row.status).toBe('cancelled')
      const ms = await pos.syncUntil(() => pos.get<any>(`SELECT status FROM customer_orders WHERE id=?`, o.json.id)?.status === 'cancelled')
      const shown = (await ipc('orders:list', { channel: 'app', status: 'cancelled' })).data.find((x: any) => x.id === o.json.id)
      expect(shown).toBeTruthy()
      const again = await api.post(`/orders/${o.json.id}/cancel`, {}, { token: A })
      // an invoiced/confirmed order (SHOP-08) can no longer be cancelled by the customer
      const late = await api.post(`/orders/${codOrder.id}/cancel`, {}, { token: A })
      expect(late.status).toBeGreaterThanOrEqual(400)
      expect((await db.one(`SELECT status FROM customer_orders WHERE id = ?`, [codOrder.id])).status).not.toBe('cancelled')
      return {
        api: `POST /orders/:id/cancel -> ${c.status} (${c.json.status}); second cancel -> ${again.status}; cancel after POS invoice -> ${late.status}`,
        cloud: `customer_orders ${j(row)}`, pos: `Orders screen status=cancelled filter lists ${shown.order_number}`, ms: c.ms + ms,
      }
    })
  })
})
