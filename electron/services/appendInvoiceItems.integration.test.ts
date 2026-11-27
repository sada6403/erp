import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('../ipc/discounts', () => ({ resolveApplicableDiscount: () => ({ pct: 10 }) }))
vi.mock('./auditLog', () => ({ logAudit: vi.fn() }))
vi.mock('./commissionEngine', () => ({ computeAndRecordCommission: vi.fn() }))
import { appendInvoiceItems } from './appendInvoiceItems'
let db: Database.Database
const user = { id: 'cashier', branch_id: 'main', permissions: {} }
const payload = () => ({ expected_total: 100, expected_item_count: 1, method: 'cash', received: 250, items: [{ product_id: 'p', quantity: 2, unit_price: 100 }] })
beforeEach(() => {
  db = new Database(':memory:')
  db.exec(`
    CREATE TABLE invoices(id TEXT PRIMARY KEY,invoice_number TEXT,branch_id TEXT,status TEXT,bill_type TEXT,locked_at TEXT,source_order_id TEXT,due_amount REAL,total_amount REAL,paid_amount REAL,subtotal REAL,discount_amount REAL,tax_amount REAL,agent_id TEXT,agent_commission_amount REAL,agent_commission_pct REAL,updated_at TEXT);
    INSERT INTO invoices VALUES('bill','INV-1','main','completed','RETAIL',NULL,NULL,0,100,100,100,0,0,NULL,0,0,NULL);
    CREATE TABLE products(id TEXT PRIMARY KEY,is_active INTEGER,selling_price REAL,tax_rate REAL); INSERT INTO products VALUES('p',1,100,0);
    CREATE TABLE stocks(id TEXT,product_id TEXT,branch_id TEXT,quantity REAL,damaged_qty REAL,updated_at TEXT); INSERT INTO stocks VALUES('s','p','main',10,0,NULL);
    CREATE TABLE returns(invoice_id TEXT,status TEXT);
    CREATE TABLE invoice_items(id TEXT PRIMARY KEY,invoice_id TEXT,product_id TEXT,variant_id TEXT,variant_title TEXT,quantity REAL,unit_price REAL,discount_pct REAL,discount_amount REAL,tax_rate REAL,tax_amount REAL,line_total REAL);
    INSERT INTO invoice_items VALUES('original','bill','p',NULL,NULL,1,100,0,0,0,0,100);
    CREATE TABLE payments(id TEXT PRIMARY KEY,invoice_id TEXT,method TEXT,amount REAL,reference TEXT,received_by TEXT); INSERT INTO payments VALUES('old-payment','bill','cash',100,NULL,'cashier');
    CREATE TABLE stock_movements(id TEXT,product_id TEXT,variant_id TEXT,from_branch_id TEXT,to_branch_id TEXT,quantity REAL,movement_type TEXT,reference_order_id TEXT,reference_transfer_id TEXT,reference_branch_transfer_id TEXT,notes TEXT,created_by TEXT,status TEXT);
  `)
})
afterEach(() => db.close())
describe('add extra products to a paid bill', () => {
  it('keeps the original lines and number, takes only extra payment and deducts extra stock once', () => {
    const result = appendInvoiceItems(db, user, {}, 'bill', payload())
    expect(result.result).toMatchObject({ invoice_number: 'INV-1', extra_amount: 200, change: 50 })
    expect(db.prepare('SELECT total_amount,paid_amount FROM invoices').get()).toEqual({ total_amount: 300, paid_amount: 300 })
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 8 })
    expect(db.prepare('SELECT * FROM invoice_items WHERE id=?').get('original')).toMatchObject({ quantity: 1, line_total: 100 })
    expect(db.prepare('SELECT SUM(amount) AS amount FROM payments').get()).toEqual({ amount: 300 })
    expect(() => appendInvoiceItems(db, user, {}, 'bill', payload())).toThrow('changed')
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 8 })
  })
  it.each(['underpayment', 'insufficient stock', 'invalid price', 'wrong branch', 'locked', 'returns'])('rolls back all writes on %s', reason => {
    const data = payload()
    if (reason === 'underpayment') data.received = 1
    if (reason === 'insufficient stock') data.items[0].quantity = 20
    if (reason === 'invalid price') data.items[0].unit_price = 1
    if (reason === 'locked') db.exec("UPDATE invoices SET locked_at='today'")
    if (reason === 'returns') db.exec("INSERT INTO returns VALUES('bill','completed')")
    expect(() => appendInvoiceItems(db, reason === 'wrong branch' ? { ...user, branch_id: 'other' } : user, {}, 'bill', data)).toThrow()
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 10 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM invoice_items').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM payments').get()).toEqual({ count: 1 })
    expect(db.prepare('SELECT total_amount FROM invoices').get()).toEqual({ total_amount: 100 })
  })
  it('prevents retrying free item additions even though the bill total has not changed', () => {
    db.exec('UPDATE products SET selling_price=0')
    const data = payload(); data.items[0].unit_price = 0
    appendInvoiceItems(db, user, {}, 'bill', data)
    expect(() => appendInvoiceItems(db, user, {}, 'bill', data)).toThrow('changed')
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 8 })
  })
})
