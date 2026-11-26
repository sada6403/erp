import Database from 'better-sqlite3'
import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import fs from 'fs'
import path from 'path'
import os from 'os'
import {ImportJobs} from './importJobs'
import {migrateSupermarketPurchases} from './supermarketSchema'
import {migrateImports,importsInstalled} from './importMigration'
import {DEFAULT_IMPORT_OPTIONS,type ImportOptions} from '../lib/importRegistry'
import type {KeywordActor} from './keywords'
let db:Database.Database
const admin:KeywordActor={userId:'admin',branchId:'main',terminalId:'terminal',permissions:{all:true}}
const migration=fs.readFileSync(path.join(process.cwd(),'database/migrations/imports.up.sql'),'utf8')
beforeEach(()=>{
 db=new Database(':memory:');db.pragma('foreign_keys=ON')
 db.exec(`CREATE TABLE branches(id TEXT PRIMARY KEY,name TEXT,code TEXT,is_active INTEGER DEFAULT 1,created_at TEXT DEFAULT CURRENT_TIMESTAMP); INSERT INTO branches(id,name,code) VALUES('main','Main Branch','MAIN'),('other','Other','OT');
 CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT);INSERT INTO users VALUES('admin','Admin');
 CREATE TABLE categories(id TEXT PRIMARY KEY,name TEXT,description TEXT,is_active INTEGER DEFAULT 1,updated_at TEXT);
 CREATE TABLE suppliers(id TEXT PRIMARY KEY,name TEXT,contact TEXT,phone TEXT,email TEXT,address TEXT,is_active INTEGER DEFAULT 1,updated_at TEXT);INSERT INTO suppliers(id,name) VALUES('supplier','Supplier');
 CREATE TABLE products(id TEXT PRIMARY KEY,sku TEXT UNIQUE,name TEXT,barcode TEXT,branch_id TEXT,category_id TEXT REFERENCES categories(id),supplier_id TEXT REFERENCES suppliers(id),brand TEXT,unit TEXT DEFAULT 'pcs',cost_price REAL DEFAULT 0,selling_price REAL DEFAULT 0,tax_rate REAL DEFAULT 0,min_stock_level REAL DEFAULT 5,is_active INTEGER DEFAULT 1,track_expiry INTEGER DEFAULT 0,updated_at TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
 INSERT INTO products(id,sku,name,cost_price,selling_price) VALUES('rice','R','Rice',100,150);
 CREATE TABLE purchase_orders(id TEXT PRIMARY KEY,po_number TEXT,branch_id TEXT,supplier_id TEXT,purchase_type TEXT,status TEXT,purchase_date TEXT,supplier_invoice_number TEXT,expected_date TEXT,received_at TEXT,notes TEXT,total_amount REAL,created_by TEXT,UNIQUE(supplier_id,supplier_invoice_number));
 CREATE TABLE purchase_items(id TEXT PRIMARY KEY,po_id TEXT REFERENCES purchase_orders(id),product_id TEXT REFERENCES products(id),quantity REAL,unit_cost REAL,line_total REAL,selling_price REAL,received_qty REAL);
 CREATE TABLE stocks(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id),branch_id TEXT,warehouse_id TEXT,quantity REAL,damaged_qty REAL DEFAULT 0,updated_at TEXT);
 CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id),branch_id TEXT,batch_number TEXT,expiry_date TEXT,quantity REAL,cost_price REAL,selling_price REAL,po_id TEXT REFERENCES purchase_orders(id),purchase_item_id TEXT,purchase_date TEXT,original_quantity REAL,sold_quantity REAL DEFAULT 0,returned_quantity REAL DEFAULT 0,damaged_quantity REAL DEFAULT 0,historical_cost_known INTEGER,status TEXT,created_by TEXT,notes TEXT,created_at TEXT DEFAULT CURRENT_TIMESTAMP,updated_at TEXT);
 CREATE TABLE stock_movements(id TEXT PRIMARY KEY,product_id TEXT,variant_id TEXT,from_branch_id TEXT,to_branch_id TEXT,quantity REAL,movement_type TEXT,reference_order_id TEXT,reference_transfer_id TEXT,reference_branch_transfer_id TEXT,notes TEXT,created_by TEXT,status TEXT);
 CREATE TABLE purchase_attachments(id TEXT PRIMARY KEY,purchase_id TEXT REFERENCES purchase_orders(id),is_active INTEGER DEFAULT 1);
 CREATE TABLE invoice_items(id TEXT PRIMARY KEY,product_id TEXT REFERENCES products(id));
 CREATE TABLE audit_logs(id TEXT PRIMARY KEY,user_id TEXT,branch_id TEXT,action TEXT,table_name TEXT,record_id TEXT,old_values TEXT,new_values TEXT);
 CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT,status TEXT DEFAULT 'pending',attempts INTEGER DEFAULT 0,failure_cycles INTEGER DEFAULT 0,next_retry_at TEXT,last_error TEXT);
 CREATE TABLE sync_stock_baselines(record_id TEXT PRIMARY KEY,quantity REAL,damaged_qty REAL);
 `)
 db.exec('CREATE TABLE product_uom(product_id TEXT,uom_name TEXT,conversion_factor REAL,is_base INTEGER)')
 migrateSupermarketPurchases(db)
 db.exec(migration);db.exec(fs.readFileSync(path.join(process.cwd(),'database/migrations/keywords.up.sql'),'utf8'))
})
afterEach(()=>db.close())
const service=(actor=admin,extra:Record<string,any>={})=>new ImportJobs(db,actor,{enabled:true,keywordsEnabled:true,uniqueCodes:true,...extra})
function staged(instance:ImportJobs,type:string,csv:string,options:Partial<ImportOptions>={}){
 const description=instance.upload(type,'test.csv',Buffer.from(csv))
 instance.map(description.id,{sheetName:description.sheetName,headerRow:0,mapping:description.suggestedMapping,options:{...DEFAULT_IMPORT_OPTIONS,...options}})
 return instance.validate(description.id)
}
const commit=(instance:ImportJobs,job:any,bills?: (id:string)=>void)=>instance.commit(job.id,bills,job.review_token)
describe('durable bulk import pipeline',()=>{
 it('creates missing products and supplier/category references within one reviewed stock receipt',async()=>{
  const s=service(),job=staged(s,'stock_in','barcode,name,category,unit,quantity,free_quantity,discount_amount,cost_price,selling_price,mrp,supplier,invoice_no,purchase_date\n000123,Tea,Groceries,pcs,10,2,100,100,150,180,New Supplier,NEW-1,2026-11-24',{unknown:'create'})
  expect(job.error_rows).toBe(0)
  await commit(s,job,id=>{db.prepare('INSERT INTO purchase_attachments(id,purchase_id) VALUES(?,?)').run('new-bill',id)})
  const product=db.prepare("SELECT * FROM products WHERE barcode='000123'").get() as any
  expect(product).toMatchObject({name:'Tea',unit:'pcs',cost_price:75,selling_price:150})
  expect(product.supplier_id).toBeTruthy();expect(product.category_id).toBeTruthy()
  expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:12})
  expect(db.prepare('SELECT mrp,cost_price FROM product_batches').get()).toEqual({mrp:180,cost_price:75})
  expect(db.prepare('SELECT due_balance FROM suppliers WHERE id=?').get(product.supplier_id)).toEqual({due_balance:900})
 })
 it('blocks all stock-in rows when any row has validation errors',async()=>{
  const s=service(),job=staged(s,'stock_in','sku,quantity,cost_price,selling_price,mrp,supplier,invoice_no,purchase_date\nR,1,100,150,180,Supplier,BAD-1,2026-11-24\nR,1,100,200,150,Supplier,BAD-1,2026-11-24')
  expect(job.error_rows).toBeGreaterThan(0)
  await expect(commit(s,job,()=>{})).rejects.toThrow(/zero validation errors/)
  expect(db.prepare('SELECT COUNT(*) n FROM stocks').get()).toEqual({n:0})
 })
 it('blocks missing required mapping and stores reusable templates owned by their user',()=>{
  const s=service(),job=s.upload('products','test.csv',Buffer.from('sku,name\nA,Tea'))
  expect(()=>s.map(job.id,{sheetName:job.sheetName,headerRow:0,mapping:{sku:0},options:{}})).toThrow('required')
  s.map(job.id,{sheetName:job.sheetName,headerRow:0,mapping:{sku:0,name:1},options:{}})
  s.saveTemplate(job.id,'Tea mapping');s.saveTemplate(job.id,'Tea mapping');expect(s.templates('products')).toHaveLength(1)
  const other=service({...admin,userId:'other'});expect(other.templates('products')).toEqual([]);expect(()=>other.removeTemplate((s.templates('products')[0] as any).id)).toThrow('not found')
 })
 it('cleans imported native names into search aliases without putting aliases in master names',async()=>{
  const s=service(),job=staged(s,'products','sku,name,selling_price\nA,Anchor Milk Powder (அரிசி),400',{splitNames:true})
  expect(job.error_rows).toBe(0);expect(job.warning_rows).toBe(1);await commit(s,job)
  const product=db.prepare("SELECT * FROM products WHERE sku='A'").get() as any;expect(product.name).toBe('Anchor Milk Powder')
  expect((db.prepare("SELECT COUNT(*) n FROM product_search_keywords WHERE product_id=? AND source='import'").get(product.id) as any).n).toBe(1)
  s.rollback(job.id);expect((db.prepare('SELECT is_active FROM products WHERE id=?').get(product.id) as any).is_active).toBe(0)
  expect((db.prepare('SELECT COUNT(*) n FROM product_search_keywords WHERE product_id=? AND is_active=1').get(product.id) as any).n).toBe(0)
 })
 it('imports valid rows only, exports error CSV and preserves Latin parentheses',async()=>{
  const s=service(),job=staged(s,'products','sku,name,selling_price\nA,Baby Soap (Pink),30\nB,Milk,-5')
  expect(job.valid_rows).toBe(1);expect(job.error_rows).toBe(1);expect(s.errorCsv(job.id)).toContain('Number must be')
  await commit(s,job);expect((db.prepare("SELECT name FROM products WHERE sku='A'").get() as any).name).toBe('Baby Soap (Pink)');expect(db.prepare("SELECT 1 FROM products WHERE sku='B'").get()).toBeUndefined()
 })
 it('honors keyword duplicate strategies and imports auto-created categories and brand fields',async()=>{
  const s=service(),master=staged(s,'products','sku,name,category,brand,keywords\nA,Tea,Drinks,Good Tea,tea',{unknown:'create'})
  await commit(s,master);const product=db.prepare("SELECT * FROM products WHERE sku='A'").get() as any
  expect(product.brand).toBe('Good Tea');expect(product.category_id).toBeTruthy()
  const duplicate=staged(s,'keywords','sku,keyword\nA,tea');expect(duplicate.error_rows).toBe(1)
  const skipped=staged(s,'keywords','sku,keyword\nA,tea',{duplicate:'skip'});expect(skipped.skipped_rows).toBe(1)
  const updated=staged(s,'keywords','sku,keyword\nA,tea',{duplicate:'update'});await commit(s,updated)
  expect((db.prepare("SELECT COUNT(*) n FROM product_search_keywords WHERE product_id=? AND keyword='tea'").get(product.id) as any).n).toBe(1)
  const queued=db.prepare("SELECT table_name FROM sync_queue WHERE table_name IN ('products','product_search_keywords') ORDER BY rowid").all() as any[]
  expect(queued[0].table_name).toBe('products')
 })
 it('refuses rollback when an unrelated stock movement or later master reference exists',async()=>{
  const s=service(),stock=staged(s,'opening_stock','sku,quantity,cost_price\nR,1,100');await commit(s,stock)
  db.prepare("INSERT INTO stock_movements(id,product_id,quantity,status) VALUES('outside','rice',1,'POSTED')").run();expect(()=>s.rollback(stock.id)).toThrow('later stock movements')
  const master=staged(s,'products','sku,name\nA,Tea');await commit(s,master)
  const product=db.prepare("SELECT id FROM products WHERE sku='A'").get() as any
  db.prepare('INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES(?,?,?,?)').run('later',product.id,'main',0)
  expect(()=>s.rollback(master.id)).toThrow('later references')
 })
 it('adds separate expiry batches once and safely reverses untouched opening stock',async()=>{
  db.prepare('INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES(?,?,?,?)').run('stock','rice','main',10)
  const s=service(),csv='sku,quantity,cost_price,batch_no,expiry_date\nR,3,100,B1,2027-01-01\nR,4,110,B2,2027-02-01',job=staged(s,'opening_stock',csv)
  await commit(s,job)
  expect((db.prepare("SELECT quantity FROM stocks WHERE id='stock'").get() as any).quantity).toBe(17)
  expect(db.prepare("SELECT batch_number,quantity FROM product_batches WHERE batch_number IN ('B1','B2') ORDER BY batch_number").all()).toEqual([{batch_number:'B1',quantity:3},{batch_number:'B2',quantity:4}])
  const second=staged(s,'opening_stock',csv);await expect(commit(s,second)).rejects.toThrow('already committed')
  expect((db.prepare("SELECT quantity FROM stocks WHERE id='stock'").get() as any).quantity).toBe(17)
  s.rollback(job.id);expect((db.prepare("SELECT quantity FROM stocks WHERE id='stock'").get() as any).quantity).toBe(10)
  expect((db.prepare('SELECT SUM(quantity) n FROM product_batches').get() as any).n).toBe(0)
 })
 it('commits normalized comma decimals and day-first dates without reparsing them as source text',async()=>{
  const s=service(),job=staged(s,'opening_stock','sku,quantity,cost_price,batch_no,expiry_date\nR,"1,5","100,25",B-COMMA,31/12/2027',{decimal:',',dateFormat:'DD/MM/YYYY'})
  expect(job.error_rows).toBe(0);await commit(s,job)
  expect(db.prepare("SELECT quantity,cost_price,expiry_date FROM product_batches WHERE batch_number='B-COMMA'").get()).toEqual({quantity:1.5,cost_price:100.25,expiry_date:'2027-12-31'})
 })
 it('keeps supplier bill requirements and groups all rows into one receipt',async()=>{
  const s=service(),job=staged(s,'stock_in','sku,quantity,cost_price,supplier,invoice_no,purchase_date,batch_no,expiry_date\nR,2,100,Supplier,INV-1,2026-11-24,B1,2027-01-01\nR,3,120,Supplier,INV-1,2026-11-24,B2,2027-02-01')
  await expect(commit(s,job)).rejects.toThrow('supplier bill');expect((db.prepare('SELECT COUNT(*) n FROM stocks').get() as any).n).toBe(0)
  await commit(s,job,id=>{db.prepare('INSERT INTO purchase_attachments(id,purchase_id) VALUES(?,?)').run('bill',id)})
  expect((db.prepare('SELECT COUNT(*) n FROM purchase_orders').get() as any).n).toBe(1)
  expect((db.prepare('SELECT COUNT(*) n FROM product_batches').get() as any).n).toBe(2)
  expect((db.prepare('SELECT SUM(quantity) n FROM stocks').get() as any).n).toBe(5)
  const queued=(db.prepare('SELECT table_name FROM sync_queue ORDER BY rowid').all() as any[]).map(row=>row.table_name)
  expect(queued.indexOf('purchase_orders')).toBeLessThan(queued.indexOf('product_batches'))
  s.rollback(job.id);expect((db.prepare('SELECT status FROM purchase_orders').get() as any).status).toBe('CANCELLED');expect((db.prepare('SELECT SUM(quantity) n FROM stocks').get() as any).n).toBe(0)
 })
 it('recovers a partially committed chunked job without double-applying rows',async()=>{
  let interrupted=false
  const s=service(admin,{limits:{chunkSize:1},assertContext:()=>{if(interrupted&&(db.prepare("SELECT COUNT(*) n FROM import_job_rows WHERE status='applied'").get() as any).n)throw new Error('Simulated interruption')}})
  const job=staged(s,'opening_stock','sku,quantity,cost_price,batch_no\nR,2,100,B1\nR,3,100,B2')
  interrupted=true;await expect(commit(s,job)).rejects.toThrow('interruption');interrupted=false
  expect(s.status(job.id).status).toBe('partial');expect(s.status(job.id).applied_rows).toBe(1)
  await commit(s,s.status(job.id));expect((db.prepare('SELECT SUM(quantity) n FROM stocks').get() as any).n).toBe(5)
 })
 it('rolls back the entire transaction for all-or-nothing runtime failure',async()=>{
  db.exec("CREATE TRIGGER fail_bad BEFORE INSERT ON products WHEN NEW.name='Bad' BEGIN SELECT RAISE(ABORT,'Rejected row'); END")
  const s=service(),job=staged(s,'products','sku,name\nA,Tea\nB,Bad',{allOrNothing:true})
  await expect(commit(s,job)).rejects.toThrow('Rejected row');expect(db.prepare("SELECT 1 FROM products WHERE sku='A'").get()).toBeUndefined();expect(s.status(job.id).applied_rows).toBe(0)
 })
 it('rejects stale validation, stale targets and rollback after a sale',async()=>{
  const s=service(),job=staged(s,'prices','sku,selling_price\nR,200',{duplicate:'update'})
  await expect(s.commit(job.id,undefined,'wrong-token')).rejects.toThrow('Validation changed')
  db.prepare("UPDATE products SET selling_price=175 WHERE id='rice'").run();await expect(commit(s,job)).rejects.toThrow('changed after validation')
  const next=staged(s,'opening_stock','sku,quantity,cost_price\nR,1,100');await commit(s,next)
  db.prepare("INSERT INTO invoice_items(id,product_id) VALUES('sale','rice')").run();expect(()=>s.rollback(next.id)).toThrow('sales history')
 })
 it('checks permissions, feature flags and existing branch procurement rules',()=>{
  expect(()=>service({...admin,permissions:{pos:true}}).upload('products','test.csv',Buffer.from('sku,name\nA,Tea'))).toThrow('Admin')
  expect(()=>service({...admin,permissions:{inventory:true,'import.stock':true},branchId:'other'}).upload('stock_in','test.csv',Buffer.from('sku,quantity\nR,1'))).toThrow('main branch')
  expect(()=>service(admin,{enabled:false}).upload('products','test.csv',Buffer.from('sku,name\nA,Tea'))).toThrow('disabled')
  expect((db.prepare('SELECT COUNT(*) n FROM import_jobs').get() as any).n).toBe(0)
 })
 it('routes an admin receipt to the main branch and prevents another user from committing its staged job',async()=>{
  const adminAtOther=service({...admin,branchId:'other'}),job=staged(adminAtOther,'stock_in','sku,quantity,cost_price,supplier,invoice_no,purchase_date\nR,1,100,Supplier,INV-MAIN,2026-11-24')
  expect(job.branch_id).toBe('main');expect(job.branch_name).toBe('Main Branch')
  const other=service({...admin,userId:'other'});await expect(commit(other,job)).rejects.toThrow('Only the importing user')
  await commit(adminAtOther,job,id=>{db.prepare('INSERT INTO purchase_attachments(id,purchase_id) VALUES(?,?)').run('main-bill',id)})
  expect((db.prepare('SELECT branch_id FROM stocks').get() as any).branch_id).toBe('main')
  expect(adminAtOther.history()[0]).toMatchObject({owner_name:'Admin',branch_name:'Main Branch'})
  expect((db.prepare('SELECT DISTINCT branch_id FROM audit_logs WHERE record_id=?').all(job.id) as any[])).toEqual([{branch_id:'main'}])
 })
 it('purges expired raw staging without erasing audit history',()=>{
  const s=service(),job=staged(s,'products','sku,name\nA,Tea')
  db.prepare("UPDATE import_jobs SET retained_until='2000-01-01' WHERE id=?").run(job.id);s.purge()
  expect((db.prepare('SELECT file_data,status FROM import_jobs WHERE id=?').get(job.id) as any)).toEqual({file_data:null,status:'expired'})
  expect((db.prepare('SELECT raw_json FROM import_job_rows WHERE job_id=?').get(job.id) as any).raw_json).toBe('[]')
  expect((db.prepare('SELECT COUNT(*) n FROM audit_logs').get() as any).n).toBeGreaterThan(0)
 })
 it('backs up before migration, is idempotent and refuses destructive down on populated jobs',async()=>{
  db.prepare("INSERT INTO stocks(id,product_id,branch_id,quantity) VALUES('before','rice','main',17.5)").run()
  db.exec('DROP TABLE import_job_rows;DROP TABLE import_mapping_templates;DROP TABLE import_jobs')
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pos-imports-'))
  try {
   const backup=await migrateImports(db,directory,migration);expect(backup).toBeTruthy();const copy=new Database(backup!,{readonly:true});expect(importsInstalled(copy)).toBe(false);copy.close()
   expect(await migrateImports(db,directory,migration)).toBeUndefined();expect((db.prepare('SELECT SUM(quantity) n FROM stocks').get() as any).n).toBe(17.5)
   const down=fs.readFileSync(path.join(process.cwd(),'database/migrations/imports.down.sql'),'utf8');await migrateImports(db,directory,down,'down');expect(importsInstalled(db)).toBe(false);await migrateImports(db,directory,migration)
   service().upload('products','test.csv',Buffer.from('sku,name\nA,Tea'));await expect(migrateImports(db,directory,down,'down')).rejects.toThrow('populated')
  }finally{fs.rmSync(directory,{recursive:true,force:true})}
 })
})
