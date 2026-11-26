import Database from 'better-sqlite3'
import * as XLSX from 'xlsx'
import {migrateSupermarketPurchases} from './supermarketSchema'
import {beforeEach,afterEach,describe,it,expect,vi} from 'vitest'

const state=vi.hoisted(()=>({db:null as any,rows:[] as Record<string,unknown>[],confirm:1}))
vi.mock('electron',()=>({BrowserWindow:{getFocusedWindow:()=>({}),getAllWindows:()=>[]},dialog:{showOpenDialog:async()=>({filePaths:['inventory.csv']}),showMessageBox:async()=>({response:state.confirm})}}))
vi.mock('../database',()=>({getDb:()=>state.db}))
vi.mock('./companyWorkspace',()=>({createCompanyStore:()=>({get:()=>({id:'admin'})})}))
vi.mock('./branchAccess',()=>({resolveMainBranchId:()=> 'main'}))
vi.mock('./auditLog',()=>({logAudit:()=>{}}))
vi.mock('xlsx',async original=>{
 const actual=await original<typeof XLSX>()
 return {...actual,readFile:()=>({SheetNames:['Purchases'],Sheets:{Purchases:actual.utils.json_to_sheet(state.rows)}})}
})
import {importPOsFromExcel,parseQtyAndUnit} from './purchaseImportExport'

beforeEach(()=>{
 state.confirm=1
 state.rows=[{'PO Number':'PO-1','Order Date':'2026-11-01',Supplier:'Supplier','Product Name':'Rice',Quantity:2,'Unit Cost':100,'Selling Price':150,'Batch Number':'B-1','Expiry Date':'2030-01-01'}]
 state.db=new Database(':memory:')
 state.db.exec(`
 CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT,contact TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT);
 CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,sku TEXT,barcode TEXT,cost_price REAL,selling_price REAL,unit TEXT,is_active INTEGER,created_at TEXT,updated_at TEXT,supplier_id TEXT);
 INSERT INTO products VALUES('rice','Rice','RICE','123',80,120,'pcs',1,NULL,NULL,NULL);
 CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_number TEXT UNIQUE,branch_id TEXT,supplier_id TEXT,status TEXT,subtotal REAL,total REAL,total_amount REAL,expected_date TEXT,received_date TEXT,received_at TEXT,notes TEXT,created_by TEXT,created_at TEXT,updated_at TEXT);
 CREATE TABLE purchase_items(id TEXT PRIMARY KEY,po_id TEXT,product_id TEXT,ordered_qty REAL,quantity REAL,received_qty REAL,unit_cost REAL,line_total REAL,notes TEXT,updated_at TEXT,selling_price REAL,batch_number TEXT,expiry_date TEXT,mfg_date TEXT);
 CREATE TABLE stocks(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,warehouse_id TEXT,quantity REAL,damaged_qty REAL,updated_at TEXT);
 CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT,branch_id TEXT,batch_number TEXT,expiry_date TEXT,quantity REAL,cost_price REAL,selling_price REAL,po_id TEXT,purchase_item_id TEXT,purchase_date TEXT,original_quantity REAL,sold_quantity REAL,returned_quantity REAL,damaged_quantity REAL,historical_cost_known INTEGER,status TEXT,created_by TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
 CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT,variant_id TEXT,from_branch_id TEXT,to_branch_id TEXT,quantity REAL,movement_type TEXT,reference_order_id TEXT,reference_transfer_id TEXT,reference_branch_transfer_id TEXT,notes TEXT,created_by TEXT,status TEXT);
 CREATE TABLE sync_stock_baselines(record_id TEXT,quantity REAL,damaged_qty REAL);
 CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,failure_cycles INTEGER DEFAULT 0,next_retry_at TEXT,last_error TEXT);
 CREATE TABLE product_uom(product_id TEXT,uom_name TEXT,conversion_factor REAL,is_base INTEGER);
 `)
 migrateSupermarketPurchases(state.db)
})
afterEach(()=>state.db.close())
const count=(table:string)=>(state.db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n
describe('transactional purchase spreadsheet import',()=>{
 it('converts loose stock units and per-unit prices without changing the purchase total',async()=>{
  state.db.prepare('UPDATE products SET unit=?').run('kg')
  Object.assign(state.rows[0],{Quantity:500,Unit:'g','Unit Cost':0.2,'Selling Price':0.3})
  expect((await importPOsFromExcel()).success).toBe(true)
  expect(state.db.prepare('SELECT quantity,cost_price,selling_price FROM product_batches').get()).toEqual({quantity:0.5,cost_price:200,selling_price:300})
  expect(state.db.prepare('SELECT total_amount FROM purchase_orders').get()).toEqual({total_amount:100})
 })
 it('creates receipt layers and a durable offline outbox together',async()=>{
  expect((await importPOsFromExcel()).success).toBe(true)
  expect(state.db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:2})
  expect(state.db.prepare('SELECT quantity,cost_price,selling_price,expiry_date FROM product_batches').get()).toEqual({quantity:2,cost_price:100,selling_price:150,expiry_date:'2030-01-01'})
  for(const table of ['purchase_orders','purchase_items','products','suppliers','product_batches','stock_movements','stocks'])expect(state.db.prepare('SELECT 1 FROM sync_queue WHERE table_name=?').get(table)).toBeTruthy()
 })
 it('rejects a repeated import without changing stock',async()=>{
  await importPOsFromExcel();expect((await importPOsFromExcel()).success).toBe(false)
  expect(count('purchase_orders')).toBe(1);expect(count('stock_movements')).toBe(1)
 })
 it('leaves all data unchanged when the preview is cancelled',async()=>{
  state.confirm=0;expect((await importPOsFromExcel()).cancelled).toBe(true)
  for(const table of ['suppliers','purchase_orders','stocks','sync_queue'])expect(count(table)).toBe(0)
 })
 it.each([['Quantity',0],['Quantity',-2],['Unit Cost',-10],['Order Date','2026-02-30'],['Expiry Date','invalid']])('rejects invalid %s before any writes',async(field,value)=>{
  state.rows[0][field]=value;expect((await importPOsFromExcel()).success).toBe(false)
  for(const table of ['suppliers','purchase_orders','stocks','sync_queue'])expect(count(table)).toBe(0)
 })
 it('keeps batch dates and selling prices in draft orders without receiving stock',async()=>{
  expect((await importPOsFromExcel({markAsReceived:false})).success).toBe(true)
  expect(count('stocks')).toBe(0);expect(count('product_batches')).toBe(0)
  expect(state.db.prepare('SELECT batch_number,expiry_date,selling_price FROM purchase_items').get()).toEqual({batch_number:'B-1',expiry_date:'2030-01-01',selling_price:150})
 })
 it('rolls back the whole import if the offline outbox cannot be written',async()=>{
  state.db.exec(`CREATE TRIGGER reject_sync BEFORE INSERT ON sync_queue BEGIN SELECT RAISE(ABORT,'outbox unavailable'); END`)
  expect((await importPOsFromExcel()).success).toBe(false)
  for(const table of ['suppliers','purchase_orders','stocks','product_batches','stock_movements'])expect(count(table)).toBe(0)
 })
 it('matches exact barcodes without creating another product',async()=>{
  state.rows[0]['Product Name']='123';expect((await importPOsFromExcel()).success).toBe(true);expect(count('products')).toBe(1)
 })
 it('does not use a partial product name to receive another product',async()=>{
  state.rows[0]['Product Name']='Rice flour';expect((await importPOsFromExcel()).success).toBe(true);expect(count('products')).toBe(2)
 })
 it('rejects malformed and signed quantities',()=>{
  for(const raw of ['-2','2 garbage data','02/00'])expect(parseQtyAndUnit(raw).qty).toBe(0)
  expect(parseQtyAndUnit('2.5 KG')).toEqual({qty:2.5,unit:'kg'})
 })
})
