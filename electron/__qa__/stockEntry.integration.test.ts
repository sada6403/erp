// Keyboard stock entry back end: large receipts, extra barcodes and customer offers
// against the real desktop schema.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stock-entry-qa-'))
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
const fakeIpcMain = { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) }, on: () => {} } as unknown as import('electron').IpcMain
async function call(channel: string, ...args: unknown[]): Promise<any> {
  const fn = hoisted.registry.get(channel)
  if (!fn) throw new Error(`No handler registered for channel: ${channel}`)
  return fn({} as any, ...args)
}

let db: import('better-sqlite3').Database
let createStockPurchase: typeof import('../services/purchaseEntry').createStockPurchase
const MAIN = 'b1111111-1111-4111-8111-111111111111'
const SUPPLIER = 'se-supplier'
const admin = { id: 'se-admin', name: 'QA', branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }

beforeAll(async () => {
  const database = await import('../database')
  await database.initDatabase()
  db = database.getDb()
  ;({ createStockPurchase } = await import('../services/purchaseEntry'))
  const { registerProductHandlers } = await import('../ipc/products')
  const { registerDiscountHandlers } = await import('../ipc/discounts')
  registerProductHandlers(fakeIpcMain)
  registerDiscountHandlers()
  storeData.app_settings = { business_type: 'supermarket' }
  storeData.auth_user = admin
  db.prepare(`INSERT OR IGNORE INTO roles (id,name) VALUES ('se-role','QA')`).run()
  db.prepare(`INSERT OR IGNORE INTO users (id,branch_id,role_id,name,email,password_hash) VALUES ('se-admin',NULL,'se-role','QA','se@qa.test','x')`).run()
  db.prepare('INSERT OR IGNORE INTO suppliers (id,name) VALUES (?,?)').run(SUPPLIER, 'Wholesale')
  const insert = db.prepare(`INSERT OR IGNORE INTO products (id,sku,name,unit,barcode,cost_price,selling_price,tax_rate) VALUES (?,?,?,?,?,?,?,0)`)
  db.transaction(() => { for (let i = 0; i < 500; i++) insert.run(`se-p${i}`, `SE-${i}`, `Stock entry item ${i}`, 'pcs', i === 0 ? '4790000000001' : null, 50, 80) })()
})

const bill = (id: string) => db.prepare(`INSERT INTO purchase_attachments (id,purchase_id,original_name,stored_name,relative_path,mime_type,file_size,uploaded_by)
  VALUES (?,?,?,?,?,?,?,?)`).run(`bill-${id}`, id, 'b.pdf', `b-${id}.pdf`, `bills/b-${id}.pdf`, 'application/pdf', 1, 'se-admin')

describe('large keyboard receiving session', () => {
  it('receives 500 lines atomically, quickly and only once', () => {
    const items = Array.from({ length: 500 }, (_, i) => ({ product_id: `se-p${i}`, quantity: 2, unit_cost: 50, free_quantity: i % 10 === 0 ? 1 : 0, discount_amount: i % 7 === 0 ? 5 : 0, selling_price: 80 }))
    const input = { id: 'se-receipt-500', poNumber: 'SE-500', branchId: MAIN, supplierId: SUPPLIER, purchaseType: 'direct' as const, purchaseDate: '2026-11-26', invoiceNumber: 'INV-500', items, userId: 'se-admin' }
    const started = performance.now()
    createStockPurchase(db, input, bill)
    const elapsed = performance.now() - started
    expect(elapsed).toBeLessThan(5000)
    expect(db.prepare('SELECT COUNT(*) n FROM purchase_items WHERE po_id=?').get('se-receipt-500')).toEqual({ n: 500 })
    expect(db.prepare('SELECT COUNT(*) n FROM product_batches WHERE po_id=?').get('se-receipt-500')).toEqual({ n: 500 })
    expect(db.prepare("SELECT ROUND(SUM(quantity),6) q FROM stocks WHERE product_id LIKE 'se-p%' AND branch_id=?").get(MAIN)).toEqual({ q: 1050 })
    // Retrying the same receipt (double Enter, crash replay) changes nothing.
    createStockPurchase(db, input, bill)
    expect(db.prepare("SELECT ROUND(SUM(quantity),6) q FROM stocks WHERE product_id LIKE 'se-p%' AND branch_id=?").get(MAIN)).toEqual({ q: 1050 })
    // The same supplier bill number under a new reference is rejected.
    expect(() => createStockPurchase(db, { ...input, id: 'se-receipt-dup', poNumber: 'SE-DUP' }, bill)).toThrow(/already saved/)
    console.info(`[stock-entry] 500-line receipt saved in ${Math.round(elapsed)} ms`)
  })

  it('rolls back every line when one line is invalid', () => {
    const before = db.prepare("SELECT ROUND(SUM(quantity),6) q FROM stocks WHERE product_id LIKE 'se-p%'").get()
    const items = [{ product_id: 'se-p1', quantity: 1, unit_cost: 50, selling_price: 80 }, { product_id: 'se-p2', quantity: 1, unit_cost: 50, selling_price: 80, mrp: 60 }]
    expect(() => createStockPurchase(db, { id: 'se-bad', poNumber: 'SE-BAD', branchId: MAIN, supplierId: SUPPLIER, purchaseType: 'direct', purchaseDate: '2026-11-26', items }, bill)).toThrow(/MRP/)
    expect(db.prepare("SELECT ROUND(SUM(quantity),6) q FROM stocks WHERE product_id LIKE 'se-p%'").get()).toEqual(before)
    expect(db.prepare('SELECT COUNT(*) n FROM purchase_orders WHERE id=?').get('se-bad')).toEqual({ n: 0 })
  })
})

describe('barcode management', () => {
  it('sets a primary barcode, adds an additional one, rejects duplicates and queues sync', async () => {
    expect((await call('products:addBarcode', { product_id: 'se-p5', barcode: '4790000000055' })).data).toMatchObject({ kind: 'primary' })
    expect((await call('products:addBarcode', { product_id: 'se-p5', barcode: 'CTN-0055' })).data).toMatchObject({ kind: 'additional' })
    const dup = await call('products:addBarcode', { product_id: 'se-p6', barcode: '4790000000001' })
    expect(dup.success).toBe(false)
    expect(String(dup.error)).toMatch(/already belongs to Stock entry item 0/)
    const dupExtra = await call('products:addBarcode', { product_id: 'se-p6', barcode: 'CTN-0055' })
    expect(dupExtra.success).toBe(false)
    expect(db.prepare("SELECT COUNT(*) n FROM sync_queue WHERE table_name='product_barcodes'").get()).toEqual({ n: 1 })
    const found = await call('products:searchSku', 'CTN-0055')
    expect(found.data?.id).toBe('se-p5')
    const owner = await call('products:barcodeOwner', 'CTN-0055')
    expect(owner.data).toMatchObject({ id: 'se-p5' })
    const list = await call('products:list', { is_active: true })
    expect(list.data.find((p: any) => p.id === 'se-p5').extra_barcodes).toBe('CTN-0055')
  })

  it('generates a unique in-store barcode outside the weighing-scale prefixes', async () => {
    const res = await call('products:generateBarcode')
    expect(res.data).toMatch(/^28\d{11}$/)
    expect((await call('products:barcodeOwner', res.data)).data).toBeNull()
  })
})

describe('customer offers', () => {
  it('stores a dated product offer the POS applies only inside its dates', async () => {
    const today = new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10)
    const created = await call('discounts:create', { name: 'Offer: item 9', type: 'flat', value: 10, scope: 'product', product_id: 'se-p9', valid_from: today, valid_until: today })
    expect(created.success).toBe(true)
    const future = await call('discounts:create', { name: 'Offer: item 8', type: 'percentage', value: 5, scope: 'product', product_id: 'se-p8', valid_from: '2099-01-01', valid_until: '2099-01-31' })
    expect(future.success).toBe(true)
    const active = await call('discounts:activeMap')
    const ids = (active.data as any[]).map(r => r.product_id)
    expect(ids).toContain('se-p9')
    expect(ids).not.toContain('se-p8')
  })
})
