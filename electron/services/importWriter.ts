import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'
import {ImportEffects} from './importEffects'
import {KeywordService,type KeywordActor} from './keywords'
import {importType,type ImportType,type ImportOptions} from '../lib/importRegistry'
import {ensureLegacyOpeningLayer} from './batchInventory'
import {insertStockMovement} from './stockMovement'
import {createStockPurchase} from './purchaseEntry'
import {claimBatch} from './batchIdentity'
export function writeImportRow(db:Database.Database,type:string,data:Record<string,any>,target:Record<string,any>|null,options:ImportOptions,actor:KeywordActor,jobId:string,uniqueCodes:boolean) {
 const effects=new ImportEffects(db)
 const reference=(field:'category'|'supplier')=>{
  if(!data[field])return undefined
  const table=field==='category'?'categories':'suppliers'
  const existing=db.prepare(`SELECT id FROM ${table} WHERE LOWER(TRIM(name))=LOWER(?) AND is_active=1`).get(data[field]) as {id:string}|undefined
  if(existing)return existing.id
  if(options.unknown!=='create'||!actor.permissions.all)throw new Error(`Unknown ${field}`)
  const id=randomUUID();effects.put(table,id,{name:data[field],is_active:1});return id
 }
 const writeNamedMaster=(table:'categories'|'suppliers')=>{
  const values=Object.fromEntries(Object.entries(data).filter(([key,value])=>!key.startsWith('_')&&value!==''))
  target=effects.put(table,target?.id||randomUUID(),{...values,...(!target?{is_active:1}:{})})
 }
 const handlers:Record<ImportType,()=>void>={
  products:()=>{
  const values:Record<string,any>={name:data.name,sku:data.sku}
  for(const key of ['barcode','brand','unit','cost_price','selling_price','tax_rate','min_stock_level'])if(data[key]!==undefined&&data[key]!=='')values[key]=data[key]
  if(data.category)values.category_id=reference('category')
  if(data.supplier)values.supplier_id=reference('supplier')
  if(!target)Object.assign(values,{branch_id:null,unit:values.unit||'pcs',cost_price:values.cost_price??0,selling_price:values.selling_price??0,is_active:1})
  target=effects.put('products',target?.id||randomUUID(),values)
  },
  prices:()=>{effects.put('products',target!.id,{cost_price:data.cost_price,selling_price:data.selling_price})},
  brands:()=>{effects.put('products',target!.id,{brand:data.brand})},
  categories:()=>writeNamedMaster('categories'),
  suppliers:()=>writeNamedMaster('suppliers'),
  opening_stock:()=>{

  const productId=target!.id
  const read={stocks:()=>db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').all(productId,actor.branchId) as any[],product_batches:()=>db.prepare('SELECT * FROM product_batches WHERE product_id=? AND branch_id=?').all(productId,actor.branchId) as any[],stock_movements:()=>db.prepare('SELECT * FROM stock_movements WHERE product_id=? AND reference_order_id=?').all(productId,jobId) as any[]}
  effects.observe(read,()=>{
   const identity=claimBatch(db,{product_id:productId,batch_number:data.batch_no||`IMPORT-${jobId.slice(0,8)}`,expiry_date:data.expiry_date,mfg_date:data.mfg_date,batch_resolution:data.batch_resolution,existing_batch_id:data.existing_batch_id,acknowledge_dates:data.acknowledge_dates})
   ensureLegacyOpeningLayer(db,productId,actor.branchId)
   const stocks=read.stocks();if(stocks.length>1)throw new Error('Duplicate stock balances require reconciliation before import')
   if(stocks.length)db.prepare("UPDATE stocks SET quantity=quantity+?,updated_at=datetime('now') WHERE id=?").run(data.quantity,stocks[0].id)
   else db.prepare('INSERT INTO stocks(id,product_id,branch_id,quantity,damaged_qty) VALUES(?,?,?,?,0)').run(randomUUID(),productId,actor.branchId,data.quantity)
   effects.put('product_batches',randomUUID(),{product_id:productId,branch_id:actor.branchId,batch_number:identity.no,expiry_date:identity.expiry||null,mfg_date:identity.mfg||null,batch_identity_id:identity.id,batch_entry_mode:data.batch_resolution==='add_existing'?'add_existing':'new',batch_warning_ack:data.acknowledge_dates?1:0,quantity:data.quantity,cost_price:data.cost_price,original_quantity:data.quantity,sold_quantity:0,returned_quantity:0,damaged_quantity:0,historical_cost_known:1,status:'available',purchase_date:data.purchase_date,created_by:actor.userId,notes:`Opening stock import ${jobId}`})
   insertStockMovement(db,{product_id:productId,to_branch_id:actor.branchId,quantity:data.quantity,movement_type:'ADJUSTMENT',reference_order_id:jobId,created_by:actor.userId,notes:`Opening stock import ${jobId}`})
  })
   },
  keywords:()=>{/* Shared scoped alias writer runs after the primary handler. */},
  stock_in:()=>{throw new Error('Stock-in requires the grouped receipt handler')}
 }
 const handler=handlers[importType(type).id]
 handler()
 if((type==='products'||type==='keywords')&&data._aliases?.length) {
  effects.queue(uniqueCodes) // Parent master/reference events precede alias events in the existing outbox.
  const id=target!.id
  effects.observe({product_search_keywords:()=>db.prepare('SELECT * FROM product_search_keywords WHERE product_id=?').all(id) as any[]},()=>{
   const service=new KeywordService(db,actor,uniqueCodes)
   for(const keyword of data._aliases)service.save({id:type==='keywords'?data._keyword_id:undefined,version:type==='keywords'?data._keyword_version:undefined,product_id:id,keyword,scope_type:type==='keywords'?data.scope:'global',keyword_type:type==='keywords'?data.keyword_type||undefined:keyword===data.quick_code?'code':undefined,source:'import'})
  })
  effects.acknowledge('product_search_keywords') // KeywordService already queued these atomically.
 }
 return effects
}
export function writeImportReceipt(db:Database.Database,rows:Record<string,any>[],actor:KeywordActor,jobId:string,saveBills:(id:string)=>void,allowCreate=false) {
 const effects=new ImportEffects(db),first=rows[0]
 effects.dependOnPurchase(jobId)
 const reference=(table:'suppliers'|'categories',name:string)=>{
  const existing=db.prepare(`SELECT id FROM ${table} WHERE LOWER(TRIM(name))=LOWER(?) AND is_active=1`).get(name) as {id:string}|undefined
  if(existing)return existing.id
  if(!allowCreate||!actor.permissions.all)throw new Error(`Unknown ${table}: create or map this master first`)
  const id=randomUUID();effects.put(table,id,{name,is_active:1});return id
 }
 const supplierId=reference('suppliers',first.supplier)
 const created=new Map<string,string>()
 for(const row of rows){
  row.supplier_id=supplierId
  if(!row.product_id){
   if(created.has(row.sku)){row.product_id=created.get(row.sku);continue}
   if(!allowCreate||!actor.permissions.all||!row._create_product)throw new Error('Create or map the product before importing this invoice')
   if(db.prepare('SELECT 1 FROM products WHERE sku=? OR (barcode IS NOT NULL AND barcode=?)').get(row.sku,row.barcode||''))throw new Error('Product identity changed since validation; review this import again')
   const id=randomUUID()
   effects.put('products',id,{sku:row.sku,barcode:row.barcode||null,name:row.name,unit:row.unit||'pcs',supplier_id:supplierId,category_id:row.category?reference('categories',row.category):null,cost_price:row.cost_price,selling_price:row.selling_price,is_active:1,branch_id:null,track_batches:1,track_expiry:row.expiry_date?1:0})
   row.product_id=id;created.set(row.sku,id)
  }
 }
 const products=[...new Set(rows.map(row=>row.product_id))]
 const placeholders=products.map(()=>'?').join(',')
 const reads:Record<string,()=>Record<string,any>[]>={}
 reads.suppliers=()=>db.prepare('SELECT * FROM suppliers WHERE id=?').all(supplierId) as Record<string,any>[]
 for(const table of ['products','stocks','product_batches'])reads[table]=()=>db.prepare(`SELECT * FROM ${table} WHERE ${table==='products'?'id':'product_id'} IN (${placeholders})`).all(...products) as any[]
 reads.purchase_orders=()=>db.prepare('SELECT * FROM purchase_orders WHERE id=?').all(jobId) as any[]
 reads.purchase_items=()=>db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(jobId) as any[]
 reads.purchase_attachments=()=>db.prepare('SELECT * FROM purchase_attachments WHERE purchase_id=?').all(jobId) as any[]
 reads.stock_movements=()=>db.prepare('SELECT * FROM stock_movements WHERE reference_order_id=?').all(jobId) as any[]
 // ImportEffects captures and queues the complete receipt within its owning transaction.
 effects.observe(reads,()=>createStockPurchase(db,{id:jobId,poNumber:`IMP-${jobId}`,branchId:actor.branchId,userId:actor.userId,supplierId:first.supplier_id,purchaseType:'direct',purchaseDate:first.purchase_date,invoiceNumber:first.invoice_no,notes:`Stock-in import ${jobId}`,items:rows.map(row=>({...row,product_id:row.product_id,quantity:row.quantity,unit_cost:row.cost_price,free_quantity:row.free_quantity??0,discount_amount:row.discount_amount??0,mrp:row.mrp??null,entry_unit:row.unit||undefined,selling_price:row.selling_price,batch_number:row.batch_no,expiry_date:row.expiry_date}))},saveBills,false))
 return effects
}
