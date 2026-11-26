import type Database from 'better-sqlite3'
import {importDate,importNumber,type ImportOptions,importType} from '../lib/importRegistry'
import {splitMasterName,validateMasterName} from '../lib/masterNames'
import {normalizeKeyword,validateKeyword} from '../lib/keywordText'
import {inspectBatch,batchDates} from './batchIdentity'
import {createHash} from 'crypto'
import {purchaseLine,validateMrp} from '../lib/purchaseMath'
import {stockUnitFactor} from '../lib/inventoryUnits'
export interface ImportIssue {field:string;severity:'error'|'warning';message:string}
export interface ValidatedImportRow {data:Record<string,any>;target:Record<string,any>|null;issues:ImportIssue[];skip:boolean}
export function validateImportRow(db:Database.Database,type:string,input:Record<string,unknown>,options:ImportOptions,context:{branchId:string;userId?:string;terminalId?:string;admin:boolean;keywordsEnabled:boolean;uniqueCodes:boolean;format:'xlsx'|'delimited'}):ValidatedImportRow {
 const data:Record<string,any>={};const issues:ImportIssue[]=[];let skip=false
 const issue=(field:string,message:string,severity:'error'|'warning'='error')=>issues.push({field,message,severity})
 for(const field of importType(type).fields){data[field.key]=String(input[field.key]??'').trim();if(field.required&&!data[field.key])issue(field.key,`${field.label} is required`)}
 let target:Record<string,any>|null=null
 const hasProducts=['products','opening_stock','stock_in','prices','keywords','brands'].includes(type)
 if(hasProducts&&data.sku){const matches=db.prepare('SELECT * FROM products WHERE LOWER(TRIM(sku))=LOWER(?)').all(data.sku) as Record<string,any>[];if(matches.length>1)issue('sku','SKU is ambiguous in existing catalog');target=matches[0]||null
  if(target&&!target.is_active)issue('sku','Product is inactive; review it before importing')
  if(!target&&type!=='products'&&type!=='stock_in')issue('sku','Unknown SKU; import the master product first')
  if(target?.branch_id&&target.branch_id!==context.branchId&&!context.admin)issue('sku','Product belongs to another branch')
 }
 if(type==='stock_in'){
  if(!target){
   const matches=data.barcode?db.prepare('SELECT * FROM products WHERE barcode=?').all(data.barcode):data.name?db.prepare('SELECT * FROM products WHERE LOWER(TRIM(name))=LOWER(?)').all(data.name):[]
   if(matches.length>1)issue('barcode','Product identity is ambiguous; use its exact SKU')
   target=matches[0] as Record<string,any>||null
  }
  if(target){
   if(!target.is_active)issue('sku','Product is inactive')
   if(data.sku&&data.sku.toLowerCase()!==String(target.sku).toLowerCase())issue('sku','SKU and barcode or product name identify different products')
   if(data.barcode&&target.barcode&&data.barcode!==target.barcode)issue('barcode','Barcode conflicts with the existing product')
   if(target.branch_id&&target.branch_id!==context.branchId&&!context.admin)issue('sku','Product belongs to another branch')
   data.sku=target.sku
  }else if(options.unknown==='create'&&context.admin){
   if(!data.name)issue('name','Product name is required to create a missing product')
   else for(const error of validateMasterName(data.name).issues)issue('name',error.message)
   data.sku=data.sku||`GRO-${createHash('sha256').update(data.barcode||data.name.toLowerCase()).digest('hex').slice(0,12).toUpperCase()}`
   data._create_product=true
  }else issue('sku','Unknown product. Map a SKU/barcode/name or choose Auto-create as an Admin.')
 }
 if(type==='categories'||type==='suppliers') {
  const found=db.prepare(`SELECT * FROM ${type} WHERE LOWER(TRIM(name))=LOWER(?)`).all(data.name) as Record<string,any>[]
  if(found.length>1)issue('name','Name is ambiguous in existing master data');target=found[0]||null
  if(target&&!target.is_active)issue('name','This master is inactive; review it before importing')
 }
 if(target&&['products','categories','suppliers','prices','brands'].includes(type)) {
  if(options.duplicate==='skip'){skip=true;issue('sku','Existing record will be skipped','warning')}
  else if(options.duplicate==='error')issue('sku','Record already exists; choose Skip or Update')
 }
 for(const {key:field} of importType(type).fields.filter(field=>field.kind==='number'))if(field in data) {
  try{data[field]=importNumber(data[field],options.decimal);if(field==='tax_rate'&&data[field]>100)throw new Error('Tax must be between 0 and 100');if(field==='quantity'&&!(data[field]>0))throw new Error('Quantity must be greater than zero')}catch(error){issue(field,(error as Error).message)}
 }
 for(const {key:field} of importType(type).fields.filter(field=>field.kind==='date'))if(data[field])try{data[field]=importDate(data[field],options.dateFormat)}catch(error){issue(field,(error as Error).message)}
 if(['opening_stock','stock_in'].includes(type)) {
  if(!target)try{batchDates({product_id:'new',mfg_date:data.mfg_date,expiry_date:data.expiry_date})}catch(error){issue('expiry_date',(error as Error).message)}
  if(target)try{
   const check=inspectBatch(db,{product_id:target.id,batch_number:data.batch_no,expiry_date:data.expiry_date,mfg_date:data.mfg_date})
   if(check.existing){issue('batch_no',`Already added: quantity ${check.existing.quantity}, entered ${check.existing.entered_at}. Explicitly choose Add quantity to existing batches.`,options.acknowledgeBatches?'warning':'error');if(options.acknowledgeBatches){data.batch_resolution='add_existing';data.existing_batch_id=check.existing.id;data.mfg_date=check.existing.mfg_date||undefined}}
   for(const warning of check.warnings)issue('expiry_date',warning,options.acknowledgeBatches?'warning':'error')
   data.acknowledge_dates=options.acknowledgeBatches===true
  }catch(error){issue('expiry_date',(error as Error).message)}
  if(Number.isFinite(data.quantity)){data.quantity=Math.round(data.quantity*1e6)/1e6;if(data.quantity<=0)issue('quantity','Quantity is smaller than supported precision')}
  if(data.cost_price===undefined)issue('cost_price','Cost price is required')
  if(type==='stock_in'&&!(data.cost_price>0))issue('cost_price','Supplier purchase cost must be greater than zero')
  if(target?.track_expiry&&!data.expiry_date)issue('expiry_date','Expiry date is required for this product')
  if(data.expiry_date&&data.purchase_date&&data.expiry_date<data.purchase_date)issue('expiry_date','Expiry precedes the stock / purchase date')
  if(!data.purchase_date&&type==='opening_stock')data.purchase_date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
  if(target&&(db.prepare('SELECT COUNT(*) n FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(target.id,context.branchId) as {n:number}).n>1)issue('quantity','Duplicate branch stock balances require reconciliation')
  if(type==='stock_in'&&target&&data.selling_price===undefined&&!(Number(target.selling_price)>0))issue('selling_price','A selling price is required; this product has no common selling price')
  if(type==='stock_in')try{
   const packs=target&&data.unit?db.prepare('SELECT uom_name,conversion_factor FROM product_uom WHERE product_id=? AND is_base=0').all(target.id) as {uom_name:string;conversion_factor:number}[]:[]
   const factor=target&&data.unit?stockUnitFactor(data.unit,target.unit||'pcs',packs):1
   purchaseLine(data.quantity,data.cost_price,data.free_quantity??0,data.discount_amount??0,factor)
   if(!target&&!(data.selling_price>0))throw new Error('Selling price is required for new products')
   const tax=1+Number(target?.tax_rate||0)/100
   validateMrp(data.selling_price==null?Number(target?.selling_price||0)*tax:data.selling_price/factor*tax,data.mrp==null?null:data.mrp/factor)
  }catch(error){issue('quantity',(error as Error).message)}
 }
 const aliases:string[]=[]
 if(type==='products') {
  if(options.splitNames) {
   const split=splitMasterName(data.name,{format:context.format,repairMojibake:true,slashMode:options.slashMode})
   data.original_name=data.name;data.name=split.masterName;aliases.push(...split.keywords.map(row=>row.keyword))
   for(const warning of split.warnings)issue('name',warning.message,'warning')
   if(split.needsReview)issue('name','Review the cleaned English name and extracted aliases before commit','warning')
  }
  const validation=validateMasterName(data.name);for(const error of validation.issues)issue('name',error.message)
  if(target&&target.name!==data.name&&db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_items'").get()&&db.prepare('SELECT 1 FROM invoice_items WHERE product_id=? LIMIT 1').get(target.id))issue('name','Existing sales reference this master name; preserve it and use keywords instead')
  if(data.barcode){const conflict=db.prepare('SELECT name FROM products WHERE barcode=? AND id!=?').get(data.barcode,target?.id||'') as {name:string}|undefined;if(conflict)issue('barcode',`Barcode belongs to ${conflict.name}`)}
  if(data.keywords)aliases.push(...data.keywords.split(options.keywordDelimiter).map((value:string)=>value.trim()).filter(Boolean))
  if(data.quick_code)aliases.push(data.quick_code)
  if(!target&&data.selling_price===undefined)issue('selling_price','Selling price defaults to zero; review before import','warning')
 }
 if(type==='prices'&&data.cost_price===undefined&&data.selling_price===undefined)issue('selling_price','Map at least one price')
 if(type==='keywords') {
  data.scope=data.scope||'global'
  if(!['global','branch','terminal','user'].includes(data.scope))issue('scope','Choose global, branch, terminal or user')
  if(data.keyword_type&&!['word','tanglish','native_script','code'].includes(data.keyword_type))issue('keyword_type','Unsupported keyword type')
  aliases.push(data.keyword)
  if(context.keywordsEnabled) {
   const scopeKey=data.scope==='global'?'global':`${data.scope}:${data.scope==='branch'?context.branchId:data.scope==='user'?context.userId:context.terminalId}`
   const existing=db.prepare('SELECT id,version FROM product_search_keywords WHERE product_id=? AND keyword_normalized=? AND scope_key=?').get(target?.id||'',normalizeKeyword(data.keyword),scopeKey) as {id:string;version:number}|undefined
   if(existing) {
    data._keyword_id=existing.id;data._keyword_version=existing.version
    if(options.duplicate==='skip'){skip=true;issue('keyword','Existing keyword will be skipped','warning')}
    else if(options.duplicate==='error')issue('keyword','Keyword already exists; choose Skip or Update')
   }
  }
 }
 data._aliases=[...new Set(aliases)]
 if(aliases.length&&!context.keywordsEnabled)issue('keywords','Enable Search Keywords before importing aliases; no aliases will be silently discarded')
 for(const alias of data._aliases)try {
  const text=validateKeyword(alias)
  if(context.keywordsEnabled&&context.uniqueCodes&&(/^\d+$/.test(text.normalized)||data.keyword_type==='code'||alias===data.quick_code)) {
   const conflict=db.prepare("SELECT p.name FROM product_search_keywords k JOIN products p ON p.id=k.product_id WHERE k.keyword_normalized=? AND k.is_active=1 AND k.review_status='approved' AND p.is_active=1 AND p.id!=? LIMIT 1").get(normalizeKeyword(alias),target?.id||'') as {name:string}|undefined
   if(conflict)issue('keywords',`Code already belongs to ${conflict.name}`)
   const master=db.prepare('SELECT name FROM products WHERE id!=? AND is_active=1 AND (LOWER(TRIM(sku))=? OR LOWER(TRIM(barcode))=?) LIMIT 1').get(target?.id||'',text.normalized,text.normalized) as {name:string}|undefined
   if(master)issue('keywords',`Code conflicts with SKU/barcode of ${master.name}`)
  }
 }catch(error){issue('keywords',(error as Error).message)}
 for(const field of ['category','supplier'])if(data[field]) {
  const table=field==='category'?'categories':'suppliers'
  const found=db.prepare(`SELECT id FROM ${table} WHERE LOWER(TRIM(name))=LOWER(?) AND is_active=1`).all(data[field]) as {id:string}[]
  if(found.length>1)issue(field,`Ambiguous ${field}; map it to an exact active name`)
  if(found.length===1)data[field+'_id']=found[0].id
  else if(!found.length) {
   if(options.unknown==='skip'){skip=true;issue(field,`Unknown ${field}; row will be skipped`,'warning')}
   else if(options.unknown!=='create'||!context.admin)issue(field,`Unknown ${field}; use an existing name${context.admin?' or choose Auto-create':''}`)
   else if(!validateMasterName(data[field]).valid)issue(field,'Use a clean Latin master name for automatic creation')
   else issue(field,`${field} will be created: ${data[field]}`,'warning')
  }
 }
 if(type==='stock_in'&&data.supplier_id&&data.invoice_no&&db.prepare('SELECT 1 FROM purchase_orders WHERE supplier_id=? AND supplier_invoice_number=?').get(data.supplier_id,data.invoice_no))issue('invoice_no','This supplier invoice is already saved; open its existing purchase')
 if(type==='suppliers'&&data.email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email))issue('email','Invalid email address')
 for(const field of ['name','category','supplier','brand'])if(data[field]&&['categories','suppliers','brands'].includes(type)&&!validateMasterName(data[field]).valid)issue(field,'Use a clean Latin master value')
 return {data,target,issues,skip}
}
