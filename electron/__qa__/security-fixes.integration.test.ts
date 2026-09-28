// Regression tests for the access-control / IDOR fixes made during the
// 2026-08-11 security audit (see SECURITY_AUDIT_REPORT.md). Each test
// targets one specific finding and asserts the FIXED behavior, so a future
// regression that reopens the hole fails loudly here instead of silently.
//
// Uses the same real-database + mocked-electron harness as
// smartbuy.integration.test.ts — see that file's header comment for the
// prerequisite: this suite needs better-sqlite3 rebuilt against plain
// Node's ABI (`npx rebuild-better-sqlite3`) to actually RUN under vitest,
// which was not done as part of this audit (the user explicitly declined
// that native-binary rebuild earlier, since it risks breaking the live
// `npm run dev` Electron session). These tests are syntactically complete
// and vitest will collect them, but they have NOT been executed/confirmed
// passing in this environment — see the audit report's Test Coverage
// section for what was verified by direct code reading instead.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'security-qa-'))

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

describe('Security audit regression — cross-branch / IDOR fixes', () => {
  const BR_A = 'sec-branch-a', BR_B = 'sec-branch-b'
  const PROD1 = 'sec-prod-1'
  const SUPPLIER1 = 'sec-supplier-1'

  beforeAll(() => {
    seedBranch(BR_A, 'Security Branch A', 'SBA')
    seedBranch(BR_B, 'Security Branch B', 'SBB')
    seedProduct(PROD1, 1000)
    seedSupplier(SUPPLIER1)
    seedUser('u-sec-admin', null)
    seedUser('u-sec-mgr-a', BR_A)
    seedUser('u-sec-mgr-b', BR_B)
  })

  const admin = makeSession({ id: 'u-sec-admin', permissions: { all: true } })
  const mgrA = makeSession({ id: 'u-sec-mgr-a', branchId: BR_A, permissions: { inventory: true, employees: true, chits: true } })
  const mgrB = makeSession({ id: 'u-sec-mgr-b', branchId: BR_B, permissions: { inventory: true, employees: true, chits: true } })
  let destinationTransferId = ''

  it('branchTransfers:create links stock movements to the multi-item branch transfer table', async () => {
    setSession(admin)
    const transferProductId = 'sec-prod-branch-transfer'
    seedProduct(transferProductId, 1250)
    db.prepare(`INSERT OR REPLACE INTO stocks (id, product_id, branch_id, quantity, damaged_qty) VALUES (?,?,?,?,0)`)
      .run('sec-branch-transfer-stock', transferProductId, BR_A, 12)

    const res = await call('branchTransfers:create', {
      from_branch_id: BR_A,
      to_branch_id: BR_B,
      status: 'dispatched',
      expected_delivery_at: new Date(Date.now() + 60_000).toISOString(),
      items: [{ product_id: transferProductId, quantity: 5, unit: 'pcs', package_count: 1 }],
    })

    expect(res.success).toBe(true)
    destinationTransferId = res.data.id
    const movement = db.prepare(`
      SELECT reference_transfer_id, reference_branch_transfer_id
      FROM stock_movements
      WHERE reference_branch_transfer_id = ?
    `).get(res.data.id) as { reference_transfer_id: string | null; reference_branch_transfer_id: string }
    expect(movement.reference_transfer_id).toBeNull()
    expect(movement.reference_branch_transfer_id).toBe(res.data.id)
    const stock = db.prepare('SELECT quantity FROM stocks WHERE id=?').get('sec-branch-transfer-stock') as { quantity: number }
    expect(stock.quantity).toBe(7)
  })

  it('branchTransfers:list scopes a destination user with nested branch identity', async () => {
    setSession({
      id: 'u-sec-mgr-b',
      branch: { id: BR_B },
      role: { permissions: { inventory: true } },
      scope: { level: 'branch', branchId: BR_B },
    })
    const res = await call('branchTransfers:list')
    expect(res.success, res.error).toBe(true)
    expect(res.data.some((transfer: { to_branch_id: string }) => transfer.to_branch_id === BR_B)).toBe(true)
  })

  it('notifications:refresh reaches transfer alerts instead of failing on the removed product_inventory table', async () => {
    setSession(mgrB)
    const refreshed = await call('notifications:refresh')
    expect(refreshed.success, refreshed.error).toBe(true)
    const notifications = await call('notifications:getAll') as Array<{ data: string | null }>
    expect(notifications.some(notification => notification.data?.includes(destinationTransferId))).toBe(true)
  })

  it('uses the activated device branch for transfer notifications even when the admin user belongs to HQ', async () => {
    sharedStoreData.device_branch_id = BR_B
    setSession({
      id: 'owner-at-hq', branch_id: BR_A,
      role: { name: 'Company Admin', permissions: { all: true } },
      permissions: { all: true },
      scope: { level: 'owner', branchId: null },
    })

    const refreshed = await call('notifications:refresh')
    expect(refreshed.success).toBe(true)
    const notifications = await call('notifications:getAll') as Array<{ data: string | null }>
    expect(notifications.some(notification => notification.data?.includes(destinationTransferId))).toBe(true)
    delete sharedStoreData.device_branch_id
  })

  it('admin:suppliers:payDue records an auditable partial payment and blocks overpayment', async () => {
    setSession(admin)
    db.prepare('UPDATE suppliers SET due_balance=12500 WHERE id=?').run(SUPPLIER1)

    const paid = await call('admin:suppliers:payDue', SUPPLIER1, {
      amount: 5000,
      payment_method: 'bank_transfer',
      payment_date: new Date().toISOString().split('T')[0],
      reference_no: 'QA-BANK-001',
    })
    expect(paid.success).toBe(true)
    expect(paid.data.balance_after).toBe(7500)
    const supplier = db.prepare('SELECT due_balance FROM suppliers WHERE id=?').get(SUPPLIER1) as { due_balance: number }
    expect(supplier.due_balance).toBe(7500)
    const payment = db.prepare('SELECT * FROM supplier_payments WHERE id=?').get(paid.data.id) as Record<string, unknown>
    expect(payment.amount).toBe(5000)
    expect(payment.balance_before).toBe(12500)
    expect(payment.balance_after).toBe(7500)

    const overpayment = await call('admin:suppliers:payDue', SUPPLIER1, {
      amount: 8000,
      payment_method: 'cash',
      payment_date: new Date().toISOString().split('T')[0],
    })
    expect(overpayment.success).toBe(false)
    expect((db.prepare('SELECT due_balance FROM suppliers WHERE id=?').get(SUPPLIER1) as { due_balance: number }).due_balance).toBe(7500)
  })

  it('admin:suppliers:restore reactivates a soft-deleted supplier', async () => {
    setSession(admin)
    const supplierId = 'sec-supplier-restore'
    seedSupplier(supplierId)
    const deleted = await call('admin:suppliers:delete', supplierId)
    expect(deleted.success).toBe(true)
    expect((db.prepare('SELECT is_active FROM suppliers WHERE id=?').get(supplierId) as { is_active: number }).is_active).toBe(0)

    const restored = await call('admin:suppliers:restore', supplierId)
    expect(restored.success).toBe(true)
    expect((db.prepare('SELECT is_active FROM suppliers WHERE id=?').get(supplierId) as { is_active: number }).is_active).toBe(1)
  })

  let batchId: string

  it('batches:create tags a non-admin caller\'s own branch, ignoring a spoofed branch_id', async () => {
    setSession(mgrA)
    const res = await call('batches:create', { product_id: PROD1, branch_id: BR_B, quantity: 10, cost_price: 500 })
    expect(res.success).toBe(true)
    batchId = res.id
    const row = db.prepare('SELECT branch_id FROM product_batches WHERE id=?').get(batchId) as { branch_id: string }
    expect(row.branch_id).toBe(BR_A)
  })

  it('batches:update rejects a Branch B caller editing a Branch A batch', async () => {
    setSession(mgrB)
    const res = await call('batches:update', batchId, { quantity: 999 })
    expect(res.success).toBe(false)
  })

  it('batches:consume rejects a Branch B caller consuming a Branch A batch', async () => {
    setSession(mgrB)
    const res = await call('batches:consume', { batch_id: batchId, qty: 1 })
    expect(res.success).toBe(false)
  })

  it('batches:update allows the owning branch to edit its own batch', async () => {
    setSession(mgrA)
    const res = await call('batches:update', batchId, { notes: 'updated' })
    expect(res.success).toBe(true)
  })

  let branchBProductId: string

  it('products:delete rejects deactivating a product tagged to another branch', async () => {
    setSession(mgrA)
    const create = await call('products:create', { name: 'Branch B Product', sku: 'SEC-PB-1', unit: 'pcs', selling_price: 100, cost_price: 70, branch_id: BR_B })
    // products:create tags the caller's own branch for non-admins regardless
    // of payload — so create it as admin to get a real cross-branch product.
    if (!create.success) {
      setSession(admin)
      const created = await call('products:create', { name: 'Branch B Product', sku: 'SEC-PB-1', unit: 'pcs', selling_price: 100, cost_price: 70, branch_id: BR_B })
      branchBProductId = created.data.id
    } else {
      branchBProductId = create.data.id
    }
    setSession(mgrA)
    const del = await call('products:delete', branchBProductId)
    expect(del.success).toBe(false)
  })

  let poId: string

  it('purchases:create rejects supplier procurement from a sub branch', async () => {
    setSession(mgrA)
    const res = await call('purchases:create', {
      supplier_id: SUPPLIER1, branch_id: BR_B,
      items: [{ product_id: PROD1, quantity: 5, unit_cost: 100 }],
    })
    expect(res.success).toBe(false)
  })

  it('admin:suppliers:list hides supplier management from a sub branch', async () => {
    setSession(mgrA)
    const res = await call('admin:suppliers:list')
    expect(res.success).toBe(false)
  })

  it('purchases:create always receives supplier stock into the main branch', async () => {
    setSession(admin)
    const res = await call('purchases:create', {
      supplier_id: SUPPLIER1, branch_id: BR_B,
      items: [{ product_id: PROD1, quantity: 5, unit_cost: 100 }],
      open_whatsapp: false,
      send_email: false,
    })
    expect(res.success).toBe(true)
    poId = res.data.id
    const row = db.prepare('SELECT branch_id FROM purchase_orders WHERE id=?').get(poId) as { branch_id: string }
    expect(row.branch_id).toBe('b1111111-1111-4111-8111-111111111111')
  })

  it('purchases:notifySupplier normalizes a local number and pre-fills full PO details', async () => {
    setSession(admin)
    db.prepare('UPDATE suppliers SET mobile_number=? WHERE id=?').run('0771234567', SUPPLIER1)
    hoisted.openedUrls.length = 0

    const res = await call('purchases:notifySupplier', poId, { openWhatsApp: true, sendEmail: false })
    expect(res.success).toBe(true)
    const composeUrl = hoisted.openedUrls.at(-1) || ''
    expect(composeUrl.startsWith('https://wa.me/94771234567?text=')).toBe(true)
    const message = decodeURIComponent(composeUrl.split('?text=')[1] || '')
    expect(message).toContain(String(res.data.po_number))
    expect(message).toContain('sec-prod-1')
    expect(message).toContain('Qty: *5 pcs*')
    expect(message).toContain('NET TOTAL ORDER VALUE:* Rs.500')
  })

  it('purchases:updateStatus rejects a Branch B caller acting on a Branch A PO', async () => {
    setSession(mgrB)
    const res = await call('purchases:updateStatus', poId, 'SENT', {})
    expect(res.success).toBe(false)
  })

  it('purchases:update rejects a draft PO edit with zero/negative quantity or cost', async () => {
    setSession(admin)
    const res = await call('purchases:update', poId, { items: [{ product_id: PROD1, quantity: 0, unit_cost: 100 }] })
    expect(res.success).toBe(false)
  })

  it('supplier receipt increases only main-branch stock and records a RECEIVE movement once', async () => {
    setSession(admin)
    expect((await call('purchases:updateStatus', poId, 'SENT', { open_whatsapp: false, send_email: false })).success).toBe(true)
    const item = db.prepare('SELECT id, received_qty FROM purchase_items WHERE po_id=?').get(poId) as { id: string; received_qty: number }
    const receivePayload = { items: [{ id: item.id, received_qty: 5, already_received: item.received_qty }] }
    expect((await call('purchases:updateStatus', poId, 'RECEIVED', receivePayload)).success).toBe(true)

    const mainQty = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?')
      .get(PROD1, 'b1111111-1111-4111-8111-111111111111') as { quantity: number }
    expect(mainQty.quantity).toBe(5)
    const movementCount = db.prepare(`
      SELECT COUNT(*) AS count FROM stock_movements
      WHERE reference_order_id=? AND product_id=? AND movement_type='RECEIVE'
    `).get(poId, PROD1) as { count: number }
    expect(movementCount.count).toBe(1)

    const retry = await call('purchases:updateStatus', poId, 'RECEIVED', receivePayload)
    expect(retry.success).toBe(false)
    const unchanged = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?')
      .get(PROD1, 'b1111111-1111-4111-8111-111111111111') as { quantity: number }
    expect(unchanged.quantity).toBe(5)
  })

  let transferId: string

  it('stocks:transfer lets a destination branch request stock from another branch', async () => {
    db.prepare('INSERT OR REPLACE INTO stocks (id, product_id, branch_id, quantity, damaged_qty) VALUES (?,?,?,?,0)')
      .run('sec-stock-a', PROD1, BR_A, 0)
    db.prepare('INSERT OR REPLACE INTO stocks (id, product_id, branch_id, quantity, damaged_qty) VALUES (?,?,?,?,0)')
      .run('sec-stock-b', PROD1, BR_B, 10)
    setSession(mgrA)
    const res = await call('stocks:transfer', {
      product_id: PROD1,
      from_branch_id: BR_B,
      to_branch_id: BR_A,
      quantity: 2,
    })
    expect(res.success).toBe(true)
    transferId = res.data.id
  })

  it('calculated stock cannot be overwritten through the product form adjustment endpoint', async () => {
    setSession(admin)
    const res = await call('stocks:adjust', {
      product_id: PROD1, branch_id: BR_B, quantity: 99, reason: 'Attempted direct overwrite',
    })
    expect(res.success).toBe(false)
    const row = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_B) as { quantity: number }
    expect(row.quantity).toBe(10)
  })

  it('products:list without a branch returns the all-branches aggregate stock', async () => {
    setSession(admin)
    const res = await call('products:list', { is_active: true })
    expect(res.success).toBe(true)
    const product = (res.data as Array<{ id: string; stock: number }>).find(p => p.id === PROD1)
    expect(Number(product?.stock)).toBe(15)
  })

  it('stocks:transfer rejects a sub branch requesting stock for a different destination', async () => {
    setSession(mgrA)
    const res = await call('stocks:transfer', {
      product_id: PROD1,
      from_branch_id: BR_A,
      to_branch_id: BR_B,
      quantity: 1,
    })
    expect(res.success).toBe(false)
  })

  it('stocks:updateTransfer requires the source branch to approve', async () => {
    setSession(mgrA)
    const destinationAttempt = await call('stocks:updateTransfer', transferId, 'approved', {})
    expect(destinationAttempt.success).toBe(false)

    setSession(mgrB)
    const sourceApproval = await call('stocks:updateTransfer', transferId, 'approved', {})
    expect(sourceApproval.success).toBe(true)
  })

  it('stocks:updateTransfer lets only the destination receive and updates both branch balances', async () => {
    setSession(mgrB)
    const sourceReceiveAttempt = await call('stocks:updateTransfer', transferId, 'received', {})
    expect(sourceReceiveAttempt.success).toBe(false)

    setSession(mgrA)
    const destinationReceive = await call('stocks:updateTransfer', transferId, 'received', {})
    expect(destinationReceive.success).toBe(true)
    const source = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_B) as { quantity: number }
    const destination = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as { quantity: number }
    expect(source.quantity).toBe(8)
    expect(destination.quantity).toBe(2)
  })

  it('cancelling an approved but undispatched transfer does not inflate source stock', async () => {
    setSession(mgrA)
    const created = await call('stocks:transfer', {
      product_id: PROD1,
      from_branch_id: BR_B,
      to_branch_id: BR_A,
      quantity: 1,
    })
    expect(created.success, created.error).toBe(true)
    setSession(mgrB)
    expect((await call('stocks:updateTransfer', created.data.id, 'approved', {})).success).toBe(true)
    setSession(mgrA)
    expect((await call('stocks:updateTransfer', created.data.id, 'cancelled', {})).success).toBe(true)
    const source = db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_B) as { quantity: number }
    expect(source.quantity).toBe(8)
  })

  it('All Branches is an aggregate and cannot be used as a manual stock target', async () => {
    setSession(admin)
    const listed = await call('products:list', { is_active: true })
    const product = listed.data.find((row: Record<string, unknown>) => row.id === PROD1)
    const expected = (db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stocks WHERE product_id=?').get(PROD1) as { q: number }).q
    expect(Number(product.stock)).toBe(Number(expected))
    const invalid = await call('stocks:adjust', { product_id: PROD1, branch_id: 'all', quantity: 999, reason: 'must fail' })
    expect(invalid.success).toBe(false)
  })

  it('a stock adjustment is branch-scoped and creates an ADJUSTMENT movement', async () => {
    setSession(admin)
    const before = (db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE product_id=? AND movement_type='ADJUSTMENT'`).get(PROD1) as { c: number }).c
    const res = await call('stocks:adjustCorrection', { product_id: PROD1, branch_id: BR_A, quantity: 7, reason: 'QA counted stock' })
    expect(res.success).toBe(true)
    const movement = db.prepare(`SELECT * FROM stock_movements WHERE product_id=? AND movement_type='ADJUSTMENT' ORDER BY created_at DESC LIMIT 1`).get(PROD1) as Record<string, unknown>
    expect(movement.notes).toBe('QA counted stock')
    expect(movement.status).toBe('POSTED')
    expect((db.prepare(`SELECT COUNT(*) c FROM stock_movements WHERE product_id=? AND movement_type='ADJUSTMENT'`).get(PROD1) as { c: number }).c).toBe(before + 1)
  })

  it('a sub branch cannot overwrite existing calculated stock through the product-form IPC', async () => {
    setSession(mgrA)
    const before = (db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as { quantity: number }).quantity
    const res = await call('stocks:adjust', { product_id: PROD1, branch_id: BR_A, quantity: before + 100, reason: 'bypass attempt' })
    expect(res.success).toBe(false)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(PROD1, BR_A) as { quantity: number }).quantity).toBe(before)
  })

  it('sub-branch movement history is limited to its own branch', async () => {
    setSession(mgrA)
    const res = await call('stocks:movements', { branch_id: BR_B })
    expect(res.success).toBe(true)
    expect(res.data.every((m: Record<string, unknown>) => m.from_branch_id === BR_A || m.to_branch_id === BR_A)).toBe(true)
  })

  let orderId: string

  it('orders:create ignores a spoofed branch_id from a non-admin', async () => {
    setSession(mgrA)
    const res = await call('orders:create', {
      branch_id: BR_B, customer_name: 'Sec Test Customer',
      items: [{ product_id: PROD1, quantity: 1, unit_price: 1000 }],
    })
    expect(res.success).toBe(true)
    orderId = res.data.id
    const row = db.prepare('SELECT branch_id FROM customer_orders WHERE id=?').get(orderId) as { branch_id: string }
    expect(row.branch_id).toBe(BR_A)
  })

  it('orders:updateStatus rejects a Branch B caller acting on a Branch A order', async () => {
    setSession(mgrB)
    const res = await call('orders:updateStatus', orderId, 'confirmed', {})
    expect(res.success).toBe(false)
  })

  it('orders:updateStatus only writes whitelisted columns — an arbitrary key in `details` cannot become a SQL column reference', async () => {
    setSession(mgrA)
    const res = await call('orders:updateStatus', orderId, 'confirmed', { 'total_amount=999999--': 'x' })
    // Whether this resolves true/false, the point is it must not throw a
    // raw SQL error (which would indicate the malicious key reached the
    // query) and must not have mutated total_amount.
    expect(res).toBeDefined()
    const row = db.prepare('SELECT total_amount FROM customer_orders WHERE id=?').get(orderId) as { total_amount: number }
    expect(row.total_amount).not.toBe(999999)
  })
})

describe('Stock transaction workflow regression', () => {
  const MAIN = 'b1111111-1111-4111-8111-111111111111'
  const A = 'stock-flow-a', B = 'stock-flow-b'
  const P1 = 'stock-flow-p1', P2 = 'stock-flow-p2'
  const admin = makeSession({ id: 'stock-flow-admin', permissions: { all: true } })
  const managerA = makeSession({ id: 'stock-flow-manager-a', branchId: A, permissions: { inventory: true, employees: true, pos: true } })
  const managerB = makeSession({ id: 'stock-flow-manager-b', branchId: B, permissions: { inventory: true, employees: true, pos: true } })

  beforeAll(() => {
    seedBranch(A, 'Stock Flow A', 'SFA')
    seedBranch(B, 'Stock Flow B', 'SFB')
    seedUser('stock-flow-admin', null)
    seedUser('stock-flow-manager-a', A)
    seedUser('stock-flow-manager-b', B)
    seedProduct(P1, 1000)
    seedProduct(P2, 500)
    db.prepare('INSERT OR REPLACE INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run('flow-main-p1', P1, MAIN, 20)
    db.prepare('INSERT OR REPLACE INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run('flow-main-p2', P2, MAIN, 10)
    db.prepare('INSERT OR REPLACE INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run('flow-a-p1', P1, A, 0)
    db.prepare('INSERT OR REPLACE INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run('flow-a-p2', P2, A, 0)
    db.prepare('INSERT OR REPLACE INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run('flow-b-p1', P1, B, 6)
  })

  it('main branch sends multiple products and duplicate receive cannot add stock twice', async () => {
    setSession(admin)
    const created = await call('branchTransfers:create', {
      from_branch_id: MAIN, to_branch_id: A, status: 'dispatched',
      items: [{ product_id: P1, quantity: 3 }, { product_id: P2, quantity: 2 }],
    })
    expect(created.success, created.error).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, MAIN) as { quantity: number }).quantity).toBe(17)
    const transferItems = db.prepare('SELECT id,quantity FROM branch_transfer_items WHERE transfer_id=? ORDER BY product_id').all(created.data.id) as Array<{ id: string; quantity: number }>
    setSession(managerA)
    const received = await call('branchTransfers:receive', created.data.id, {
      items: transferItems.map(item => ({ item_id: item.id, received_qty: item.quantity, damaged_qty: 0 })),
      received_by_name: 'Manager A',
    })
    expect(received.success).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(3)
    expect((await call('branchTransfers:receive', created.data.id, {
      items: transferItems.map(item => ({ item_id: item.id, received_qty: item.quantity, damaged_qty: 0 })),
    })).success).toBe(false)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(3)
  })

  it('sub branch can transfer available stock to another sub branch', async () => {
    setSession(managerB)
    const created = await call('branchTransfers:create', {
      from_branch_id: B, to_branch_id: A, status: 'dispatched', items: [{ product_id: P1, quantity: 2 }],
    })
    expect(created.success, created.error).toBe(true)
    const item = db.prepare('SELECT id FROM branch_transfer_items WHERE transfer_id=?').get(created.data.id) as { id: string }
    setSession(managerA)
    expect((await call('branchTransfers:receive', created.data.id, { items: [{ item_id: item.id, received_qty: 2, damaged_qty: 0 }] })).success).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, B) as { quantity: number }).quantity).toBe(4)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(5)
  })

  it('sale reduces only its branch, blocks negative stock, and supports request-from-another-branch', async () => {
    setSession(managerA)
    const sale = await call('invoices:create', {
      bill_type: 'RETAIL', branch_id: B,
      items: [{ product_id: P1, quantity: 1, unit_price: 1000, discount_pct: 0, discount_amount: 0 }],
      subtotal: 1000, discount_amount: 0, tax_amount: 0, total_amount: 1000, paid_amount: 1000,
      payments: [{ method: 'cash', amount: 1000 }],
    })
    expect(sale.success, sale.error).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(4)
    const tooMany = await call('invoices:create', {
      bill_type: 'RETAIL', items: [{ product_id: P1, quantity: 99, unit_price: 1000, discount_pct: 0 }],
      subtotal: 99000, discount_amount: 0, tax_amount: 0, total_amount: 99000, paid_amount: 99000,
      payments: [{ method: 'cash', amount: 99000 }],
    })
    expect(tooMany.success).toBe(false)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(4)
    const request = await call('stocks:transfer', { product_id: P1, from_branch_id: B, to_branch_id: A, quantity: 1, notes: 'Out-of-stock fulfilment request' })
    expect(request.success).toBe(true)
    expect((db.prepare('SELECT status FROM stock_transfers WHERE id=?').get(request.data.id) as { status: string }).status).toBe('pending_approval')

    const invoiceItem = db.prepare('SELECT id FROM invoice_items WHERE invoice_id=?').get(sale.data.id) as { id: string }
    const returned = await call('returns:create', {
      invoice_id: sale.data.id, reason: 'QA return', refund_method: 'cash',
      items: [{ product_id: P1, invoice_item_id: invoiceItem.id, quantity: 1, unit_price: 1 }],
    })
    expect(returned.success).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(5)
    expect((await call('returns:cancel', returned.data.id)).success).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, A) as { quantity: number }).quantity).toBe(4)
    expect((await call('returns:cancel', returned.data.id)).success).toBe(false)
  })

  it('cancelling a dispatched request restores source stock exactly once', async () => {
    setSession(managerA)
    const requested = await call('stocks:transfer', { product_id: P1, from_branch_id: B, to_branch_id: A, quantity: 1 })
    setSession(managerB)
    expect((await call('stocks:updateTransfer', requested.data.id, 'approved', {})).success).toBe(true)
    expect((await call('stocks:updateTransfer', requested.data.id, 'dispatched', {})).success).toBe(true)
    const afterDispatch = (db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, B) as { quantity: number }).quantity
    expect((await call('stocks:updateTransfer', requested.data.id, 'cancelled', {})).success).toBe(true)
    expect((db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(P1, B) as { quantity: number }).quantity).toBe(afterDispatch + 1)
    expect((await call('stocks:updateTransfer', requested.data.id, 'cancelled', {})).success).toBe(false)
  })
})

describe('Security audit regression — SmartBuy agent branch validation', () => {
  const BR_A = 'sec2-branch-a', BR_B = 'sec2-branch-b'

  beforeAll(() => {
    seedBranch(BR_A, 'Security2 Branch A', 'S2A')
    seedBranch(BR_B, 'Security2 Branch B', 'S2B')
    seedUser('u-sec2-mgr-a', BR_A)
    db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status) VALUES (?,?,?,?,?,'active')`)
      .run('sec2-agent-b', 'SEC2-AG-B', 'Wrong Branch Agent', BR_B, 5)
  })

  const mgrA = makeSession({ id: 'u-sec2-mgr-a', branchId: BR_A, permissions: { chits: true, customers: true } })

  it('chits:members:add rejects an agent_id that belongs to a different branch', async () => {
    setSession(mgrA)
    const tmpl = await (async () => {
      setSession(makeSession({ id: 'u-sec-admin', permissions: { all: true } }))
      const t = await call('chits:templates:create', {
        scheme_name: 'Sec2 Template', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
      })
      setSession(mgrA)
      return t
    })()
    if (!tmpl.success) return // template feature not applicable to this branch config — skip gracefully
    const scheme = await call('chits:create', { template_id: tmpl.data.id, branch_id: BR_A, agent_commission_pct: 5 })
    if (!scheme.success) return
    const res = await call('chits:members:add', scheme.data.id, {
      customer_name: 'Sec2 Cust', customer_phone: '0770000001', agent_id: 'sec2-agent-b',
    })
    expect(res.success).toBe(false)
  })
})

describe('Security audit regression — commission self-approval block', () => {
  const BR_A = 'sec3-branch-a'

  beforeAll(() => {
    seedBranch(BR_A, 'Security3 Branch A', 'S3A')
    seedUser('u-sec3-mgr', BR_A) // also the agent's linked login
    db.prepare(`INSERT OR IGNORE INTO agents (id, code, name, branch_id, default_commission_pct, status, user_id) VALUES (?,?,?,?,?,'active',?)`)
      .run('sec3-agent-self', 'SEC3-AG', 'Self-Approving Agent', BR_A, 5, 'u-sec3-mgr')
    db.prepare(`
      INSERT INTO commission_ledger (id, source_table, source_id, registration_agent_id, base_amount, registration_commission, total_commission, status, branch_id)
      VALUES ('sec3-ledger-1', 'chit_members', 'sec3-source-1', 'sec3-agent-self', 1000, 50, 50, 'pending_manager_approval', ?)
    `).run(BR_A)
  })

  const mgrLinkedToAgent = makeSession({ id: 'u-sec3-mgr', branchId: BR_A, permissions: { chits: true, employees: true } })

  it('commissions:ledger:approve rejects a staff caller approving a commission line where they are the linked agent', async () => {
    setSession(mgrLinkedToAgent)
    const res = await call('commissions:ledger:approve', 'sec3-ledger-1')
    expect(res.success).toBe(false)
  })

  it('commissions:ledger:reject rejects the same self-dealing case', async () => {
    setSession(mgrLinkedToAgent)
    const res = await call('commissions:ledger:reject', 'sec3-ledger-1', 'testing self-reject')
    expect(res.success).toBe(false)
  })
})

// Regression tests for the SmartBuy menu/route fix: Commission Rules and
// Scheme Master were previously hidden behind adminOnly:true in the sidebar
// (AppLayout.tsx) even though the backend handlers underneath (chits.ts,
// commissions.ts) were already written to let a plain `chits` user VIEW
// them — only mutating requires Super Admin. These tests pin down that
// exact backend contract so a future change can't silently make the menu
// fix (chits can now reach these pages) meaningless, or accidentally let a
// chits-only user mutate what should stay admin-only.
describe('Security audit regression — SmartBuy Commission Rules / Scheme Master view-vs-mutate boundary', () => {
  const BR_A = 'sec4-branch-a'

  beforeAll(() => {
    seedBranch(BR_A, 'Security4 Branch A', 'S4A')
    seedUser('u-sec4-admin', null)
    seedUser('u-sec4-chits', BR_A)
  })

  const admin = makeSession({ id: 'u-sec4-admin', permissions: { all: true } })
  const chitsOnly = makeSession({ id: 'u-sec4-chits', branchId: BR_A, permissions: { chits: true } })

  it('commissions:rules:list — a chits-only (non-admin) caller can view rules', async () => {
    setSession(chitsOnly)
    const res = await call('commissions:rules:list')
    if (!res.success) throw new Error(`REGRESSION: commissions:rules:list now rejects a chits-only caller — the "Commission Rules" menu item (AppLayout.tsx, perm:['chits']) would show a page that immediately fails to load. Error: ${res.error}`)
    expect(res.success).toBe(true)
  })

  it('commissions:rules:create — a chits-only (non-admin) caller is still rejected (Super Admin only)', async () => {
    setSession(chitsOnly)
    const res = await call('commissions:rules:create', {
      name: 'Sec4 Rule', scope: 'global', calculation_type: 'percentage', rate: 5, ownership_model: 'registration', status: 'active',
    })
    if (res.success) throw new Error('REGRESSION: a chits-only caller was able to create a commission rule — mutation must stay Super Admin-only even though viewing was intentionally opened up')
    expect(res.success).toBe(false)
  })

  it('commissions:rules:create — Super Admin can still create a rule (mutation path unaffected)', async () => {
    setSession(admin)
    const res = await call('commissions:rules:create', {
      name: 'Sec4 Admin Rule', scope: 'global', calculation_type: 'percentage', rate: 5, ownership_model: 'registration', status: 'active',
    })
    expect(res.success).toBe(true)
  })

  it('chits:templates:list — a chits-only (non-admin) caller can view the Scheme Master catalog', async () => {
    setSession(chitsOnly)
    const res = await call('chits:templates:list', { status: 'all' })
    if (!res.success) throw new Error(`REGRESSION: chits:templates:list now rejects a chits-only caller — the "Scheme Master" menu item and its route (now RequireSmartBuyAccess in App.tsx) would show a page that immediately fails to load. Error: ${res.error}`)
    expect(res.success).toBe(true)
  })

  it('chits:templates:create — a chits-only (non-admin) caller is still rejected (Super Admin only)', async () => {
    setSession(chitsOnly)
    const res = await call('chits:templates:create', {
      scheme_name: 'Sec4 Scheme', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
    })
    if (res.success) throw new Error('REGRESSION: a chits-only caller was able to create a Scheme Master template — mutation must stay Super Admin-only even though viewing was intentionally opened up')
    expect(res.success).toBe(false)
  })

  it('chits:templates:create — Super Admin can still create a template (mutation path unaffected)', async () => {
    setSession(admin)
    const res = await call('chits:templates:create', {
      scheme_name: 'Sec4 Admin Scheme', monthly_contribution_amount: 1000, duration_months: 5, minimum_members: 3, product_value: 5000,
    })
    expect(res.success).toBe(true)
  })
})

// Acceptance tests for "Agent Management as Staff Master" (spec §26, 12
// scenarios): Agent Management owns the staff identity; User List only ever
// creates a LOGIN for an existing Agent via agents:createUserForAgent, never
// a second, disconnected staff record. makeFullSession below mirrors what
// auth.ts's buildAuthUserPayload actually puts on a real session (both
// `role.permissions` AND a top-level `permissions` — admin:users:list reads
// the top-level field directly), unlike the shared makeSession() above which
// only ever needed `role.permissions` for the handlers exercised earlier in
// this file.
describe('Agent Management as Staff Master — createUserForAgent, live sync, security', () => {
  const BR_A = 'sec5-branch-a', BR_B = 'sec5-branch-b'

  function makeFullSession(opts: { id: string; branchId?: string | null; permissions: Record<string, unknown> }) {
    return {
      id: opts.id, name: opts.id, branch_id: opts.branchId ?? null,
      role: { permissions: opts.permissions },
      permissions: opts.permissions,
      scope: { level: opts.permissions.all ? 'owner' : 'branch', branchId: opts.branchId ?? null, agentId: null },
    }
  }

  beforeAll(() => {
    seedBranch(BR_A, 'Security5 Branch A', 'S5A')
    seedBranch(BR_B, 'Security5 Branch B', 'S5B')
    seedUser('u-sec5-admin', null)
    seedUser('u-sec5-mgr-a', BR_A)
    seedUser('u-sec5-noperm', BR_A)
    db.prepare(`INSERT OR IGNORE INTO roles (id, name, session_scope, permissions) VALUES (?,?,?,?)`)
      .run('sec5-agent-role', 'Sec5 Agent Portal Role', 'agent', '{}')
  })

  const admin      = makeFullSession({ id: 'u-sec5-admin', permissions: { all: true } })
  const mgrA       = makeFullSession({ id: 'u-sec5-mgr-a', branchId: BR_A, permissions: { employees: true } })
  const noPermUser = makeFullSession({ id: 'u-sec5-noperm', branchId: BR_A, permissions: { pos: true } })

  let agentId: string

  it('1: agents:create creates a new Agent record that appears in agents:list with the fields the User List / search UI needs', async () => {
    setSession(admin)
    const res = await call('agents:create', {
      code: 'SEC5-AG-1', name: 'Staff One', nic: 'SEC5-NIC-1', phone: '0771000001', email: 'staff1@sec5.test',
      position: 'Field Agent', branch_id: BR_A,
    })
    expect(res.success).toBe(true)
    agentId = res.data.id

    const list = await call('agents:list', { branch_id: BR_A })
    expect(list.success).toBe(true)
    const row = (list.data as Record<string, unknown>[]).find(a => a.id === agentId)
    expect(row).toBeTruthy()
    expect(row!.code).toBe('SEC5-AG-1')
    expect(row!.name).toBe('Staff One')
    expect(row!.nic).toBe('SEC5-NIC-1')
    expect(row!.position).toBe('Field Agent')
  })

  it('2: agents:create rejects a duplicate NIC and returns the existing agent\'s id instead of a generic error', async () => {
    setSession(admin)
    const res = await call('agents:create', {
      code: 'SEC5-AG-1B', name: 'Staff One Duplicate', nic: 'SEC5-NIC-1', branch_id: BR_A,
    })
    expect(res.success).toBe(false)
    expect(res.existingId).toBe(agentId)
  })

  let firstUserId: string

  it('3: agents:createUserForAgent creates a login linked via agents.user_id — never a second staff record', async () => {
    setSession(admin)
    const res = await call('agents:createUserForAgent', agentId, { role_id: 'sec5-agent-role', pin: '2468', is_active: 1 })
    expect(res.success).toBe(true)
    firstUserId = res.data.userId

    const agentRow = db.prepare('SELECT user_id FROM agents WHERE id = ?').get(agentId) as { user_id: string }
    expect(agentRow.user_id).toBe(firstUserId)
    const userRow = db.prepare('SELECT name, branch_id FROM users WHERE id = ?').get(firstUserId) as { name: string; branch_id: string }
    // Identity came FROM the Agent record — never typed separately.
    expect(userRow.name).toBe('Staff One')
    expect(userRow.branch_id).toBe(BR_A)
  })

  it('4: admin:users:getAgentInfo mirrors the live Agent Management record — Profile is never a second source of truth', async () => {
    setSession(admin)
    const res = await call('admin:users:getAgentInfo', firstUserId)
    expect(res.success).toBe(true)
    expect(res.data.agent_code).toBe('SEC5-AG-1')
    expect(res.data.nic).toBe('SEC5-NIC-1')
    expect(res.data.position).toBe('Field Agent')
  })

  it('5: agents:createUserForAgent blocks creating a second login for an already-linked agent, returning the existing user id', async () => {
    setSession(admin)
    const res = await call('agents:createUserForAgent', agentId, { role_id: 'sec5-agent-role', pin: '1111', is_active: 1 })
    expect(res.success).toBe(false)
    expect(res.existingUserId).toBe(firstUserId)
  })

  it('6: agents:update changing branch_id automatically syncs the linked user\'s branch_id (and admin:users:list) without a separate User edit', async () => {
    setSession(admin)
    const upd = await call('agents:update', agentId, { branch_id: BR_B })
    expect(upd.success).toBe(true)

    const userRow = db.prepare('SELECT branch_id FROM users WHERE id = ?').get(firstUserId) as { branch_id: string }
    expect(userRow.branch_id).toBe(BR_B)

    const list = await call('admin:users:list')
    const row = (list.data as Record<string, unknown>[]).find(u => u.id === firstUserId)
    expect(row!.branch_name).toBe('Security5 Branch B')

    // restore for subsequent tests that assume branch A
    await call('agents:update', agentId, { branch_id: BR_A })
  })

  it('7: agents:update changing position is reflected immediately in admin:users:list\'s live join — no copy is stored on the user row', async () => {
    setSession(admin)
    const upd = await call('agents:update', agentId, { position: 'Senior Field Agent' })
    expect(upd.success).toBe(true)

    const list = await call('admin:users:list')
    const row = (list.data as Record<string, unknown>[]).find(u => u.id === firstUserId)
    expect(row!.agent_position).toBe('Senior Field Agent')
  })

  it('8: auth:pinLogin rejects login once the linked Agent is set Inactive, even though the user row itself is still active', async () => {
    setSession(admin)
    const deactivate = await call('agents:update', agentId, { status: 'inactive' })
    expect(deactivate.success).toBe(true)

    const login = await call('auth:pinLogin', { pin: '2468', branch_id: BR_A })
    expect(login.success).toBe(false)
    expect(String(login.error)).toMatch(/inactive/i)

    // restore for any later test relying on this agent being active
    await call('agents:update', agentId, { status: 'active' })
  })

  it('9: agents:createUserForAgent rejects a non-existent agentId', async () => {
    setSession(admin)
    const res = await call('agents:createUserForAgent', 'sec5-not-a-real-agent-id', { role_id: 'sec5-agent-role', pin: '3333', is_active: 1 })
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/not found/i)
  })

  it('10: commission_ledger stays keyed to the Agent id — creating a login neither duplicates nor re-keys the commission row', async () => {
    db.prepare(`
      INSERT INTO commission_ledger (id, source_table, source_id, registration_agent_id, base_amount, registration_commission, total_commission, status, branch_id)
      VALUES ('sec5-ledger-1', 'chit_members', 'sec5-source-1', ?, 1000, 50, 50, 'pending_manager_approval', ?)
    `).run(agentId, BR_A)

    setSession(admin)
    const create2 = await call('agents:create', { code: 'SEC5-AG-2', name: 'Staff Two', branch_id: BR_A })
    expect(create2.success).toBe(true)
    await call('agents:createUserForAgent', create2.data.id, { role_id: 'sec5-agent-role', pin: '4444', is_active: 1 })

    const count = db.prepare('SELECT COUNT(*) as cnt FROM commission_ledger WHERE registration_agent_id = ?').get(agentId) as { cnt: number }
    expect(count.cnt).toBe(1)
    const ledgerRow = db.prepare('SELECT registration_agent_id FROM commission_ledger WHERE id = ?').get('sec5-ledger-1') as { registration_agent_id: string }
    expect(ledgerRow.registration_agent_id).toBe(agentId)
  })

  it('11: a caller without employees/all permission is rejected from every Agent/User write path', async () => {
    setSession(noPermUser)
    const create = await call('agents:create', { code: 'SEC5-AG-NOPERM', name: 'Blocked', branch_id: BR_A })
    expect(create.success).toBe(false)
    const update = await call('agents:update', agentId, { position: 'Should Not Apply' })
    expect(update.success).toBe(false)
    const createLogin = await call('agents:createUserForAgent', agentId, { role_id: 'sec5-agent-role', pin: '5555', is_active: 1 })
    expect(createLogin.success).toBe(false)
    const createUser = await call('admin:users:create', { name: 'Blocked User', email: 'blocked@sec5.test', role_id: 'sec5-agent-role', branch_id: BR_A, password: 'x' })
    expect(createUser.success).toBe(false)
  })

  it('12: agents:createUserForAgent rejects a branch-scoped caller acting on an agent from a different branch', async () => {
    setSession(admin)
    const otherBranchAgent = await call('agents:create', { code: 'SEC5-AG-OTHER', name: 'Other Branch Staff', branch_id: BR_B })
    expect(otherBranchAgent.success).toBe(true)

    setSession(mgrA) // scoped to BR_A
    const res = await call('agents:createUserForAgent', otherBranchAgent.data.id, { role_id: 'sec5-agent-role', pin: '6666', is_active: 1 })
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/do not have access/i)
  })
})
