// Supplier quotation (RFQ) → purchase order → receiving, through the real IPC handlers.
import { beforeAll, describe, it, expect, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rfq-qa-'))
const hoisted = vi.hoisted(() => ({ registry: new Map<string, (...args: unknown[]) => unknown>(), opened: [] as string[] }))
vi.mock('electron', () => ({
  app: { getPath: () => tmpDir, isPackaged: false, whenReady: () => Promise.resolve(), on: () => {} },
  ipcMain: { handle: (channel: string, fn: (...args: unknown[]) => unknown) => { hoisted.registry.set(channel, fn) }, on: () => {} },
  dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }), showSaveDialog: async () => ({ canceled: true }) },
  net: { request: () => ({ on: () => {}, write: () => {}, end: () => {}, setHeader: () => {} }) },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: (s: string) => Buffer.from(s), decryptString: (b: Buffer) => b.toString() },
  BrowserWindow: class { static getAllWindows() { return [] } },
  shell: { openExternal: async (url: string) => { hoisted.opened.push(url) } },
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
const MAIN = 'b1111111-1111-4111-8111-111111111111'
const SUP = 'rfq-supplier', OTHER = 'rfq-other-supplier'
const manager = { id: 'rfq-admin', name: 'QA', branch_id: null, role: { permissions: { all: true } }, scope: { level: 'owner', branchId: null, agentId: null } }
const clerk = { id: 'rfq-clerk', name: 'Clerk', branch_id: MAIN, role: { permissions: { inventory: true } }, scope: { level: 'branch', branchId: MAIN, agentId: null } }
const stock = (id: string) => Number((db.prepare('SELECT COALESCE(SUM(quantity),0) q FROM stocks WHERE product_id=? AND branch_id=?').get(id, MAIN) as { q: number }).q)

beforeAll(async () => {
  const database = await import('../database')
  await database.initDatabase()
  db = database.getDb()
  const { registerPurchaseHandlers } = await import('../ipc/purchases')
  registerPurchaseHandlers(fakeIpcMain)
  storeData.app_settings = { business_type: 'supermarket', company_name: 'TK Fresh Choice' }
  storeData.auth_user = manager
  db.prepare(`INSERT OR IGNORE INTO roles (id,name) VALUES ('rfq-role','QA')`).run()
  for (const u of ['rfq-admin', 'rfq-clerk']) db.prepare(`INSERT OR IGNORE INTO users (id,branch_id,role_id,name,email,password_hash) VALUES (?,NULL,'rfq-role',?,?,'x')`).run(u, u, `${u}@qa.test`)
  db.prepare('INSERT OR IGNORE INTO suppliers (id,name,mobile_number) VALUES (?,?,?)').run(SUP, 'Lanka Wholesale', '0771234567')
  db.prepare('INSERT OR IGNORE INTO suppliers (id,name) VALUES (?,?)').run(OTHER, 'Other Supplier')
  const product = db.prepare(`INSERT OR IGNORE INTO products (id,sku,name,unit,cost_price,selling_price,tax_rate,min_stock_level,supplier_id) VALUES (?,?,?,?,?,?,0,?,?)`)
  product.run('rfq-sugar', 'RFQ-SUGAR', 'Sugar', 'kg', 250, 300, 10, SUP)
  product.run('rfq-soap', 'RFQ-SOAP', 'Soap', 'pcs', 90, 120, 5, SUP)
  product.run('rfq-milk', 'RFQ-MILK', 'Milk powder', 'pcs', 900, 1100, 5, SUP)
  product.run('rfq-other', 'RFQ-OTHER', 'Other brand tea', 'pcs', 100, 150, 5, OTHER)
  product.run('rfq-loose', 'RFQ-LOOSE', 'Unlinked dhal', 'kg', 300, 360, 2, null)
  const st = db.prepare('INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)')
  st.run('rfq-s1', 'rfq-sugar', MAIN, 2); st.run('rfq-s2', 'rfq-soap', MAIN, 50); st.run('rfq-s3', 'rfq-milk', MAIN, 0); st.run('rfq-s4', 'rfq-other', MAIN, 0)
  // 30 kg of sugar sold in the last 30 days → 1 kg/day
  db.prepare(`INSERT INTO invoices (id,invoice_number,branch_id,cashier_id,status,bill_type,created_at) VALUES ('rfq-inv','RFQ-INV-1',?,'rfq-admin','completed','RETAIL',datetime('now','-3 days'))`).run(MAIN)
  db.prepare(`INSERT INTO invoice_items (id,invoice_id,product_id,quantity,unit_price,line_total) VALUES ('rfq-ii','rfq-inv','rfq-sugar',30,300,9000)`).run()
  // Milk is already on a sent purchase order (15 incoming)
  db.prepare(`INSERT INTO purchase_orders (id,po_number,branch_id,supplier_id,purchase_type,status,total_amount) VALUES ('rfq-pending','PO-PEND',?,?,'order','SENT',13500)`).run(MAIN, SUP)
  db.prepare(`INSERT INTO purchase_items (id,po_id,product_id,quantity,unit_cost,line_total,received_qty) VALUES ('rfq-pi','rfq-pending','rfq-milk',15,900,13500,0)`).run()
})

describe('automatic reorder plan', () => {
  it('lists only this supplier products with stock, incoming, sales and a recommended quantity', async () => {
    const plan = (await call('purchases:reorderPlan', SUP)).data
    const ids = plan.rows.map((r: any) => r.product_id)
    expect(ids).toEqual(expect.arrayContaining(['rfq-sugar', 'rfq-soap', 'rfq-milk']))
    expect(ids).not.toContain('rfq-other')
    const sugar = plan.rows.find((r: any) => r.product_id === 'rfq-sugar')
    // target = max(2×10, 10 + 1/day × 14) = 24 → 24 − 2 = 22
    expect(sugar).toMatchObject({ current_stock: 2, sold_quantity: 30, status: 'low', recommended_quantity: 22, auto_selected: true, estimated_cost: 250, last_purchase_price: null })
    const milk = plan.rows.find((r: any) => r.product_id === 'rfq-milk')
    expect(milk).toMatchObject({ status: 'out', incoming_quantity: 15, incoming_orders: ['PO-PEND'], recommended_quantity: 0, auto_selected: false })
    expect(plan.rows.find((r: any) => r.product_id === 'rfq-soap')).toMatchObject({ status: 'ok', auto_selected: false })
  })
})

describe('quotation → purchase order → receiving', () => {
  let quoteId = ''
  it('saves an RFQ draft without touching stock and stores remarks and new-item requests', async () => {
    const res = await call('purchases:saveQuotation', {
      supplier_id: SUP, delivery_requirements: 'Deliver before Friday 10am',
      lines: [{ product_id: 'rfq-sugar', quantity: 22, estimated_cost: 250, remarks: '50kg bags' }, { product_id: 'rfq-loose', quantity: 5, estimated_cost: 300, link_supplier: true }],
      requested_items: [{ name: 'Organic jaggery', quantity: 10, unit: 'kg' }],
    })
    expect(res.success, res.error).toBe(true)
    quoteId = res.data.id
    expect(res.data).toMatchObject({ status: 'DRAFT', is_quotation: 1, delivery_requirements: 'Deliver before Friday 10am' })
    expect(res.data.quotation_number).toMatch(/^RFQ-/)
    expect(stock('rfq-sugar')).toBe(2)
    const lines = db.prepare('SELECT product_id,remarks,price_confirmed FROM purchase_items WHERE po_id=? ORDER BY product_id').all(quoteId)
    expect(lines).toEqual([{ product_id: 'rfq-loose', remarks: null, price_confirmed: 0 }, { product_id: 'rfq-sugar', remarks: '50kg bags', price_confirmed: 0 }])
    expect(db.prepare('SELECT supplier_id FROM products WHERE id=?').get('rfq-loose')).toEqual({ supplier_id: SUP })
  })

  it('shares a supplier-facing WhatsApp request without any prices', async () => {
    const res = await call('purchases:shareQuotation', quoteId)
    expect(res.success, res.error).toBe(true)
    expect(hoisted.opened.at(-1)).toMatch(/^https:\/\/wa\.me\/94771234567\?text=/)
    const text = res.data.text as string
    expect(text).toContain('TK Fresh Choice')
    expect(text).toContain('Sugar (RFQ-SUGAR) - 22 kg - 50kg bags')
    expect(text).toContain('Organic jaggery (new item) - 10 kg')
    expect(text).not.toMatch(/Rs\.?|250|300|360/)
  })

  it('blocks duplicate ordering of a product already on a pending order unless a manager overrides', async () => {
    const dup = await call('purchases:saveQuotation', { supplier_id: SUP, lines: [{ product_id: 'rfq-milk', quantity: 5, estimated_cost: 900 }] })
    expect(dup.success).toBe(false)
    expect(String(dup.error)).toContain('PENDING_ORDER')
    storeData.auth_user = clerk
    const clerkOverride = await call('purchases:saveQuotation', { supplier_id: SUP, lines: [{ product_id: 'rfq-milk', quantity: 5, estimated_cost: 900, override_pending: true }] })
    storeData.auth_user = manager
    expect(clerkOverride.success).toBe(false)
    const managerOverride = await call('purchases:saveQuotation', { supplier_id: SUP, lines: [{ product_id: 'rfq-milk', quantity: 5, estimated_cost: 900, override_pending: true }] })
    expect(managerOverride.success, managerOverride.error).toBe(true)
  })

  it('refuses to convert before supplier prices are recorded, then converts and receives stock', async () => {
    const early = await call('purchases:updateStatus', quoteId, 'SENT', { open_whatsapp: false, send_email: false })
    expect(early.success).toBe(false)
    expect(String(early.error)).toMatch(/supplier-confirmed prices/)
    const confirmed = await call('purchases:confirmQuotationPrices', quoteId, [
      { product_id: 'rfq-sugar', quantity: 22, unit_cost: 240, free_quantity: 1, discount_amount: 100, remarks: '50kg bags' },
      { product_id: 'rfq-loose', quantity: 5, unit_cost: 290 },
    ])
    expect(confirmed.success, confirmed.error).toBe(true)
    expect(db.prepare('SELECT COUNT(*) n FROM purchase_items WHERE po_id=? AND price_confirmed=0').get(quoteId)).toEqual({ n: 0 })
    expect(stock('rfq-sugar')).toBe(2)
    expect((await call('purchases:updateStatus', quoteId, 'SENT', { open_whatsapp: false, send_email: false })).success).toBe(true)
    const items = db.prepare('SELECT id,product_id,quantity,received_qty FROM purchase_items WHERE po_id=?').all(quoteId) as any[]
    db.prepare(`INSERT INTO purchase_attachments (id,purchase_id,original_name,stored_name,relative_path,mime_type,file_size,uploaded_by) VALUES (?,?,?,?,?,?,?,?)`)
      .run('rfq-bill', quoteId, 'b.pdf', 'rfq-b.pdf', 'bills/rfq-b.pdf', 'application/pdf', 1, 'rfq-admin')
    const sugar = items.find(i => i.product_id === 'rfq-sugar')
    const received = await call('purchases:updateStatus', quoteId, 'PARTIAL', { items: [{ id: sugar.id, received_qty: sugar.quantity, already_received: 0, purchase_date: '2026-11-26' }] })
    expect(received.success, received.error).toBe(true)
    // 22 paid + 1 free
    expect(stock('rfq-sugar')).toBe(2 + 23)
  })

  it('keeps supplier-wise history with pending deliveries', async () => {
    const history = (await call('purchases:supplierHistory', SUP)).data as any[]
    const row = history.find(h => h.id === quoteId)
    expect(row).toMatchObject({ is_quotation: 1, status: 'PARTIAL', pending_quantity: 5 })
    expect(row.discount_total).toBe(100)
  })
})
