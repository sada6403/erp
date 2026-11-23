import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { createHash } from 'crypto'
import { createRequire } from 'module'
import { scanProductNames, nameScanCsv } from './productNameScan'
import { resolveInvoiceHtml, type InvoicePayload } from '../templates/invoiceTemplates'

const { parseArguments, runScan } = createRequire(path.resolve('package.json'))('./scripts/scan-product-names.cjs')
const native = '\u0b85\u0bb0\u0bbf\u0b9a\u0bbf'
let directory: string, filename: string
const hash = () => createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'name-scan-phase1-'))
  filename = path.join(directory, 'staging.db')
  const db = new Database(filename)
  db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,sku TEXT,name TEXT,is_active INTEGER);
    CREATE TABLE invoices(id TEXT PRIMARY KEY,total REAL);
    CREATE TABLE invoice_items(id TEXT PRIMARY KEY,invoice_id TEXT,product_id TEXT,quantity REAL);
    CREATE TABLE stocks(product_id TEXT,quantity REAL);
    INSERT INTO invoices VALUES ('old-invoice',200);
    INSERT INTO invoice_items VALUES ('old-line','old-invoice','rice',2);
    INSERT INTO stocks VALUES ('rice',20);`)
  const insert = db.prepare('INSERT INTO products VALUES (?,?,?,?)')
  insert.run('rice','RICE',`Rice (${native})`,1)
  insert.run('soap','SOAP','Baby Soap (Pink)',1)
  insert.run('lost','LOST','Milk (??\ufffd)',0)
  db.close()
})
afterEach(() => {
  if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('name-scan-phase1-')) throw new Error('Unsafe test cleanup path')
  fs.rmSync(directory, { recursive: true, force: true })
})

describe('Phase 1 read-only product name scan', () => {
  it('creates idempotent proposals without changing products, stock, historical bills or the file hash', () => {
    const before = hash()
    const db = new Database(filename, { readonly: true, fileMustExist: true })
    try {
      const first = scanProductNames(db, { generatedAt: '2026-11-23T00:00:00Z' })
      expect(scanProductNames(db, { generatedAt: first.generated_at })).toEqual(first)
      expect(first.summary).toMatchObject({ scannedProducts: 3, activeProducts: 2, reviewRows: 2, tamilNames: 1, replacementCharacterNames: 1 })
      expect(first.rows.find(row => row.id === 'rice')).toMatchObject({ original_name: `Rice (${native})`, proposed_name: 'Rice', proposed_keywords: [native] })
      expect(first.rows.find(row => row.id === 'lost')?.proposed_keywords).toEqual([])
      expect(db.prepare('SELECT name FROM products WHERE id=?').get('rice')).toEqual({ name: `Rice (${native})` })
      expect(db.prepare('SELECT * FROM stocks').all()).toEqual([{ product_id: 'rice', quantity: 20 }])
      expect(db.prepare('SELECT * FROM invoices').all()).toEqual([{ id: 'old-invoice', total: 200 }])
      expect(db.prepare('SELECT * FROM invoice_items').all()).toEqual([{ id: 'old-line', invoice_id: 'old-invoice', product_id: 'rice', quantity: 2 }])
    } finally { db.close() }
    expect(hash()).toBe(before)
  })
  it('refuses writable database connections even when the caller merely asks for proposals', () => {
    const db = new Database(filename)
    try { expect(() => scanProductNames(db)).toThrow(/read-only/) } finally { db.close() }
  })
  it('repairs encoded native-name proposals in the real Electron runtime without modifying the master', () => {
    const garbled = new TextDecoder('windows-1252', { ignoreBOM: true }).decode(new TextEncoder().encode(native))
    const write = new Database(filename)
    write.prepare('INSERT INTO products VALUES (?,?,?,?)').run('garbled','BAD',`Rice (${garbled})`,1)
    write.close()
    const before = hash()
    const read = new Database(filename, { readonly: true })
    try {
      expect(scanProductNames(read).rows.find(row => row.id === 'garbled')).toMatchObject({ proposed_name: 'Rice', proposed_keywords: [native] })
    } finally { read.close() }
    expect(hash()).toBe(before)
  })
  it('requires explicit staging selection, rejects apply mode, and refuses report overwrite', () => {
    expect(() => parseArguments(['--db',filename])).toThrow(/staging/)
    expect(() => parseArguments(['--staging-copy','--db',filename,'--apply'])).toThrow(/no apply/)
    expect(() => runScan({ stagingCopy: false, db: filename })).toThrow(/staging/)
    const output = path.join(directory, 'review.json')
    const result = runScan(parseArguments(['--staging-copy','--db',filename,'--output',output]), { scanProductNames, nameScanCsv })
    expect(JSON.parse(fs.readFileSync(output, 'utf8')).audit.database_mode).toBe('read-only')
    expect(result.report.dry_run).toBe(true)
    expect(() => runScan({ stagingCopy: true, db: filename, output }, { scanProductNames, nameScanCsv })).toThrow(/overwrite/)
    expect(() => runScan({ stagingCopy: true, db: filename, output: filename }, { scanProductNames, nameScanCsv })).toThrow()
  })
  it('writes a UTF-8 BOM review CSV without altering raw JSON values or evaluating formulas', () => {
    const db = new Database(filename)
    db.prepare('INSERT INTO products VALUES (?,?,?,?)').run('formula','FORMULA',`=SUM(1) (${native})`,1)
    db.close()
    const read = new Database(filename, { readonly: true })
    try {
      const report = scanProductNames(read)
      const csv = nameScanCsv(report)
      expect(Buffer.from(csv).subarray(0,3)).toEqual(Buffer.from([0xef,0xbb,0xbf]))
      expect(csv).toContain(`"'=SUM(1)`)
      expect(report.rows.find(row => row.id === 'formula')?.original_name).toBe(`=SUM(1) (${native})`)
      expect(csv).toContain(native)
    } finally { read.close() }
  })
  it('does not change the existing historical receipt HTML when a scan proposes another master name', async () => {
    const db = new Database(filename, { readonly: true })
    try {
      const payload = (): InvoicePayload => ({ invoice_number: 'OLD-1', invoice_date: '2026-11-01 12:00',
        items: [{ product_name: (db.prepare('SELECT name FROM products WHERE id=?').get('rice') as { name: string }).name, sku: 'RICE', quantity: 2, unit_price: 100, line_total: 200 }],
        subtotal: 200, discount_amount: 0, tax_amount: 0, total_amount: 200, paid_amount: 200, change_amount: 0, payment_method: 'cash' })
      const settings = { company_name: 'Test Shop', invoice_design: 'thermal' }
      const before = await resolveInvoiceHtml(payload(), settings, 'thermal')
      expect(scanProductNames(db).rows.find(row => row.id === 'rice')?.proposed_name).toBe('Rice')
      expect(await resolveInvoiceHtml(payload(), settings, 'thermal')).toBe(before)
      expect(before).toContain(native) // Historical output remains unchanged, not silently sanitized.
    } finally { db.close() }
  })
})
