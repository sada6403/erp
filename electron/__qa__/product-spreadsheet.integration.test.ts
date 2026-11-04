import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import * as XLSX from 'xlsx'

const state = vi.hoisted(() => ({
  handlers: new Map<string, (...args: any[]) => any>(),
  settings: {} as Record<string, unknown>,
  openPath: '', savePath: '',
}))
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'product-spreadsheet-'))
vi.mock('electron', () => ({
  app: { getPath: () => temp, isPackaged: false },
  ipcMain: { handle: (name: string, handler: (...args: any[]) => any) => state.handlers.set(name, handler), on: () => {} },
  dialog: {
    showOpenDialog: async () => ({ canceled: false, filePaths: [state.openPath] }),
    showSaveDialog: async () => ({ canceled: false, filePath: state.savePath }),
  },
  net: { request: () => { throw new Error('No network in spreadsheet QA') } },
  BrowserWindow: { getAllWindows: () => [] },
  safeStorage: { isEncryptionAvailable: () => false },
}))
vi.mock('electron-store', () => ({ default: class {
  get(key: string, fallback?: unknown) { return state.settings[key] ?? fallback }
  set(key: string, value: unknown) { state.settings[key] = value }
  delete(key: string) { delete state.settings[key] }
} }))
vi.mock('../services/syncService', () => ({ getSyncService: () => ({ runSoon() {} }) }))

let db: import('better-sqlite3').Database
const branchId = 'b1111111-1111-4111-8111-111111111111'
async function call(channel: string, ...args: unknown[]) {
  const handler = state.handlers.get(channel)
  if (!handler) throw new Error(`Missing handler ${channel}`)
  return handler({}, ...args)
}
async function importRows(rows: Record<string, unknown>[], strategy = 'override') {
  const book = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Products')
  state.openPath = path.join(temp, 'import.xlsx')
  XLSX.writeFile(book, state.openPath)
  return call('products:importExcel', { duplicateStrategy: strategy })
}
beforeAll(async () => {
  const { initDatabase, getDb } = await import('../database')
  await initDatabase()
  db = getDb()
  db.prepare('INSERT INTO branches (id, name, is_active) VALUES (?, ?, 1)').run('qa-template-nedunkerny', 'NEDUNKERNY')
  state.settings.app_settings = { business_type: 'furniture' }
  state.settings.auth_user = { id: 'u9999999-9999-4999-8999-999999999999', branch_id: branchId, permissions: { all: true } }
  const { registerProductHandlers } = await import('../ipc/products')
  registerProductHandlers({ handle: (name: string, handler: any) => state.handlers.set(name, handler) } as any)
})
afterAll(() => { db?.close() })

describe('furniture full product spreadsheet', () => {
  it('downloads full product details and dynamic branch stock columns, with text barcodes', async () => {
    state.savePath = path.join(temp, 'template.xlsx')
    expect((await call('products:downloadTemplate')).success).toBe(true)
    const book = XLSX.readFile(state.savePath)
    const sheet = book.Sheets.Products
    const headers = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] as string[]
    expect(headers).toEqual(['Product Name', 'SKU', 'Category', 'Cost Price', 'Selling Price', 'Stock (Main Branch)', 'Stock (NEDUNKERNY)', 'Discount Percentage', 'Barcode', 'Supplier', 'Unit', 'Tax Rate', 'Min Stock Level', 'Description'])
    expect(sheet[XLSX.utils.encode_cell({ r: 1, c: headers.indexOf('Barcode') })].t).toBe('s')
    expect(book.SheetNames).toEqual(['Products', 'Instructions'])
  })

  it('saves complete product fields, creates supplier, and syncs values with branch stock', async () => {
    const result = await importRows([{
      'Product Name': 'QA Furniture Sofa', SKU: 'QA-SOFA', Category: 'Furniture',
      'Cost Price': 5000, 'Selling Price': 7500, 'Wholesale Price': 6500,
      'Stock (Main Branch)': 6, 'Discount Percentage': 5, Barcode: '0012345678901',
      Supplier: 'QA Furniture Supplier', Unit: 'pcs', 'Tax Rate': 8, 'Min Stock Level': 0,
      Description: 'Three-seat sofa', Brand: 'QA Brand', 'Short Name': 'SOFA', ISBN: '00123',
      'Rack No': 'R2', Weight: 12.5, 'Image URL': 'https://example.invalid/sofa.jpg',
      'Not For Sale': 'No', 'Enable EMI': 'Yes', 'Manage Stock': 'Yes', 'Fast Product': 'Yes',
      'Sale As Latest Price': 'No', 'Sale By': 'normal', 'Employee Commission': 2,
      'Commission Type': 'percent', 'Custom Field 1': 'Wood', 'Custom Field 2': 'Brown',
      'Custom Field 3': 'Large', 'Is Active': 'Yes', 'Stock Date': '16/09/2026',
    }])
    expect(result.success).toBe(true)
    expect(result.data.errors).toEqual([])
    const product = db.prepare('SELECT * FROM products WHERE sku=?').get('QA-SOFA') as Record<string, unknown>
    expect(product).toMatchObject({ name: 'QA Furniture Sofa', brand: 'QA Brand', wholesale_price: 6500, barcode: '0012345678901', min_stock_level: 0, alert_qty: 0, weight: 12.5, enable_emi: 1, fast_product: 1, employee_commission: 2, commission_type: 'percent', sort_name: 'SOFA', isbn: '00123', rack_no: 'R2', custom_field1: 'Wood', custom_field2: 'Brown', custom_field3: 'Large' })
    expect(db.prepare('SELECT name FROM suppliers WHERE id=?').get(product.supplier_id)).toEqual({ name: 'QA Furniture Supplier' })
    expect(db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(product.id, branchId)).toEqual({ quantity: 6 })
    const sync = db.prepare("SELECT payload FROM sync_queue WHERE table_name='products' AND record_id=?").get(product.id) as { payload: string }
    expect(JSON.parse(sync.payload)).toMatchObject({ brand: 'QA Brand', wholesale_price: 6500, enable_emi: 1 })
  })

  it('imports the downloaded workbook itself and ignores its instruction sheet', async () => {
    state.openPath = state.savePath
    const result = await call('products:importExcel', { duplicateStrategy: 'override' })
    expect(result.success).toBe(true)
    expect(result.data.errors).toEqual([])
    expect(result.data.imported).toBe(2)
    expect(db.prepare('SELECT selling_price FROM products WHERE sku=?').get('C001')).toEqual({ selling_price: 7500 })
    expect(db.prepare('SELECT selling_price FROM products WHERE sku=?').get('T001')).toEqual({ selling_price: 15000 })
  })

  it('continues accepting the original six-column sheet and holds unknown branches pending', async () => {
    const result = await importRows([{ Branch: 'QA NEW FURNITURE BRANCH', 'Stock Date': '16/09/2026', 'Item Code': 'QA-BED', Description: 'QA Furniture Bed', Qty: 9, 'Sale Price': 36900 }])
    expect(result.data.errors).toEqual([])
    const product = db.prepare('SELECT * FROM products WHERE sku=?').get('QA-BED') as Record<string, unknown>
    expect(product.selling_price).toBe(36900)
    expect(db.prepare('SELECT quantity, branch_name FROM pending_branch_stocks WHERE product_id=?').get(product.id)).toEqual({ quantity: 9, branch_name: 'QA NEW FURNITURE BRANCH' })
  })

  it('preserves optional existing fields on fill-empty and accepts explicit zeros on override', async () => {
    const row = { 'Product Name': 'QA Furniture Sofa', SKU: 'QA-SOFA', Brand: 'Updated Brand', 'Wholesale Price': 0, 'Enable EMI': 'No' }
    expect((await importRows([row], 'fill_empty')).data.errors).toEqual([])
    expect(db.prepare('SELECT brand, wholesale_price, enable_emi FROM products WHERE sku=?').get('QA-SOFA')).toEqual({ brand: 'QA Brand', wholesale_price: 6500, enable_emi: 1 })
    expect((await importRows([row], 'override')).data.errors).toEqual([])
    expect(db.prepare('SELECT brand, wholesale_price, enable_emi FROM products WHERE sku=?').get('QA-SOFA')).toEqual({ brand: 'Updated Brand', wholesale_price: 0, enable_emi: 0 })
  })

  it('does not use a stock date as quantity when stock cells are blank', async () => {
    const result = await importRows([{ 'Product Name': 'QA No Stock', SKU: 'QA-NOSTOCK', 'Stock (Main Branch)': '', 'Stock Date': '16/09/2026', Branch: '', Qty: '' }])
    expect(result.data.errors).toEqual([])
    const product = db.prepare('SELECT id FROM products WHERE sku=?').get('QA-NOSTOCK') as { id: string }
    expect(db.prepare('SELECT COUNT(*) AS count FROM stocks WHERE product_id=?').get(product.id)).toEqual({ count: 0 })
  })

  it('rejects invalid product options before creating the product', async () => {
    const result = await importRows([{ 'Product Name': 'QA Invalid', SKU: 'QA-INVALID', 'Enable EMI': 'maybe' }])
    expect(result.data.errors[0]).toMatch(/Enable EMI must be/)
    expect(db.prepare('SELECT id FROM products WHERE sku=?').get('QA-INVALID')).toBeUndefined()
  })
})

describe('furniture import mapping preview', () => {
  async function open(rows: Record<string, unknown>[]) {
    const book = XLSX.utils.book_new()
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet([{ Branch: 'Summary', Units: 999 }]), 'Branch Summary')
    XLSX.utils.book_append_sheet(book, XLSX.utils.json_to_sheet(rows), 'Consolidated Stock')
    state.openPath = path.join(temp, 'preview.xlsx')
    XLSX.writeFile(book, state.openPath)
    const response = await call('products:importPreview:open')
    expect(response.success).toBe(true)
    expect(response.data.selectedSheet).toBe('Consolidated Stock')
    return response.data
  }
  const request = (file: any, extra: Record<string, unknown> = {}) => ({ sessionId: file.sessionId, sheetName: file.selectedSheet, headerRow: file.headerRow, mapping: file.mapping, duplicateStrategy: 'override', ...extra })

  it('previews explicit custom mappings without writes and imports exactly once after confirmation', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM products').get()
    const file = await open([{ Outlet: 'Main Branch', Model: 'PREVIEW-01', Title: 'Preview Armchair', Buy: 120, MRP: 250, Available: 3, Recorded: '16/09/2026' }])
    expect(db.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual(before)
    const mapping = { ...file.mapping, Branch: 0, SKU: 1, 'Product Name': 2, 'Cost Price': 3, 'Selling Price': 4, Qty: 5, 'Stock Date': 6 }
    const preview = await call('products:importPreview:review', request(file, { mapping }))
    expect(preview.data.errors).toEqual([])
    expect(preview.data.branches).toEqual([expect.objectContaining({ name: 'Main Branch', fileQty: 3, importQty: 3, exists: true })])
    expect(db.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual(before)
    const saved = await call('products:importExcel', { reviewId: preview.data.reviewId })
    expect(saved.success).toBe(true)
    expect(saved.data.errors).toEqual([])
    const product = db.prepare('SELECT id, cost_price, selling_price FROM products WHERE sku=?').get('PREVIEW-01') as any
    expect(product).toMatchObject({ cost_price: 120, selling_price: 250 })
    expect(db.prepare('SELECT quantity FROM stocks WHERE product_id=? AND branch_id=?').get(product.id, branchId)).toEqual({ quantity: 3 })
    expect((await call('products:importExcel', { reviewId: preview.data.reviewId })).success).toBe(false)
  })

  it('blocks duplicate branch/product rows and missing or invalid data before writes', async () => {
    const before = db.prepare('SELECT COUNT(*) AS count FROM products').get()
    const file = await open([
      { Branch: 'Main Branch', SKU: 'PREVIEW-DUP', 'Product Name': 'Preview Duplicate', Qty: 2, 'Selling Price': 50 },
      { Branch: 'Main Branch', SKU: 'PREVIEW-DUP', 'Product Name': 'Preview Duplicate', Qty: 3, 'Selling Price': 50 },
      { Branch: 'Main Branch', SKU: '', 'Product Name': 'Missing Code', Qty: -2, 'Selling Price': 'invalid' },
    ])
    const preview = await call('products:importPreview:review', request(file))
    expect(preview.data.reviewId).toBeUndefined()
    expect(preview.data.errors.map((issue: any) => issue.message).join(' ')).toMatch(/Repeated PREVIEW-DUP/)
    expect(preview.data.errors.some((issue: any) => issue.field === 'SKU')).toBe(true)
    expect(preview.data.errors.some((issue: any) => issue.field === 'Selling Price')).toBe(true)
    expect(db.prepare('SELECT COUNT(*) AS count FROM products').get()).toEqual(before)
  })

  it('shows wide branch totals and keeps unknown branches pending after confirmation', async () => {
    const file = await open([{ SKU: 'PREVIEW-WIDE', 'Product Name': 'Preview Wide Table', 'Selling Price': 300, 'Cost Price': 200, 'Stock (Main Branch)': 2, 'Stock (NEDUNKERNY)': 4, 'Stock (PREVIEW UNKNOWN)': 7 }])
    const preview = await call('products:importPreview:review', request(file))
    expect(preview.data.errors).toEqual([])
    expect(preview.data.branches.reduce((sum: number, branch: any) => sum + branch.fileQty, 0)).toBe(13)
    expect(preview.data.branches.find((branch: any) => branch.name === 'PREVIEW UNKNOWN')).toMatchObject({ exists: false, importQty: 7 })
    expect((await call('products:importExcel', { reviewId: preview.data.reviewId })).data.errors).toEqual([])
    const product = db.prepare('SELECT id FROM products WHERE sku=?').get('PREVIEW-WIDE') as any
    expect(db.prepare('SELECT quantity FROM pending_branch_stocks WHERE product_id=?').get(product.id)).toEqual({ quantity: 7 })
    expect(db.prepare('SELECT SUM(quantity) AS quantity FROM stocks WHERE product_id=?').get(product.id)).toEqual({ quantity: 6 })
  })

  it('requires a chosen branch for generic quantities and reports stock preserved by fill-empty', async () => {
    const file = await open([{ SKU: 'PREVIEW-01', 'Product Name': 'Preview Armchair', Qty: 9 }])
    const invalid = await call('products:importPreview:review', request(file))
    expect(invalid.data.errors.some((issue: any) => issue.field === 'Branch')).toBe(true)
    const preview = await call('products:importPreview:review', request(file, { defaultBranchId: branchId, duplicateStrategy: 'fill_empty' }))
    expect(preview.data.errors).toEqual([])
    expect(preview.data.branches[0]).toMatchObject({ fileQty: 9, importQty: 0, preservedRows: 1 })
  })

  it('does not leak an ignored purchase price into the sale price or merge matching names with other SKUs', async () => {
    const file = await open([{ SKU: 'PREVIEW-OTHER-MODEL', 'Product Name': 'Preview Armchair', 'Cost Price': 99 }])
    const preview = await call('products:importPreview:review', request(file))
    expect(preview.data.errors).toEqual([])
    expect(preview.data.warnings.some((issue: any) => issue.field === 'Selling Price')).toBe(true)
    expect((await call('products:importExcel', { reviewId: preview.data.reviewId })).data.errors).toEqual([])
    expect(db.prepare('SELECT selling_price FROM products WHERE sku=?').get('PREVIEW-OTHER-MODEL')).toEqual({ selling_price: 0 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM products WHERE name=?').get('Preview Armchair')).toEqual({ count: 2 })
  })

  it('rejects stale previews before any import and permits a fresh review', async () => {
    const file = await open([{ SKU: 'PREVIEW-STALE', 'Product Name': 'Preview Stale', 'Selling Price': 200 }])
    const preview = await call('products:importPreview:review', request(file))
    db.prepare('UPDATE products SET cost_price=cost_price+1 WHERE sku=?').run('PREVIEW-01')
    const result = await call('products:importExcel', { reviewId: preview.data.reviewId })
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/changed after this preview/)
    expect(db.prepare('SELECT id FROM products WHERE sku=?').get('PREVIEW-STALE')).toBeUndefined()
    const fresh = await call('products:importPreview:review', request(file))
    expect(fresh.data.reviewId).toBeTruthy()
    expect(fresh.data.reviewId).not.toBe(preview.data.reviewId)
  })

  it('keeps confirmed mapping snapshots independent of later source-file edits and honors zeros on override', async () => {
    const file = await open([{ SKU: 'PREVIEW-01', 'Product Name': 'Preview Armchair', 'Selling Price': 0, 'Cost Price': 0, 'Min Stock Level': 0 }])
    const preview = await call('products:importPreview:review', request(file))
    fs.writeFileSync(state.openPath, 'source changed after review')
    const result = await call('products:importExcel', { reviewId: preview.data.reviewId })
    expect(result.data.errors).toEqual([])
    expect(db.prepare('SELECT cost_price, selling_price, min_stock_level FROM products WHERE sku=?').get('PREVIEW-01')).toEqual({ cost_price: 0, selling_price: 0, min_stock_level: 0 })
  })

  it('invalidates canceled sessions and restricts preview to furniture companies', async () => {
    const file = await open([{ SKU: 'PREVIEW-CANCELED', 'Product Name': 'Preview Canceled' }])
    await call('products:importPreview:cancel', file.sessionId)
    expect((await call('products:importPreview:review', request(file))).success).toBe(false)
    state.settings.app_settings = { business_type: 'retail' }
    try { expect((await call('products:importPreview:open')).success).toBe(false) }
    finally { state.settings.app_settings = { business_type: 'furniture' } }
  })
})
