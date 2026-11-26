import Database from 'better-sqlite3'
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {migrateSupermarketPurchases} from './supermarketSchema'
import {createStockPurchase} from './purchaseEntry'
import {returnPurchaseStock} from './purchaseReturns'
import {applyPurchaseBalance,allocateSupplierPayment} from './purchaseAccounting'
import {purchaseInventoryReport} from './purchaseReports'
let db:Database.Database
beforeEach(()=>{
 db=new Database(':memory:');db.pragma('foreign_keys=ON')
 db.exec(`CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT);INSERT INTO branches VALUES('main','Main');
 CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT,is_active INTEGER);INSERT INTO suppliers VALUES('supplier','Supplier',1);
 CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,sku TEXT,barcode TEXT,unit TEXT,branch_id TEXT,min_stock_level REAL,is_active INTEGER,cost_price REAL,selling_price REAL,tax_rate REAL DEFAULT 0,updated_at TEXT);INSERT INTO products(id,name,sku,unit,min_stock_level,is_active,cost_price,selling_price) VALUES('rice','Rice','R','kg',5,1,100,140);
 CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_number TEXT,branch_id TEXT,supplier_id TEXT,purchase_type TEXT,status TEXT,purchase_date TEXT,supplier_invoice_number TEXT,expected_date TEXT,received_at TEXT,notes TEXT,total_amount REAL,created_by TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
 CREATE TABLE purchase_items(id TEXT PRIMARY KEY,po_id TEXT,product_id TEXT,quantity REAL,unit_cost REAL,line_total REAL,selling_price REAL,received_qty REAL,batch_number TEXT,expiry_date TEXT,mfg_date TEXT);
 CREATE TABLE stocks(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,warehouse_id TEXT,quantity REAL,damaged_qty REAL DEFAULT 0,updated_at TEXT);
 CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,batch_number TEXT,expiry_date TEXT,mfg_date TEXT,quantity REAL,cost_price REAL,selling_price REAL,po_id TEXT,purchase_item_id TEXT,purchase_date TEXT,original_quantity REAL,sold_quantity REAL,returned_quantity REAL,damaged_quantity REAL,historical_cost_known INTEGER,status TEXT,created_by TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
 CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT,variant_id TEXT,from_branch_id TEXT,to_branch_id TEXT,quantity REAL,movement_type TEXT,reference_order_id TEXT,reference_transfer_id TEXT,reference_branch_transfer_id TEXT,notes TEXT,created_by TEXT,status TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE purchase_attachments(id TEXT PRIMARY KEY,purchase_id TEXT,is_active INTEGER DEFAULT 1);
 CREATE TABLE sync_stock_baselines(record_id TEXT,quantity REAL,damaged_qty REAL);
 CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,failure_cycles INTEGER DEFAULT 0,next_retry_at TEXT,last_error TEXT);
 CREATE TABLE audit_logs(id TEXT PRIMARY KEY,user_id TEXT,branch_id TEXT,action TEXT,table_name TEXT,record_id TEXT,old_values TEXT,new_values TEXT);
 CREATE TABLE product_uom(product_id TEXT,uom_name TEXT,conversion_factor REAL,is_base INTEGER);`)
 migrateSupermarketPurchases(db)
 purchase()
})
afterEach(()=>db.close())
function purchase(id='purchase',quantity=10){return createStockPurchase(db,{id,poNumber:'PO-'+id,branchId:'main',supplierId:'supplier',purchaseType:'direct',purchaseDate:'2026-11-01',items:[{product_id:'rice',quantity,unit_cost:100,selling_price:140,mrp:150}]},purchaseId=>{db.prepare('INSERT INTO purchase_attachments(id,purchase_id) VALUES(?,?)').run('bill-'+purchaseId,purchaseId)})}
function input(extra:Record<string,any>={}){const batch=db.prepare('SELECT id FROM product_batches WHERE po_id=?').get('purchase') as {id:string};return {id:'return',purchaseId:'purchase',branchId:'main',userId:'admin',date:'2026-11-26',reason:'Damaged packaging returned',items:[{batch_id:batch.id,quantity:2}],...extra}}
describe('purchase returns, supplier accounting and reports',()=>{
 it('keeps existing supplier payments allocated so paid returns create supplier credit',()=>{
  db.transaction(()=>{allocateSupplierPayment(db,'supplier',1000);db.exec('UPDATE suppliers SET due_balance=0')})()
  expect(db.prepare('SELECT paid_amount,outstanding_amount FROM purchase_orders').get()).toEqual({paid_amount:1000,outstanding_amount:0})
  returnPurchaseStock(db,input())
  expect(db.prepare('SELECT credit_balance,due_balance FROM suppliers').get()).toEqual({credit_balance:200,due_balance:0})
 })
 it('reverses a cancelled draft invoice and preserves prepayments as supplier credit',()=>{
  createStockPurchase(db,{id:'draft',poNumber:'DRAFT',branchId:'main',supplierId:'supplier',purchaseType:'order',purchaseDate:'2026-11-01',items:[{product_id:'rice',quantity:5,unit_cost:100,selling_price:140}]})
  db.transaction(()=>{db.exec("UPDATE purchase_orders SET paid_amount=100 WHERE id='draft'");applyPurchaseBalance(db,'draft',true,true)})()
  expect(db.prepare('SELECT due_balance FROM suppliers').get()).toEqual({due_balance:1400})
  db.transaction(()=>{db.exec("UPDATE purchase_orders SET status='CANCELLED' WHERE id='draft'");applyPurchaseBalance(db,'draft',true,true)})()
  expect(db.prepare('SELECT credit_balance,due_balance FROM suppliers').get()).toEqual({credit_balance:100,due_balance:1000})
 })
 it('reduces exact batch stock and supplier debt once for a repeated return',()=>{
  returnPurchaseStock(db,input());returnPurchaseStock(db,input())
  expect(db.prepare('SELECT quantity,supplier_returned_quantity,cost_price FROM product_batches').get()).toEqual({quantity:8,supplier_returned_quantity:2,cost_price:100})
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:8})
  expect(db.prepare('SELECT due_balance,credit_balance FROM suppliers').get()).toEqual({due_balance:800,credit_balance:0})
  expect(db.prepare('SELECT returned_amount,outstanding_amount FROM purchase_orders').get()).toEqual({returned_amount:200,outstanding_amount:800})
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_returns').get()).toEqual({n:1})
 })
 it('creates supplier credit for a paid return and uses it on a future purchase',()=>{
  db.transaction(()=>{db.exec('UPDATE purchase_orders SET paid_amount=1000');applyPurchaseBalance(db,'purchase')})()
  returnPurchaseStock(db,input())
  expect(db.prepare('SELECT due_balance,credit_balance FROM suppliers').get()).toEqual({due_balance:0,credit_balance:200})
  purchase('second',1)
  expect(db.prepare('SELECT outstanding_amount,applied_supplier_credit FROM purchase_orders WHERE id=?').get('second')).toEqual({outstanding_amount:0,applied_supplier_credit:100})
  expect(db.prepare('SELECT credit_balance FROM suppliers').get()).toEqual({credit_balance:100})
 })
 it('returns fractional stock at its immutable purchase cost',()=>{
  returnPurchaseStock(db,input({items:[{batch_id:input().items[0].batch_id,quantity:2.5}]}))
  expect(db.prepare('SELECT total_amount FROM purchase_returns').get()).toEqual({total_amount:250})
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:7.5})
 })
 it.each([0,-1,11,Infinity])('rejects invalid or excessive returned quantity %s',quantity=>{
  expect(()=>returnPurchaseStock(db,input({items:[{batch_id:input().items[0].batch_id,quantity}]}))).toThrow()
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:10})
  expect(db.prepare('SELECT due_balance FROM suppliers').get()).toEqual({due_balance:1000})
 })
 it('refuses another branch and duplicate batch lines',()=>{
  expect(()=>returnPurchaseStock(db,input({branchId:'other'}))).toThrow(/branch/)
  expect(()=>returnPurchaseStock(db,input({items:[input().items[0],input().items[0]]}))).toThrow(/Duplicate/)
 })
 it('rolls back return, stock, credit and audit when the queue fails',()=>{
  db.exec(`CREATE TRIGGER fail_return_sync BEFORE INSERT ON sync_queue WHEN NEW.table_name='purchase_returns' BEGIN SELECT RAISE(ABORT,'offline queue failed'); END`)
  expect(()=>returnPurchaseStock(db,input())).toThrow(/offline queue/)
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_returns').get()).toEqual({n:0})
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:10})
  expect(db.prepare('SELECT due_balance FROM suppliers').get()).toEqual({due_balance:1000})
 })
 it('reports expired and low stock, supplier balances, returns and movements',()=>{
  returnPurchaseStock(db,input())
  db.exec("UPDATE product_batches SET expiry_date='2000-01-01'")
  const report=purchaseInventoryReport(db,'main',{state:'expired'})
  expect(report.total).toBe(1);expect(report.alerts).toMatchObject({expired:1,low_stock:1})
  expect(report.returns).toHaveLength(1);expect(report.movements).toHaveLength(2)
  expect(report.suppliers[0]).toMatchObject({due_balance:800,credit_balance:0})
  expect(purchaseInventoryReport(db,'main',{search:'missing'}).total).toBe(0)
 })
})
