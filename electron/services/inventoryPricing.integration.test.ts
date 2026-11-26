import Database from 'better-sqlite3'
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {migrateSupermarketPurchases} from './supermarketSchema'
import {inventoryPricingContext,setInventoryPricing,adjustBatchSellingPrice} from './inventoryPricing'
import {quoteBatchPrice,allocateSaleBatches} from './batchInventory'
let db:Database.Database
const policy=(extra:Record<string,unknown>={})=>({productId:'rice',branchId:'main',userId:'admin',authorized:true,mode:'weighted' as const,markup:20,reason:'Reviewed supplier costs',...extra})
beforeEach(()=>{
 db=new Database(':memory:')
 db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,unit TEXT,cost_price REAL,selling_price REAL,tax_rate REAL DEFAULT 0,sale_as_latest_price INTEGER DEFAULT 0,updated_at TEXT);INSERT INTO products(id,name,unit,cost_price,selling_price) VALUES('rice','Rice','kg',200,250);
 CREATE TABLE stocks(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,warehouse_id TEXT,quantity REAL,damaged_qty REAL DEFAULT 0);INSERT INTO stocks VALUES('stock','rice','main',NULL,20,0);
 CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,batch_number TEXT,quantity REAL,cost_price REAL,selling_price REAL,historical_cost_known INTEGER,purchase_item_id TEXT,purchase_date TEXT,expiry_date TEXT,created_at TEXT,updated_at TEXT,sold_quantity REAL DEFAULT 0,status TEXT DEFAULT 'available');
 INSERT INTO product_batches(id,product_id,branch_id,batch_number,quantity,cost_price,selling_price,historical_cost_known,purchase_item_id,purchase_date,created_at) VALUES('old','rice','main','OLD',10,100,150,1,'i1','2026-01-01','2026-01-01'),('new','rice','main','NEW',10,200,250,1,'i2','2026-02-01','2026-02-01');
 CREATE TABLE product_uom(product_id TEXT,uom_name TEXT,conversion_factor REAL,is_base INTEGER);
 CREATE TABLE audit_logs(id TEXT PRIMARY KEY,user_id TEXT,branch_id TEXT,action TEXT,table_name TEXT,record_id TEXT,old_values TEXT,new_values TEXT);
 CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,failure_cycles INTEGER DEFAULT 0,next_retry_at TEXT,last_error TEXT);
 CREATE TABLE sale_batch_allocations(id TEXT PRIMARY KEY,invoice_id TEXT,invoice_item_id TEXT,product_id TEXT,batch_id TEXT,branch_id TEXT,quantity REAL,returned_quantity REAL,unit_cost REAL,unit_selling_price REAL,cost_known INTEGER);`)
 migrateSupermarketPurchases(db)
 db.prepare('UPDATE product_batches SET mrp=? WHERE id=?').run(180,'old');db.prepare('UPDATE product_batches SET mrp=? WHERE id=?').run(300,'new')
})
afterEach(()=>db.close())
describe('inventory pricing and additive migration',()=>{
 it('keeps migration idempotent and preserves old batch values',()=>{
  migrateSupermarketPurchases(db)
  expect(db.prepare('SELECT quantity,cost_price,selling_price FROM product_batches WHERE id=?').get('old')).toEqual({quantity:10,cost_price:100,selling_price:150})
 })
 it('provides previous/latest purchase, stock and exact weighted cost',()=>{
  expect(inventoryPricingContext(db,'rice','main')).toMatchObject({quantity:20,average_cost:150,previous_purchase_price:100,latest_purchase_price:200,cost_known:true})
 })
 it('supports weighted and latest selling without rewriting batch prices',()=>{
  setInventoryPricing(db,policy())
  expect(quoteBatchPrice(db,'rice','main',5,250)).toBe(180)
  setInventoryPricing(db,policy({mode:'latest'}))
  expect(quoteBatchPrice(db,'rice','main',5,250)).toBe(180)
  expect(quoteBatchPrice(db,'rice','main',15,250)).toBe(180)
  expect(db.prepare('SELECT selling_price,cost_price FROM product_batches WHERE id=?').get('old')).toEqual({selling_price:150,cost_price:100})
 })
 it('refuses invented weighted costs for legacy opening stock',()=>{
  db.prepare('UPDATE product_batches SET historical_cost_known=0 WHERE id=?').run('old')
  expect(inventoryPricingContext(db,'rice','main').average_cost).toBeNull()
  expect(()=>setInventoryPricing(db,policy())).toThrow(/Historical opening cost/)
 })
 it('requires authorization and a reason for policy and price changes',()=>{
  expect(()=>setInventoryPricing(db,policy({authorized:false}))).toThrow(/authorized/)
  expect(()=>setInventoryPricing(db,policy({reason:''}))).toThrow(/reason/)
  expect(()=>adjustBatchSellingPrice(db,{batchId:'old',branchId:'main',userId:'staff',authorized:false,price:160,reason:'Review'})).toThrow(/authorized/)
 })
 it('enforces tax-inclusive MRP on manual prices and audits valid changes',()=>{
  db.prepare('UPDATE products SET tax_rate=20').run()
  expect(()=>adjustBatchSellingPrice(db,{batchId:'old',branchId:'main',userId:'admin',authorized:true,price:151,reason:'Review'})).toThrow(/MRP/)
  adjustBatchSellingPrice(db,{batchId:'old',branchId:'main',userId:'admin',authorized:true,price:140,reason:'Near expiry markdown'})
  expect(db.prepare('SELECT cost_price,selling_price FROM product_batches WHERE id=?').get('old')).toEqual({cost_price:100,selling_price:140})
  expect(db.prepare('SELECT action,new_values FROM audit_logs').get()).toMatchObject({action:'BATCH_SELLING_PRICE_ADJUSTMENT',new_values:expect.stringContaining('Near expiry markdown')})
 })
 it('rejects over-MRP sales even if an admin submits an override',()=>{
  expect(()=>db.transaction(()=>allocateSaleBatches(db,{invoiceId:'sale',invoiceItemId:'line',productId:'rice',branchId:'main',quantity:2,unitSellingPrice:200}))()).toThrow(/MRP/)
  expect(db.prepare('SELECT quantity FROM product_batches WHERE id=?').get('old')).toEqual({quantity:10})
 })
 it('rolls back manual pricing when the durable outbox fails',()=>{
  db.exec(`CREATE TRIGGER reject_sync BEFORE INSERT ON sync_queue BEGIN SELECT RAISE(ABORT,'offline queue failed'); END`)
  expect(()=>adjustBatchSellingPrice(db,{batchId:'old',branchId:'main',userId:'admin',authorized:true,price:160,reason:'Review'})).toThrow(/offline queue/)
  expect(db.prepare('SELECT selling_price FROM product_batches WHERE id=?').get('old')).toEqual({selling_price:150})
  expect(db.prepare('SELECT COUNT(*) n FROM audit_logs').get()).toEqual({n:0})
 })
})
