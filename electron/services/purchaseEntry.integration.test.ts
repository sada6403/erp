import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { repairMissingReceiptPrices } from './receiptProductPricing'
import { createStockPurchase as savePurchase, type StockPurchaseInput } from './purchaseEntry'

let db: Database.Database
const createStockPurchase: typeof savePurchase = (database, data, bills) => savePurchase(database,data,bills || (id=>{
 database.prepare('INSERT INTO purchase_attachments (id,purchase_id) VALUES (?,?)').run('bill-'+id,id)
}))
const input=(overrides:Partial<StockPurchaseInput>={}):StockPurchaseInput=>({id:'receipt1',poNumber:'PO-1',branchId:'main',supplierId:'supplier',purchaseType:'direct',purchaseDate:'2026-11-06',items:[{product_id:'rice',quantity:0.75,unit_cost:150,selling_price:250}],...overrides})
beforeEach(()=>{
 db=new Database(':memory:')
 db.exec(`CREATE TABLE suppliers(id TEXT PRIMARY KEY); INSERT INTO suppliers VALUES ('supplier');
 CREATE TABLE products(id TEXT PRIMARY KEY,cost_price REAL,selling_price REAL,updated_at TEXT); INSERT INTO products VALUES ('rice',99,200,NULL);
 CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_number TEXT,branch_id TEXT,supplier_id TEXT,purchase_type TEXT,status TEXT,purchase_date TEXT,supplier_invoice_number TEXT,expected_date TEXT,received_at TEXT,notes TEXT,total_amount REAL,created_by TEXT,UNIQUE(supplier_id,supplier_invoice_number));
 CREATE TABLE purchase_items(id TEXT PRIMARY KEY,po_id TEXT,product_id TEXT,quantity REAL,unit_cost REAL,line_total REAL,selling_price REAL,received_qty REAL);
 CREATE TABLE stocks(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,warehouse_id TEXT,quantity REAL,damaged_qty REAL DEFAULT 0,updated_at TEXT);
 CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,batch_number TEXT,expiry_date TEXT,quantity REAL,cost_price REAL,selling_price REAL,po_id TEXT,purchase_item_id TEXT,purchase_date TEXT,original_quantity REAL,sold_quantity REAL,returned_quantity REAL,damaged_quantity REAL,historical_cost_known INTEGER,status TEXT,created_by TEXT,notes TEXT,created_at TEXT DEFAULT (datetime('now')),updated_at TEXT);
 CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT,variant_id TEXT,from_branch_id TEXT,to_branch_id TEXT,quantity REAL,movement_type TEXT,reference_order_id TEXT,reference_transfer_id TEXT,reference_branch_transfer_id TEXT,notes TEXT,created_by TEXT,status TEXT);
 CREATE TABLE purchase_attachments(id TEXT PRIMARY KEY,purchase_id TEXT,is_active INTEGER DEFAULT 1);`)
})
afterEach(()=>db.close())
describe('two supermarket purchase entry workflows',()=>{
 it('direct receipt updates aggregate stock, fractional movement, batch cost and bill atomically',()=>{
  const row=createStockPurchase(db,input(),id=>db.prepare('INSERT INTO purchase_attachments (id,purchase_id) VALUES (?,?)').run('bill',id))
  expect(row.status).toBe('RECEIVED')
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:0.75})
  expect(db.prepare('SELECT quantity FROM stock_movements').get()).toEqual({quantity:0.75})
  expect(db.prepare('SELECT quantity,cost_price,selling_price,purchase_date FROM product_batches').get()).toEqual({quantity:0.75,cost_price:150,selling_price:250,purchase_date:'2026-11-06'})
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:150,selling_price:250})
  expect(db.prepare('SELECT purchase_id FROM purchase_attachments').get()).toEqual({purchase_id:'receipt1'})
 })
 it('purchase order saves products and bill but does not receive stock prematurely',()=>{
  const row=createStockPurchase(db,input({purchaseType:'order'}),id=>db.prepare('INSERT INTO purchase_attachments (id,purchase_id) VALUES (?,?)').run('bill',id))
  expect(row.status).toBe('DRAFT')
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
  expect(db.prepare('SELECT received_qty,selling_price FROM purchase_items').get()).toEqual({received_qty:0,selling_price:250})
  expect(db.prepare('SELECT COUNT(*) n FROM product_batches').get()).toEqual({n:0})
 })
 it('a repeated save reference does not duplicate inventory',()=>{
  createStockPurchase(db,input());createStockPurchase(db,input())
  expect(db.prepare('SELECT SUM(quantity) quantity FROM stocks').get()).toEqual({quantity:0.75})
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()).toEqual({n:1})
 })
 it('rolls back the purchase and stock when bill persistence fails',()=>{
  expect(()=>createStockPurchase(db,input(),()=>{throw new Error('Bill unavailable')})).toThrow('Bill unavailable')
  for(const table of ['purchase_orders','purchase_items','stocks','product_batches','stock_movements']) expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
 })
 it('rejects duplicate supplier invoice numbers without adding stock',()=>{
  createStockPurchase(db,input({invoiceNumber:'BILL-1'}))
  expect(()=>createStockPurchase(db,input({id:'receipt2',invoiceNumber:'BILL-1'}))).toThrow()
  expect(db.prepare('SELECT SUM(quantity) quantity FROM stocks').get()).toEqual({quantity:0.75})
 })
 it('rejects invalid quantities and preserves existing opening stock on receipt',()=>{
  expect(()=>createStockPurchase(db,input({items:[{product_id:'rice',quantity:Infinity,unit_cost:150}]}))).toThrow(/Quantity/)
  db.prepare('INSERT INTO stocks (id,product_id,branch_id,quantity) VALUES (?,?,?,?)').run('opening','rice','main',2)
  createStockPurchase(db,input())
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:2.75})
  expect(db.prepare('SELECT quantity FROM product_batches WHERE historical_cost_known=0').get()).toEqual({quantity:2})
 })
 it('keeps old batch costs when later receipts update the product prices',()=>{
  createStockPurchase(db,input())
  createStockPurchase(db,input({id:'receipt2',poNumber:'PO-2',items:[{product_id:'rice',quantity:2,unit_cost:200,selling_price:300}]}))
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:200,selling_price:300})
  expect(db.prepare('SELECT cost_price,selling_price FROM product_batches WHERE po_id=?').get('receipt1')).toEqual({cost_price:150,selling_price:250})
 })
 it('keeps a known common selling price when receipt selling price is blank',()=>{
  createStockPurchase(db,input({items:[{product_id:'rice',quantity:1,unit_cost:150,selling_price:null}]}))
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:150,selling_price:200})
 })
 it('rejects a received product with no entered or common selling price',()=>{
  db.prepare('UPDATE products SET selling_price=0').run()
  expect(()=>createStockPurchase(db,input({items:[{product_id:'rice',quantity:1,unit_cost:150,selling_price:null}]}))).toThrow(/Enter a selling price/)
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
  expect(db.prepare('SELECT cost_price FROM products').get()).toEqual({cost_price:99})
 })
 it('repairs missing product prices from saved receipts without changing stock or known prices',()=>{
  createStockPurchase(db,input())
  db.prepare('UPDATE products SET cost_price=0,selling_price=0').run()
  expect(db.transaction(()=>repairMissingReceiptPrices(db,'receipt1'))()).toHaveLength(1)
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:150,selling_price:250})
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:0.75})
  db.prepare('UPDATE products SET cost_price=180,selling_price=350').run()
  expect(repairMissingReceiptPrices(db,'receipt1')).toHaveLength(0)
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:180,selling_price:350})
 })
 it('keeps product prices unchanged for an unreceived draft order and on receipt rollback',()=>{
  createStockPurchase(db,input({purchaseType:'order'}))
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:99,selling_price:200})
  expect(()=>createStockPurchase(db,input({id:'failed'}),()=>{throw new Error('bill failed')})).toThrow('bill failed')
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:99,selling_price:200})
 })

 it.each(['direct','order'] as const)('requires a supplier bill for a %s purchase and rolls back every change',purchaseType=>{
  expect(()=>savePurchase(db,input({purchaseType}))).toThrow(/Supplier bill upload is required/)
  for(const table of ['purchase_orders','purchase_items','stocks','product_batches','stock_movements']) expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
  expect(db.prepare('SELECT cost_price FROM products').get()).toEqual({cost_price:99})
 })
 it('does not accept a no-op upload callback as a bill',()=>{
  expect(()=>savePurchase(db,input(),()=>{})).toThrow(/Supplier bill upload is required/)
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
 })

})
