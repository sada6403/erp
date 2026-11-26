import Database from 'better-sqlite3'
import { beforeEach, afterEach, describe, expect, it } from 'vitest'
import { repairMissingReceiptPrices } from './receiptProductPricing'
import { requireSavedPurchaseBill } from './purchaseBills'
import { createStockPurchase as savePurchase, replaceDraftPurchase, type StockPurchaseInput } from './purchaseEntry'
import {migrateSupermarketPurchases} from './supermarketSchema'

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
 CREATE TABLE purchase_attachments(id TEXT PRIMARY KEY,purchase_id TEXT,is_active INTEGER DEFAULT 1);
 CREATE TABLE sync_stock_baselines(record_id TEXT,quantity REAL,damaged_qty REAL);
 CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,failure_cycles INTEGER DEFAULT 0,next_retry_at TEXT,last_error TEXT);`)
 db.exec('CREATE TABLE product_uom(product_id TEXT,uom_name TEXT,conversion_factor REAL,is_base INTEGER)')
 migrateSupermarketPurchases(db)
})
afterEach(()=>db.close())
describe('two supermarket purchase entry workflows',()=>{
 it('requires expiry dates only for expiry-tracked received stock',()=>{
  db.exec('ALTER TABLE products ADD COLUMN track_expiry INTEGER DEFAULT 0')
  db.prepare('UPDATE products SET track_expiry=1').run()
  expect(()=>createStockPurchase(db,input())).toThrow(/Expiry date is required/)
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
  expect(()=>createStockPurchase(db,input({purchaseType:'order'}))).not.toThrow()
 })
 it('edits free quantities, discounts and MRP on a draft without receiving stock and queues removed lines',()=>{
  createStockPurchase(db,input({purchaseType:'order'}))
  const old=db.prepare('SELECT id FROM purchase_items').get() as {id:string}
  replaceDraftPurchase(db,'receipt1','main',{items:[{product_id:'rice',quantity:10,free_quantity:2,unit_cost:100,discount_amount:100,selling_price:150,mrp:180}]})
  expect(db.prepare('SELECT quantity,free_quantity,line_total,mrp FROM purchase_items').get()).toEqual({quantity:12,free_quantity:2,line_total:900,mrp:180})
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
  expect(db.prepare('SELECT operation FROM sync_queue WHERE record_id=?').get(old.id)).toEqual({operation:'DELETE'})
 })
 it('receives free units, applies the line discount and posts supplier debt exactly once',()=>{
  const data=input({items:[{product_id:'rice',quantity:10,free_quantity:2,unit_cost:100,discount_amount:100,selling_price:150,mrp:180}]})
  createStockPurchase(db,data);createStockPurchase(db,data)
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:12})
  expect(db.prepare('SELECT paid_quantity,free_quantity,discount_amount,purchase_unit_cost,unit_cost,line_total,mrp FROM purchase_items').get()).toEqual({paid_quantity:10,free_quantity:2,discount_amount:100,purchase_unit_cost:100,unit_cost:75,line_total:900,mrp:180})
  expect(db.prepare('SELECT cost_price,mrp FROM product_batches').get()).toEqual({cost_price:75,mrp:180})
  expect(db.prepare('SELECT total_amount,outstanding_amount FROM purchase_orders').get()).toEqual({total_amount:900,outstanding_amount:900})
  expect(db.prepare('SELECT due_balance FROM suppliers').get()).toEqual({due_balance:900})
 })
 it('keeps a free-stock draft from changing inventory and supplier debt',()=>{
  createStockPurchase(db,input({purchaseType:'order',items:[{product_id:'rice',quantity:10,free_quantity:2,unit_cost:100,discount_amount:100,mrp:250}]}))
  expect(db.prepare('SELECT due_balance FROM suppliers').get()).toEqual({due_balance:0})
  expect(db.prepare('SELECT quantity,free_quantity,received_qty FROM purchase_items').get()).toEqual({quantity:12,free_quantity:2,received_qty:0})
 })
 it.each([{free_quantity:-1},{discount_amount:200},{mrp:100}])('rejects invalid free quantity, discount or MRP before inventory writes: %j',extra=>{
  expect(()=>createStockPurchase(db,input({items:[{product_id:'rice',quantity:1,unit_cost:100,selling_price:150,...extra}]}))).toThrow()
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
 })
 it('coalesces unsent stock snapshots while retaining the cloud stock baseline',()=>{
  createStockPurchase(db,input())
  const stock=db.prepare('SELECT id FROM stocks').get() as {id:string}
  db.prepare('INSERT INTO sync_stock_baselines VALUES(?,?,?)').run(stock.id,0,0)
  createStockPurchase(db,input({id:'receipt2',poNumber:'PO-2'}))
  const rows=db.prepare("SELECT payload FROM sync_queue WHERE table_name='stocks'").all() as {payload:string}[]
  expect(rows).toHaveLength(1)
  expect(JSON.parse(rows[0].payload)).toMatchObject({quantity:1.5,_base_stock:{quantity:0,damaged_qty:0}})
 })
 it('keeps an in-flight stock event immutable and queues a newer receipt separately',()=>{
  createStockPurchase(db,input())
  db.prepare("UPDATE sync_queue SET status='processing' WHERE table_name='stocks'").run()
  createStockPurchase(db,input({id:'receipt2',poNumber:'PO-2'}))
  const rows=db.prepare("SELECT status,payload FROM sync_queue WHERE table_name='stocks' ORDER BY rowid").all() as {status:string;payload:string}[]
  expect(rows.map(row=>[row.status,JSON.parse(row.payload).quantity])).toEqual([['processing',0.75],['pending',1.5]])
 })
 it('converts entered grams and their prices to kilograms without changing invoice value',()=>{
  db.exec('ALTER TABLE products ADD COLUMN unit TEXT');db.prepare('UPDATE products SET unit=?').run('kg')
  const purchase=createStockPurchase(db,input({items:[{product_id:'rice',quantity:500,unit_cost:0.2,selling_price:0.3,entry_unit:'g'}]}))
  expect(purchase.total_amount).toBe(100)
  expect(db.prepare('SELECT quantity,cost_price,selling_price FROM product_batches').get()).toEqual({quantity:0.5,cost_price:200,selling_price:300})
 })
 it('rejects an unconfigured pack before any inventory changes',()=>{
  expect(()=>createStockPurchase(db,input({items:[{product_id:'rice',quantity:2,unit_cost:100,entry_unit:'carton'}]}))).toThrow(/pack size/)
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()).toEqual({n:0})
 })
 it('commits stock and its offline queue together, or rolls both back',()=>{
  db.exec(`CREATE TRIGGER reject_sync BEFORE INSERT ON sync_queue BEGIN SELECT RAISE(ABORT,'queue unavailable'); END`)
  expect(()=>createStockPurchase(db,input())).toThrow(/queue unavailable/)
  for(const table of ['purchase_orders','purchase_items','stocks','product_batches','stock_movements','purchase_attachments','sync_queue'])expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
 })
 it.each(['2026-02-30','2026-13-01','not-a-date'])('rejects impossible purchase date %s without writing stock',purchaseDate=>{
  expect(()=>createStockPurchase(db,input({purchaseDate}))).toThrow(/Valid purchase date/)
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_orders').get()).toEqual({n:0})
 })
 it('allows an order without a bill while leaving stock and product prices unchanged',()=>{
  const row=savePurchase(db,input({purchaseType:'order'}))
  expect(row.status).toBe('DRAFT')
  for(const table of ['stocks','product_batches','stock_movements','purchase_attachments']) expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
  expect(db.prepare('SELECT received_qty FROM purchase_items').get()).toEqual({received_qty:0})
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:99,selling_price:200})
 })
 it('rejects direct stock without a bill and rolls back all inventory and price changes',()=>{
  expect(()=>savePurchase(db,input())).toThrow(/Supplier bill upload is required/)
  for(const table of ['purchase_orders','purchase_items','stocks','product_batches','stock_movements']) expect(db.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({n:0})
  expect(db.prepare('SELECT cost_price,selling_price FROM products').get()).toEqual({cost_price:99,selling_price:200})
 })
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

 it('requires a bill at the receiving gate for an order created without one',()=>{
  savePurchase(db,input({purchaseType:'order'}))
  expect(()=>requireSavedPurchaseBill(db,'receipt1')).toThrow(/Supplier bill upload is required/)
  db.prepare('INSERT INTO purchase_attachments (id,purchase_id) VALUES (?,?)').run('delivery-bill','receipt1')
  expect(()=>requireSavedPurchaseBill(db,'receipt1')).not.toThrow()
 })
 it('does not accept a no-op upload callback as a bill',()=>{
  expect(()=>savePurchase(db,input(),()=>{})).toThrow(/Supplier bill upload is required/)
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
 })

})
