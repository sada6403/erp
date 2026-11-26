// Supermarket flow: order goods without dates, enter batch/MFD/expiry only when
// the stock physically arrives, possibly across several partial receipts.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'po-dates-qa-'))
const hoisted = vi.hoisted(() => ({ registry: new Map<string, (...args: unknown[]) => unknown>() }))

vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) }, on: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  net: { request: () => ({ on: () => {}, write: () => {}, end: () => {}, setHeader: () => {} }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class { static getAllWindows() { return [] } },
  shell: { openExternal: async () => {} },
  protocol: { registerFileProtocol: () => {}, handle: () => {} },
  Menu: { setApplicationMenu: () => {}, buildFromTemplate: () => ({}) },
}))

const storeData: Record<string, unknown> = {}
vi.mock('electron-store', () => ({
  default: class {
    get(key: string, def?: unknown) { return key in storeData ? storeData[key] : def }
    set(key: string, val: unknown) { storeData[key] = val }
    delete(key: string) { delete storeData[key] }
  },
}))

const fakeIpcMain = {
  handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) },
  on: () => {},
} as unknown as import('electron').IpcMain

async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

let db: import('better-sqlite3').Database
const SUPPLIER = 'po-dates-supplier'
const MILK = 'po-dates-milk'
const RICE = 'po-dates-rice'
const future = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)
const past = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10)

function attachBill(poId: string) {
  db.prepare(`INSERT INTO purchase_attachments (id,purchase_id,original_name,stored_name,relative_path,mime_type,file_size,uploaded_by)
    VALUES (?,?,?,?,?,?,?,?)`).run(`bill-${poId}`, poId, 'bill.pdf', `bill-${poId}.pdf`, `bills/bill-${poId}.pdf`, 'application/pdf', 10, 'po-dates-admin')
}

async function createSentOrder(items: Record<string, unknown>[]) {
  const created = await call('purchases:create', { supplier_id: SUPPLIER, purchase_type: 'order', purchase_date: past(1), items, open_whatsapp: false, send_email: false })
  expect(created.success, created.error).toBe(true)
  const poId = String(created.data.id)
  expect((await call('purchases:updateStatus', poId, 'SENT', { open_whatsapp: false, send_email: false })).success).toBe(true)
  attachBill(poId)
  return poId
}

function line(poId: string, productId: string) {
  return db.prepare('SELECT * FROM purchase_items WHERE po_id=? AND product_id=?').get(poId, productId) as Record<string, any>
}

beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()
  const { registerPurchaseHandlers } = await import('../ipc/purchases')
  registerPurchaseHandlers(fakeIpcMain)
  storeData.app_settings = { business_type: 'supermarket' }
  db.prepare(`INSERT OR IGNORE INTO roles (id,name) VALUES ('po-dates-role','QA')`).run()
  db.prepare(`INSERT OR IGNORE INTO users (id,branch_id,role_id,name,email,password_hash) VALUES ('po-dates-admin',NULL,'po-dates-role','QA','po-dates@qa.test','x')`).run()
  db.prepare('INSERT OR IGNORE INTO suppliers (id,name) VALUES (?,?)').run(SUPPLIER, 'Dates Supplier')
  db.prepare(`INSERT OR IGNORE INTO products (id,sku,name,unit,cost_price,selling_price,tax_rate,track_expiry) VALUES (?,?,?,?,?,?,0,1)`).run(MILK, MILK, 'Milk 1L', 'pcs', 300, 400)
  db.prepare(`INSERT OR IGNORE INTO products (id,sku,name,unit,cost_price,selling_price,tax_rate,track_expiry) VALUES (?,?,?,?,?,?,0,0)`).run(RICE, RICE, 'Rice', 'kg', 200, 260)
  storeData.auth_user = { id: 'po-dates-admin', name: 'QA', branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
})

describe('purchase order: dates are entered when goods arrive', () => {
  it('creates an order with no batch, MFD or expiry and changes no stock', async () => {
    const poId = await createSentOrder([{ product_id: MILK, quantity: 10, unit_cost: 300 }, { product_id: RICE, quantity: 25, unit_cost: 200 }])
    expect(line(poId, MILK).expiry_date ?? null).toBeNull()
    expect(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE po_id=?').get(poId)).toEqual({ n: 0 })
    expect(db.prepare('SELECT quantity FROM stocks WHERE product_id=?').get(MILK)).toBeUndefined()
  })

  it('refuses to receive an expiry-tracked product without an expiry date, leaving stock untouched', async () => {
    const poId = await createSentOrder([{ product_id: MILK, quantity: 4, unit_cost: 300 }])
    const item = line(poId, MILK)
    const res = await call('purchases:updateStatus', poId, 'PARTIAL', { items: [{ id: item.id, received_qty: 4, already_received: 0, purchase_date: past(0) }] })
    expect(res.success).toBe(false)
    expect(String(res.error)).toMatch(/Expiry date is required/)
    expect(line(poId, MILK).received_qty).toBe(0)
    expect(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE po_id=?').get(poId)).toEqual({ n: 0 })
  })

  it('records receive-time dates, splits partial receipts into separate batches and never double-counts', async () => {
    const poId = await createSentOrder([{ product_id: MILK, quantity: 10, unit_cost: 300 }, { product_id: RICE, quantity: 25.5, unit_cost: 200 }])
    const milk = line(poId, MILK), rice = line(poId, RICE)
    const before = Number((db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stocks WHERE product_id=?').get(MILK) as { q: number }).q)

    const first = await call('purchases:updateStatus', poId, 'PARTIAL', { items: [
      { id: milk.id, received_qty: 6, already_received: 0, purchase_date: past(0), batch_number: 'MILK-A', mfg_date: past(2), expiry_date: future(10) },
      { id: rice.id, received_qty: 25.5, already_received: 0, purchase_date: past(0) },
    ] })
    expect(first.success, first.error).toBe(true)
    expect(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(poId)).toEqual({ status: 'PARTIAL' })

    // Stale retry of the same receipt must not add stock again.
    const retry = await call('purchases:updateStatus', poId, 'PARTIAL', { items: [{ id: milk.id, received_qty: 6, already_received: 0, purchase_date: past(0), batch_number: 'MILK-A', mfg_date: past(2), expiry_date: future(10) }] })
    expect(retry.success).toBe(false)

    const second = await call('purchases:updateStatus', poId, 'RECEIVED', { items: [
      { id: milk.id, received_qty: 4, already_received: 6, purchase_date: past(0), batch_number: 'MILK-B', mfg_date: past(1), expiry_date: future(20) },
    ] })
    expect(second.success, second.error).toBe(true)
    expect(db.prepare('SELECT status FROM purchase_orders WHERE id=?').get(poId)).toEqual({ status: 'RECEIVED' })

    const batches = db.prepare('SELECT product_id,batch_number,mfg_date,expiry_date,quantity FROM product_batches WHERE po_id=? ORDER BY product_id,batch_number').all(poId)
    expect(batches).toEqual([
      { product_id: MILK, batch_number: 'MILK-A', mfg_date: past(2), expiry_date: future(10), quantity: 6 },
      { product_id: MILK, batch_number: 'MILK-B', mfg_date: past(1), expiry_date: future(20), quantity: 4 },
      expect.objectContaining({ product_id: RICE, mfg_date: null, expiry_date: null, quantity: 25.5 }),
    ])
    const after = Number((db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stocks WHERE product_id=?').get(MILK) as { q: number }).q)
    expect(after - before).toBe(10)
    expect(db.prepare(`SELECT COUNT(*) n FROM stock_movements WHERE reference_order_id=? AND movement_type='RECEIVE'`).get(poId)).toEqual({ n: 3 })
  })

  it('rejects an expiry date that is not after the manufacture date', async () => {
    const poId = await createSentOrder([{ product_id: MILK, quantity: 2, unit_cost: 300 }])
    const item = line(poId, MILK)
    const res = await call('purchases:updateStatus', poId, 'RECEIVED', { items: [{ id: item.id, received_qty: 2, already_received: 0, purchase_date: past(0), batch_number: 'MILK-BAD', mfg_date: future(5), expiry_date: future(1) }] })
    expect(res.success).toBe(false)
    expect(line(poId, MILK).received_qty).toBe(0)
  })
})
