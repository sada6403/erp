// Convert-app-order-to-invoice integration tests (locked prices, idempotency,
// FIFO + profit, short stock, price-override rules). Same harness as
// security-fixes.integration.test.ts; run via `npm run test:integration`.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import bcrypt from 'bcryptjs'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-order-qa-'))

// registry is shared between the mocked 'electron' module's ipcMain (used by
// files like batches.ts that import ipcMain directly at module scope) and
// the fakeIpcMain object passed explicitly to handlers that take ipcMain as
// a parameter (products.ts, purchases.ts, orders.ts, chits.ts,
// commissions.ts) — both paths must land in the same map or `call()` won't
// find handlers registered via the direct-import style.
const hoisted = vi.hoisted(() => ({
  registry: new Map<string, (...args: unknown[]) => unknown>(),
  openedUrls: [] as string[],
}))

vi.mock('electron', () => {
  return {
    app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) },
      on: () => {},
    },
    dialog: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true, filePath: undefined }),
    },
    net: { request: () => ({ on: () => {}, write: () => {}, end: () => {}, setHeader: () => {} }) },
    safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
    BrowserWindow: class {},
    shell: { openExternal: async (url: string) => { hoisted.openedUrls.push(url) } },
    protocol: { registerFileProtocol: () => {}, handle: () => {} },
    Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
  }
})

const sharedStoreData: Record<string, unknown> = {}
vi.mock('electron-store', () => {
  class FakeStore {
    get(key: string, def?: unknown) { return key in sharedStoreData ? sharedStoreData[key] : def }
    set(key: string, val: unknown) { sharedStoreData[key] = val }
    delete(key: string) { delete sharedStoreData[key] }
  }
  return { default: FakeStore }
})

const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) },
  on: () => {},
} as unknown as import('electron').IpcMain

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

function setSession(session: Record<string, unknown> | null) {
  sharedStoreData.auth_user = session
}

function makeSession(opts: { id: string; branchId?: string | null; permissions: Record<string, unknown> }) {
  return {
    id: opts.id, name: opts.id, branch_id: opts.branchId ?? null,
    role: { permissions: opts.permissions },
    scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
  }
}

let db: import('better-sqlite3').Database

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()

  const { registerBatchHandlers } = await import('../ipc/batches')
  const { registerProductHandlers } = await import('../ipc/products')
  const { registerPurchaseHandlers } = await import('../ipc/purchases')
  const { registerStockHandlers } = await import('../ipc/stocks')
  const { registerOrderHandlers } = await import('../ipc/orders')
  const { registerChitHandlers } = await import('../ipc/chits')
  const { registerCommissionHandlers } = await import('../ipc/commissions')
  const { registerAgentHandlers } = await import('../ipc/agents')
  const { registerAdminHandlers } = await import('../ipc/admin')
  const { registerRegionHandlers } = await import('../ipc/regions')
  const { registerAuthHandlers } = await import('../ipc/auth')
  const { registerInvoiceHandlers } = await import('../ipc/invoices')
  const { registerReturnHandlers } = await import('../ipc/returns')
  const { registerBranchTransferHandlers } = await import('../ipc/branchTransfers')
  const { registerNotificationHandlers } = await import('../ipc/notifications')
  registerBatchHandlers()
  registerProductHandlers(fakeIpcMain)
  registerPurchaseHandlers(fakeIpcMain)
  registerStockHandlers(fakeIpcMain)
  registerOrderHandlers(fakeIpcMain)
  registerChitHandlers(fakeIpcMain)
  registerCommissionHandlers(fakeIpcMain)
  registerAgentHandlers(fakeIpcMain)
  registerAdminHandlers(fakeIpcMain)
  registerRegionHandlers(fakeIpcMain)
  registerAuthHandlers(fakeIpcMain)
  registerInvoiceHandlers(fakeIpcMain)
  registerReturnHandlers()
  registerBranchTransferHandlers(fakeIpcMain)
  registerNotificationHandlers()
})

function seedBranch(id: string, name: string, code: string) {
  db.prepare(`INSERT OR IGNORE INTO branches (id, name, code, address, phone, is_active) VALUES (?,?,?,?,?,1)`)
    .run(id, name, code, 'addr', '0000000000')
}
function seedRole(id: string, name: string) {
  db.prepare(`INSERT OR IGNORE INTO roles (id, name) VALUES (?,?)`).run(id, name)
}
function seedUser(id: string, branchId: string | null) {
  seedRole('qa-sec-role', 'QA Security Role')
  db.prepare(`INSERT OR IGNORE INTO users (id, branch_id, role_id, name, email, password_hash) VALUES (?,?,?,?,?,'x')`)
    .run(id, branchId, 'qa-sec-role', id, `${id}@qa.test`)
}
function seedProduct(id: string, price: number) {
  db.prepare(`INSERT OR IGNORE INTO products (id, category_id, supplier_id, sku, name, unit, cost_price, selling_price, tax_rate, branch_id) VALUES (?,NULL,NULL,?,?,'pcs',?,?,0,NULL)`)
    .run(id, id, id, price * 0.7, price)
}
function seedSupplier(id: string) {
  db.prepare(`INSERT OR IGNORE INTO suppliers (id, name) VALUES (?,?)`).run(id, id)
}


const BR = 'ao-branch'
const ADMIN = makeSession({ id: 'u-ao-admin', permissions: { all: true } })
const CASHIER = makeSession({ id: 'u-ao-cashier', branchId: BR, permissions: { pos: true } })

function seedBase() {
  seedBranch(BR, 'AO Branch', 'AOB')
  seedUser('u-ao-admin', null)
  seedUser('u-ao-cashier', BR)
  db.prepare(`INSERT OR IGNORE INTO customers (id, name, phone) VALUES ('ao-cust','AO Customer','0770000001')`).run()
}
function seedStockedProduct(id: string, price: number, batches: { qty: number; cost: number; date: string }[]) {
  seedProduct(id, price)
  const total = batches.reduce((s, b) => s + b.qty, 0)
  db.prepare(`INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)`).run(`st-${id}`, id, BR, total)
  batches.forEach((b, i) => db.prepare(`INSERT INTO product_batches (id,product_id,branch_id,batch_number,quantity,original_quantity,cost_price,purchase_date,historical_cost_known,status)
    VALUES (?,?,?,?,?,?,?,?,1,'available')`).run(`bt-${id}-${i}`, id, BR, `B${i}`, b.qty, b.qty, b.cost, b.date))
}
function seedAppOrder(id: string, productId: string, qty: number, lockedPrice: number, extra: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO customer_orders (id,order_number,branch_id,customer_id,customer_name,status,payment_status,total_amount,channel,payment_method)
    VALUES (?,?,?,?,?,?,?,?,'app',?)`).run(id, `ORD-${id}`, BR, 'ao-cust', 'AO Customer', extra.status ?? 'confirmed', extra.payment_status ?? 'unpaid', qty * lockedPrice, extra.payment_method ?? 'cod')
  db.prepare(`INSERT INTO customer_order_items (id,order_id,product_id,quantity,unit_price,line_total) VALUES (?,?,?,?,?,?)`)
    .run(`${id}-i1`, id, productId, qty, lockedPrice, qty * lockedPrice)
}

describe('Convert app order to invoice', () => {
  beforeAll(() => { seedBase(); setSession(ADMIN) })
  const stockOf = (p: string) => (db.prepare('SELECT quantity q FROM stocks WHERE product_id=? AND branch_id=?').get(p, BR) as { q: number }).q

  it('uses the locked order price even if the product price changed, allocates FIFO and records correct profit', async () => {
    sharedStoreData.app_settings = { business_type: 'supermarket' }
    seedStockedProduct('ao-p1', 100, [{ qty: 4, cost: 60, date: '2026-01-01' }, { qty: 6, cost: 80, date: '2026-02-01' }])
    seedAppOrder('ao-o1', 'ao-p1', 6, 90)
    db.prepare(`UPDATE products SET selling_price=120 WHERE id='ao-p1'`).run() // price moved after the order

    const res = await call('orders:convertToInvoice', 'ao-o1')
    expect(res.success).toBe(true)
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(res.data.id) as any
    const item = db.prepare('SELECT * FROM invoice_items WHERE invoice_id=?').get(res.data.id) as any
    expect(item.unit_price).toBe(90)
    expect(inv.total_amount).toBe(540)
    expect(inv.due_amount).toBe(540) // COD: due until collected
    expect(stockOf('ao-p1')).toBe(4)

    const allocs = db.prepare('SELECT * FROM sale_batch_allocations WHERE invoice_id=? ORDER BY unit_cost').all(res.data.id) as any[]
    expect(allocs.map(a => [a.quantity, a.unit_cost])).toEqual([[4, 60], [2, 80]])
    const cost = allocs.reduce((s, a) => s + a.quantity * a.unit_cost, 0)
    expect(540 - cost).toBe(140) // profit

    const order = db.prepare('SELECT * FROM customer_orders WHERE id=?').get('ao-o1') as any
    expect(order.invoice_id).toBe(res.data.id)
    expect(inv.source_order_id).toBe('ao-o1')
    expect(order.status).toBe('ready_for_delivery')
  })

  it('creates exactly one invoice on a double click', async () => {
    sharedStoreData.app_settings = {}
    seedStockedProduct('ao-p2', 50, [{ qty: 10, cost: 30, date: '2026-01-01' }])
    seedAppOrder('ao-o2', 'ao-p2', 2, 45)
    const [a, b] = await Promise.all([call('orders:convertToInvoice', 'ao-o2'), call('orders:convertToInvoice', 'ao-o2')])
    expect(a.success && b.success).toBe(true)
    expect(a.data.id).toBe(b.data.id)
    expect([a.data.already_existed, b.data.already_existed].sort()).toEqual([false, true])
    expect((db.prepare('SELECT COUNT(*) c FROM invoices WHERE source_order_id=?').get('ao-o2') as any).c).toBe(1)
    expect(stockOf('ao-p2')).toBe(8)
  })

  it('blocks conversion when stock is short and leaves nothing behind', async () => {
    sharedStoreData.app_settings = { business_type: 'supermarket' }
    seedStockedProduct('ao-p3', 10, [{ qty: 1, cost: 5, date: '2026-01-01' }])
    seedAppOrder('ao-o3', 'ao-p3', 3, 10)
    const res = await call('orders:convertToInvoice', 'ao-o3')
    expect(res.success).toBe(false)
    expect(res.error).toMatch(/Not enough stock/)
    expect((db.prepare('SELECT COUNT(*) c FROM invoices WHERE source_order_id=?').get('ao-o3') as any).c).toBe(0)
    expect(stockOf('ao-p3')).toBe(1)
    expect((db.prepare('SELECT invoice_id FROM customer_orders WHERE id=?').get('ao-o3') as any).invoice_id).toBeNull()
  })

  it('refuses non-app orders and unconfirmed orders', async () => {
    sharedStoreData.app_settings = {}
    seedStockedProduct('ao-p4', 10, [{ qty: 5, cost: 5, date: '2026-01-01' }])
    seedAppOrder('ao-o4', 'ao-p4', 1, 10, { status: 'pending' })
    expect((await call('orders:convertToInvoice', 'ao-o4')).success).toBe(false)
    seedAppOrder('ao-o5', 'ao-p4', 1, 10)
    db.prepare(`UPDATE customer_orders SET channel='pos' WHERE id='ao-o5'`).run()
    expect((await call('orders:convertToInvoice', 'ao-o5')).error).toMatch(/Only app orders/)
  })

  it('price change needs a price-edit role, a reason, and writes an audit row', async () => {
    sharedStoreData.app_settings = {}
    seedStockedProduct('ao-p6', 100, [{ qty: 10, cost: 50, date: '2026-01-01' }])
    seedAppOrder('ao-o6', 'ao-p6', 1, 100)
    const change = [{ item_id: 'ao-o6-i1', unit_price: 80 }]

    setSession(CASHIER)
    expect((await call('orders:convertToInvoice', 'ao-o6', { price_overrides: change, reason: 'goodwill' })).error).toMatch(/price-edit/)
    setSession(ADMIN)
    expect((await call('orders:convertToInvoice', 'ao-o6', { price_overrides: change })).error).toMatch(/reason/)

    const ok = await call('orders:convertToInvoice', 'ao-o6', { price_overrides: change, reason: 'goodwill discount' })
    expect(ok.success).toBe(true)
    expect((db.prepare('SELECT unit_price p FROM invoice_items WHERE invoice_id=?').get(ok.data.id) as any).p).toBe(80)
    const audit = db.prepare(`SELECT * FROM audit_logs WHERE action='APP_ORDER_PRICE_OVERRIDE' AND record_id=?`).get(ok.data.id) as any
    expect(audit).toBeTruthy()
    expect(String(audit.new_values)).toContain('goodwill discount')
  })

  it('bank-slip order verified as paid is invoiced as paid; later "paid" settles a COD invoice', async () => {
    sharedStoreData.app_settings = {}
    seedStockedProduct('ao-p7', 100, [{ qty: 10, cost: 50, date: '2026-01-01' }])
    seedAppOrder('ao-o7', 'ao-p7', 1, 100, { payment_status: 'paid', payment_method: 'bank_transfer' })
    const paid = await call('orders:convertToInvoice', 'ao-o7')
    const inv = db.prepare('SELECT * FROM invoices WHERE id=?').get(paid.data.id) as any
    expect([inv.paid_amount, inv.due_amount]).toEqual([100, 0])
    expect((db.prepare('SELECT method FROM payments WHERE invoice_id=?').get(paid.data.id) as any).method).toBe('bank_transfer')

    seedAppOrder('ao-o8', 'ao-p7', 1, 100)
    const cod = await call('orders:convertToInvoice', 'ao-o8')
    expect((db.prepare('SELECT due_amount d FROM invoices WHERE id=?').get(cod.data.id) as any).d).toBe(100)
    await call('orders:updateStatus', 'ao-o8', 'delivered', { payment_status: 'paid' })
    const after = db.prepare('SELECT paid_amount p, due_amount d FROM invoices WHERE id=?').get(cod.data.id) as any
    expect([after.p, after.d]).toEqual([100, 0])
  })
})
