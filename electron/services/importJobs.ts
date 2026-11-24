import type Database from 'better-sqlite3'
import {createHash,randomUUID} from 'crypto'
import {importType,normalizeImportOptions,validateImportMapping,suggestImportMapping,importCsv,type ImportOptions} from '../lib/importRegistry'
import {readImportFile,importLimits,type ImportLimits} from './importFile'
import {importsInstalled} from './importMigration'
import {validateImportRow,type ImportIssue} from './importValidation'
import {ImportEffects,stableImportRow,type ImportEffect} from './importEffects'
import {writeImportRow,writeImportReceipt} from './importWriter'
import type {KeywordActor} from './keywords'
import {canManageProcurement,canManageAllBranchStock,resolveMainBranchId} from './branchAccess'
interface Job extends Record<string,any> {id:string;type:string;owner_id:string;branch_id:string;status:string;options_json:string;mapping_json:string;sheet_name:string;header_row:number;file_data:Buffer|null;filename:string;file_hash:string;applied_rows:number;error_rows:number;warning_rows:number;valid_rows:number;skipped_rows:number;review_token:string|null}
interface StagedRow extends Record<string,any>{id:string;row_number:number;raw_json:string;normalized_json:string;target_json:string;status:string;issues_json:string;effects_json:string}
export interface ImportConfig {enabled:boolean;keywordsEnabled:boolean;uniqueCodes:boolean;limits?:Partial<ImportLimits>;assertContext?:()=>void;actor?:()=>KeywordActor}
const running=new WeakMap<Database.Database,Set<string>>()
const recovered=new WeakSet<Database.Database>()
export class ImportJobs {
 readonly limits:ImportLimits
 constructor(readonly db:Database.Database,readonly actor:KeywordActor,readonly config:ImportConfig){
  this.limits=importLimits(config.limits)
  if(importsInstalled(db)&&!recovered.has(db)){db.prepare("UPDATE import_jobs SET status='failed',last_error='Interrupted: resume this job to continue unapplied rows' WHERE status='committing'").run();recovered.add(db)}
 }
 private access(type:string) {
  this.config.assertContext?.()
  if(!this.config.enabled||!importsInstalled(this.db))throw new Error('Bulk Import v2 is disabled')
  const definition=importType(type),actor=this.config.actor?.()||this.actor
  if(!this.db.prepare('SELECT 1 FROM branches WHERE id=? AND is_active=1').get(this.actor.branchId))throw new Error('Choose an active terminal branch before importing')
  if(actor.userId!==this.actor.userId||actor.branchId!==this.actor.branchId)throw new Error('Import session changed; reopen the job with its owner')
  if(definition.admin&&!actor.permissions.all)throw new Error('Company Admin access required for this import type')
  if(!actor.permissions.all&&!actor.permissions[definition.permission])throw new Error(`Permission required: ${definition.permission}`)
  const user={branch_id:actor.branchId,permissions:actor.permissions}
  if(type==='stock_in'&&!canManageProcurement(this.db,user))throw new Error('Supplier stock-in imports must use the main branch procurement workflow')
  if(type==='opening_stock'&&!canManageAllBranchStock(this.db,user))throw new Error('Opening stock imports require existing manual stock access')
 }
 private job(id:string,withFile=false) {
  const columns=withFile?'*':(this.db.prepare('PRAGMA table_info(import_jobs)').all() as {name:string}[]).filter(row=>row.name!=='file_data').map(row=>'"'+row.name.replace(/"/g,'""')+'"').join(',')+',NULL AS file_data'
  const job=this.db.prepare(`SELECT ${columns} FROM import_jobs WHERE id=?`).get(id) as Job|undefined
  if(!job)throw new Error('Import job not found')
  this.access(job.type)
  if(job.owner_id!==this.actor.userId&&!this.actor.permissions.all)throw new Error('Import job belongs to another user')
  if(job.branch_id!==this.actor.branchId&&!this.actor.permissions.all)throw new Error('Import job belongs to another branch')
  return job
 }
 private mutable(job:Job){if(job.owner_id!==this.actor.userId)throw new Error('Only the importing user can edit this staged job');if(job.applied_rows||job.status==='committing'||job.status==='completed'||job.status==='rolled_back')throw new Error('This job has committed data; resume or roll back instead of remapping')}
 private patch(id:string,values:Record<string,any>){const fields={...values,updated_at:new Date().toISOString()};this.db.prepare(`UPDATE import_jobs SET ${Object.keys(fields).map(key=>key+'=@'+key).join(',')} WHERE id=@id`).run({...fields,id})}
 private audit(id:string,action:string,summary:Record<string,unknown>={}) {
  const target=this.db.prepare('SELECT branch_id FROM import_jobs WHERE id=?').get(id) as {branch_id:string}|undefined
  const row={id:randomUUID(),user_id:this.actor.userId,branch_id:target?.branch_id||this.actor.branchId,action,table_name:'import_jobs',record_id:id,new_values:JSON.stringify(summary),created_at:new Date().toISOString(),updated_at:new Date().toISOString()}
  this.db.prepare('INSERT INTO audit_logs(id,user_id,branch_id,action,table_name,record_id,new_values) VALUES(@id,@user_id,@branch_id,@action,@table_name,@record_id,@new_values)').run(row)
  this.db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES(?,?,?,?,?)').run(randomUUID(),'audit_logs',row.id,'INSERT',JSON.stringify(row))
 }
 upload(type:string,filename:string,bytes:Buffer) {
  this.access(type);const parsed=readImportFile(bytes,filename,this.limits)
  const id=randomUUID(),now=new Date().toISOString(),retained=new Date(Date.now()+Math.max(this.limits.retentionDays*86400_000,this.limits.rollbackHours*3600_000)).toISOString()
  this.db.transaction(()=>{
   this.db.prepare('INSERT INTO import_jobs(id,type,owner_id,branch_id,filename,file_hash,file_data,created_at,updated_at,retained_until,encoding_label,warnings_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(id,type,this.actor.userId,type==='stock_in'?resolveMainBranchId(this.db):this.actor.branchId,filename,createHash('sha256').update(bytes).digest('hex'),bytes,now,now,retained,parsed.label,JSON.stringify(parsed.warnings))
   this.audit(id,'IMPORT_UPLOADED',{type,filename,bytes:bytes.length})
  }).immediate()
  return this.describe(id)
 }
 describe(id:string,request?:{sheetName?:string;headerRow?:number;options?:Partial<ImportOptions>}) {
  const job=this.job(id,true),options=normalizeImportOptions(request?.options||JSON.parse(job.options_json))
  if(!job.file_data)throw new Error('Staged file was purged after its retention period')
  const parsed=readImportFile(job.file_data,job.filename,this.limits,options.encoding,options.delimiter)
  const sheetName=request?.sheetName||job.sheet_name||Object.keys(parsed.sheets)[0],grid=parsed.sheets[sheetName]
  if(!grid)throw new Error('Select a sheet from this workbook')
  const headerRow=request?.headerRow??job.header_row
  if(!Number.isInteger(headerRow)||headerRow<0||headerRow>=grid.length)throw new Error('Choose an existing header / first-data row')
  const width=Math.max(...grid.slice(headerRow).map(row=>row.length)),headers=Array.from({length:width},(_,i)=>options.hasHeader?grid[headerRow][i]||`Column ${i+1}`:`Column ${i+1}`)
  return {id,type:job.type,sheetName,headerRow,options,encoding:parsed.label,warnings:parsed.warnings,sheets:Object.entries(parsed.sheets).map(([name,rows])=>({name,rows:rows.length})),headers,preview:grid.slice(headerRow+(options.hasHeader?1:0),headerRow+(options.hasHeader?1:0)+20),suggestedMapping:suggestImportMapping(job.type,headers)}
 }
 map(id:string,input:{sheetName:string;headerRow:number;mapping:Record<string,number>;options:Partial<ImportOptions>}) {
  const job=this.job(id);this.mutable(job)
  const description=this.describe(id,input),options=description.options
  for(const [key,value] of Object.entries(options.defaults))if(!importType(job.type).fields.some(field=>field.key===key)||typeof value!=='string')throw new Error('Invalid default field')
  validateImportMapping(job.type,input.mapping,description.headers.length,options.defaults)
  this.db.transaction(()=>{this.db.prepare('DELETE FROM import_job_rows WHERE job_id=?').run(id);this.patch(id,{sheet_name:input.sheetName,header_row:input.headerRow,mapping_json:JSON.stringify(input.mapping),options_json:JSON.stringify(options),status:'mapped',review_token:null,encoding_label:description.encoding,warnings_json:JSON.stringify(description.warnings),last_error:null});this.audit(id,'IMPORT_MAPPING_SAVED')}).immediate()
  return description
 }
 validate(id:string) {
  const job=this.job(id,true);this.mutable(job)
  if(!['mapped','validated','failed'].includes(job.status))throw new Error('Save column mapping first')
  const options=normalizeImportOptions(JSON.parse(job.options_json)),mapping=JSON.parse(job.mapping_json) as Record<string,number>
  const parsed=readImportFile(job.file_data!,job.filename,this.limits,options.encoding,options.delimiter),grid=parsed.sheets[job.sheet_name]
  const description=this.describe(id);validateImportMapping(job.type,mapping,description.headers.length,options.defaults)
  const rows:StagedRow[]=[],seen=new Set<string>(),codes=new Map<string,string>(),invoices=new Set<string>()
  for(let index=job.header_row+(options.hasHeader?1:0);index<grid.length;index++) {
   const raw=grid[index];if(!raw.some(value=>String(value).trim()))continue
   const input:Record<string,unknown>={...options.defaults};for(const [field,column] of Object.entries(mapping))if(column>=0&&String(raw[column]??'').trim())input[field]=raw[column]
   const result=validateImportRow(this.db,job.type,input,options,{branchId:job.branch_id,userId:this.actor.userId,terminalId:this.actor.terminalId,admin:Boolean(this.actor.permissions.all),keywordsEnabled:this.config.keywordsEnabled,uniqueCodes:this.config.uniqueCodes,format:parsed.format})
   const data=result.data,issues=result.issues
   const identity=(job.type==='keywords'?[data.sku,data.keyword,data.scope]:['stock_in','opening_stock'].includes(job.type)?[data.sku,data.batch_no,data.expiry_date]:[data.sku||data.name]).join('|').toLowerCase()
   if(seen.has(identity)){if(options.duplicate==='skip'){result.skip=true;issues.push({field:'sku',severity:'warning',message:'Repeated file record will be skipped'})}else issues.push({field:'sku',severity:'error',message:'Repeated record in this file; combine quantities or provide distinct batch numbers'})}seen.add(identity)
   if(this.config.uniqueCodes&&['products','keywords'].includes(job.type))for(const code of [data.sku,data.barcode,...(data._aliases||[]).filter((value:string)=>/^\d+$/.test(value)||value===data.quick_code||data.keyword_type==='code')].filter(Boolean)) {
    const key=String(code).normalize('NFC').toLowerCase(),owner=String(data.sku).toLowerCase()
    if(codes.has(key)&&codes.get(key)!==owner)issues.push({field:'keywords',severity:'error',message:`Code ${code} also appears on SKU ${codes.get(key)}`});else codes.set(key,owner)
   }
   if(job.type==='stock_in')invoices.add([data.supplier,data.invoice_no,data.purchase_date].join('|'))
   rows.push({id:randomUUID(),job_id:id,row_number:index+1,raw_json:JSON.stringify(raw),normalized_json:JSON.stringify(data),target_json:JSON.stringify(result.target),issues_json:JSON.stringify(issues),effects_json:'[]',status:issues.some(issue=>issue.severity==='error')?'error':result.skip?'skipped':'valid'})
  }
  if(rows.length>this.limits.maxRows)throw new Error('Row limit exceeded')
  if(job.type==='stock_in'&&(invoices.size>1||rows.length>2000))throw new Error('Stock-in uses one supplier invoice/date per file, up to 2,000 rows; split separate bills into separate jobs')
  if(!rows.length)throw new Error('No non-empty data rows found')
  this.db.transaction(()=>{
   this.db.prepare('DELETE FROM import_job_rows WHERE job_id=?').run(id)
   const insert=this.db.prepare('INSERT INTO import_job_rows(id,job_id,row_number,raw_json,normalized_json,target_json,issues_json,effects_json,status) VALUES(@id,@job_id,@row_number,@raw_json,@normalized_json,@target_json,@issues_json,@effects_json,@status)');for(const row of rows)insert.run(row)
   this.patch(id,{status:'validated',review_token:randomUUID(),total_rows:rows.length,valid_rows:rows.filter(row=>row.status==='valid').length,error_rows:rows.filter(row=>row.status==='error').length,warning_rows:rows.filter(row=>JSON.parse(row.issues_json).some((issue:ImportIssue)=>issue.severity==='warning')).length,skipped_rows:rows.filter(row=>row.status==='skipped').length,last_error:null})
   this.audit(id,'IMPORT_VALIDATED',{rows:rows.length})
  }).immediate()
  return this.status(id)
 }
 status(id:string) {
  const {file_data,...job}=this.job(id)
  const errors=this.db.prepare("SELECT row_number,status,issues_json,normalized_json FROM import_job_rows WHERE job_id=? AND (status='error' OR issues_json!='[]') ORDER BY row_number LIMIT 200").all(id) as Record<string,any>[]
  const sample=this.db.prepare('SELECT row_number,status,normalized_json FROM import_job_rows WHERE job_id=? ORDER BY row_number LIMIT 20').all(id) as Record<string,any>[]
  const branch=this.db.prepare('SELECT name FROM branches WHERE id=?').get(job.branch_id) as {name:string}|undefined
  return {...job,branch_name:branch?.name||job.branch_id,sample:sample.map(row=>({...row,data:JSON.parse(row.normalized_json||'{}')})),rows:errors.map(row=>({...row,issues:JSON.parse(row.issues_json),data:JSON.parse(row.normalized_json||'{}')}))}
 }
 history(){if(!this.config.enabled||!importsInstalled(this.db))return [];return this.db.prepare(`SELECT j.id,j.type,j.filename,j.status,j.total_rows,j.applied_rows,j.error_rows,j.owner_id,j.created_at,j.committed_at,j.last_error,COALESCE(u.name,j.owner_id) AS owner_name,COALESCE(b.name,j.branch_id) AS branch_name FROM import_jobs j LEFT JOIN users u ON u.id=j.owner_id LEFT JOIN branches b ON b.id=j.branch_id ${this.actor.permissions.all?'':'WHERE j.owner_id=? AND j.branch_id=?'} ORDER BY j.created_at DESC LIMIT 100`).all(...(this.actor.permissions.all?[]:[this.actor.userId,this.actor.branchId]))}
 errorCsv(id:string){this.job(id);const rows=this.db.prepare("SELECT row_number,status,issues_json FROM import_job_rows WHERE job_id=? AND issues_json!='[]' ORDER BY row_number").all(id) as StagedRow[];return importCsv([['Row','Status','Field','Severity','Message'],...rows.flatMap(row=>(JSON.parse(row.issues_json) as ImportIssue[]).map(issue=>[row.row_number,row.status,issue.field,issue.severity,issue.message]))])}
 async commit(id:string,saveBills?: (purchaseId:string)=>void,reviewToken?:string) {
  const job=this.job(id),options=normalizeImportOptions(JSON.parse(job.options_json))
  if(job.owner_id!==this.actor.userId)throw new Error('Only the importing user can commit or resume this job')
  if(job.status==='completed')return this.status(id)
  if(!reviewToken||job.review_token!==reviewToken)throw new Error('Validation changed; review the latest dry run before committing')
  if(!['validated','failed','partial'].includes(job.status))throw new Error('Validate this job before commit')
  if(!running.has(this.db))running.set(this.db,new Set())
  if(running.get(this.db)!.has(id))throw new Error('Import is already running')
  if(options.allOrNothing&&job.error_rows)throw new Error('All-or-nothing commit requires zero validation errors')
  const dedupe=createHash('sha256').update([job.type,job.branch_id,job.file_hash,job.sheet_name].join('|')).digest('hex')
  const previous=this.db.prepare('SELECT id FROM import_jobs WHERE dedupe_key=? AND id!=?').get(dedupe,id) as {id:string}|undefined
  if(previous)throw new Error(`This file/sheet/type was already committed or started (${previous.id}); resume that job instead`)
  const pending=this.db.prepare("SELECT * FROM import_job_rows WHERE job_id=? AND status='valid' ORDER BY row_number").all(id) as StagedRow[]
  if(!pending.length&&job.applied_rows>0){this.patch(id,{status:'completed',last_error:null});return this.status(id)}
  if(!pending.length)throw new Error('No validated unapplied rows remain')
  if(options.allOrNothing&&pending.length>2000)throw new Error('All-or-nothing is limited to 2,000 rows; choose chunked valid-rows import')
  const claim=this.db.prepare("UPDATE import_jobs SET dedupe_key=?,status='committing',last_error=NULL,updated_at=? WHERE id=? AND status IN ('validated','failed','partial')").run(dedupe,new Date().toISOString(),id)
  if(!claim.changes)throw new Error('Import state changed; another worker may already be committing it')
  running.get(this.db)!.add(id)
  const actor={...this.actor,branchId:job.branch_id}
  const check=(row:StagedRow)=>{
   const data=JSON.parse(row.normalized_json),target=JSON.parse(row.target_json)
   if(target) {const table=['categories','suppliers'].includes(job.type)?job.type:'products';const current=this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(target.id) as Record<string,any>|undefined;if(stableImportRow(current||null)!==stableImportRow(target))throw new Error(`Row ${row.row_number}: target changed after validation; review before retrying`)}
   else if(job.type==='products'&&this.db.prepare('SELECT 1 FROM products WHERE LOWER(TRIM(sku))=LOWER(?)').get(data.sku))throw new Error(`Row ${row.row_number}: SKU was created after validation`)
   // Validate live dependencies and flags again, never trust renderer/stored row edits.
   const live=validateImportRow(this.db,job.type,data,{...options,duplicate:'update',splitNames:false,decimal:'.',dateFormat:'YYYY-MM-DD'},{branchId:job.branch_id,userId:actor.userId,terminalId:actor.terminalId,admin:Boolean(actor.permissions.all),keywordsEnabled:this.config.keywordsEnabled,uniqueCodes:this.config.uniqueCodes,format:'xlsx'})
   const failures=live.issues.filter(issue=>issue.severity==='error');if(failures.length)throw new Error(`Row ${row.row_number}: ${failures.map(issue=>issue.message).join('; ')}`)
   for(const field of ['category_id','supplier_id'])if(data[field]&&data[field]!==live.data[field])throw new Error(`Row ${row.row_number}: referenced master changed after validation`)
   return {data,target}
  }
  let currentRow:number|undefined
  try {
   const chunks=job.type==='stock_in'||options.allOrNothing?[pending]:Array.from({length:Math.ceil(pending.length/this.limits.chunkSize)},(_,i)=>pending.slice(i*this.limits.chunkSize,(i+1)*this.limits.chunkSize))
   for(const chunk of chunks) {
    currentRow=chunk[0].row_number
    this.access(job.type)
    this.db.transaction(()=>{
     if(job.type==='stock_in') {
      const states=chunk.map(row=>(this.db.prepare('SELECT status FROM import_job_rows WHERE id=?').get(row.id) as {status:string}).status)
      if(states.every(status=>status==='applied'))return
      if(states.some(status=>status!=='valid'))throw new Error('Receipt staging changed; inspect this job before retrying')
      if(!saveBills)throw new Error('Upload the supplier bill before committing stock-in')
      const checked=chunk.map(check),data=checked.map(row=>({...row.data,product_id:row.target!.id}))
      const first=data[0],supplier=this.db.prepare('SELECT id FROM suppliers WHERE LOWER(TRIM(name))=LOWER(?) AND is_active=1').get(first.supplier) as {id:string}|undefined
      if(!supplier)throw new Error('Create or map the supplier before importing its invoice')
      for(const row of data)row.supplier_id=supplier.id
      const effects=writeImportReceipt(this.db,data,actor,id,saveBills);effects.queue(this.config.uniqueCodes)
      for(const row of chunk)this.db.prepare("UPDATE import_job_rows SET status='applied',effects_json=? WHERE id=?").run(row===chunk[0]?JSON.stringify([...effects.effects.values()]):'[]',row.id)
     } else for(const row of chunk) {
      const state=this.db.prepare('SELECT status FROM import_job_rows WHERE id=?').get(row.id) as {status:string}
      if(state.status==='applied')continue
      if(state.status!=='valid')throw new Error('Import row state changed before commit')
      currentRow=row.row_number
      const {data,target}=check(row)
      const effects=writeImportRow(this.db,job.type,data,target,options,actor,id,this.config.uniqueCodes);effects.queue(this.config.uniqueCodes)
      this.db.prepare("UPDATE import_job_rows SET status='applied',effects_json=? WHERE id=?").run(JSON.stringify([...effects.effects.values()]),row.id)
     }
     const count=(this.db.prepare("SELECT COUNT(*) n FROM import_job_rows WHERE job_id=? AND status='applied'").get(id) as {n:number}).n
     const committed=(this.db.prepare('SELECT committed_at FROM import_jobs WHERE id=?').get(id) as {committed_at:string|null}).committed_at
     this.patch(id,{applied_rows:count,committed_at:committed||new Date().toISOString(),retained_until:new Date(Math.max(Date.parse(job.retained_until),Date.now()+this.limits.rollbackHours*3600_000)).toISOString()});this.audit(id,'IMPORT_CHUNK_COMMITTED',{rows:chunk.length,totalApplied:count})
    }).immediate()
    await new Promise<void>(resolve=>setImmediate(resolve))
   }
   this.patch(id,{status:'completed'});return this.status(id)
  }catch(error){const count=(this.db.prepare("SELECT COUNT(*) n FROM import_job_rows WHERE job_id=? AND status='applied'").get(id) as {n:number}).n;const message=(error as Error).message;const detail=currentRow&&!message.startsWith('Row ')?`Row ${currentRow}: ${message}`:message;this.patch(id,{status:count?'partial':'failed',applied_rows:count,last_error:detail});throw new Error(detail)}
  finally{running.get(this.db)!.delete(id)}
 }
 rollback(id:string) {
  const job=this.job(id)
  if(!this.actor.permissions.all)throw new Error('Company Admin access required for rollback')
  if(!['completed','partial','failed'].includes(job.status)||!job.applied_rows)throw new Error('No completed changes to roll back')
  if(Date.now()-Date.parse(job.committed_at||job.updated_at)>this.limits.rollbackHours*3600_000)throw new Error('Rollback window expired')
  if(this.db.prepare("SELECT 1 FROM import_jobs WHERE branch_id=? AND id!=? AND applied_rows>0 AND status!='rolled_back' AND committed_at>? LIMIT 1").get(job.branch_id,id,job.committed_at))throw new Error('Roll back the latest import first')
  const rows=this.db.prepare("SELECT * FROM import_job_rows WHERE job_id=? AND status='applied' ORDER BY row_number DESC").all(id) as StagedRow[]
  const effects=rows.flatMap(row=>JSON.parse(row.effects_json) as ImportEffect[])
  return this.db.transaction(()=>{
   const writer=new ImportEffects(this.db),checked=new Set<string>()
   const affectedProducts=new Set(effects.filter(effect=>effect.table==='products').map(effect=>effect.id))
   for(const effect of effects) {
    const key=effect.table+':'+effect.id
    if(!checked.has(key)&&stableImportRow(writer.row(effect.table,effect.id)||null)!==stableImportRow(effect.after))throw new Error('Imported data changed afterwards; rollback refused')
    if(!checked.has(key)&&effect.movementGuard&&writer.movementGuard(effect.after!.product_id)!==effect.movementGuard)throw new Error('Product has later stock movements; rollback refused')
    checked.add(key)
    const product=effect.table==='products'?effect.id:effect.after?.product_id
    if(product&&this.db.prepare("SELECT 1 FROM sqlite_master WHERE name='invoice_items'").get()&&this.db.prepare('SELECT 1 FROM invoice_items WHERE product_id=? LIMIT 1').get(product))throw new Error('Product has sales history; automatic rollback is refused')
    if(effect.table==='product_batches'&&effect.after&&['sold_quantity','returned_quantity','damaged_quantity'].some(field=>Number(effect.after![field]||0)!==0))throw new Error('Batch was consumed or adjusted; rollback refused')
    if(!effect.before&&['categories','suppliers'].includes(effect.table)) {
     const field=effect.table==='categories'?'category_id':'supplier_id'
     const references=this.db.prepare(`SELECT id FROM products WHERE ${field}=?`).all(effect.id) as {id:string}[]
     if(references.some(row=>!affectedProducts.has(row.id)))throw new Error('A newly created master is used by another product; rollback refused')
    }
    if(!effect.before&&['products','categories','suppliers'].includes(effect.table)) {
     const field=effect.table==='products'?'product_id':effect.table==='categories'?'category_id':'supplier_id'
     const tables=this.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as {name:string}[]
     for(const {name} of tables) {
      const quoted='"'+name.replace(/"/g,'""')+'"'
      const columns=this.db.prepare(`PRAGMA table_info(${quoted})`).all() as {name:string}[]
      if(!columns.some(column=>column.name===field)||!columns.some(column=>column.name==='id'))continue
      const refs=this.db.prepare(`SELECT id FROM ${quoted} WHERE ${field}=?`).all(effect.id) as {id:string}[]
      if(refs.some(row=>!effects.some(owned=>owned.table===name&&owned.id===row.id)))throw new Error('Imported master has later references; rollback refused')
     }
    }
   }
   const versions=new Map(effects.filter(effect=>effect.table==='product_search_keywords').map(effect=>[effect.id,Number(writer.row(effect.table,effect.id)?.version||0)+1]))
   for(const row of rows)for(const effect of (JSON.parse(row.effects_json) as ImportEffect[]).reverse()) {
    const current=writer.row(effect.table,effect.id)
    if(effect.before)writer.put(effect.table,effect.id,{...effect.before,...(effect.table==='product_search_keywords'?{version:versions.get(effect.id)}:{})})
    else if(effect.table==='stocks')writer.put(effect.table,effect.id,{quantity:0,damaged_qty:0})
    else if(effect.table==='product_batches')writer.put(effect.table,effect.id,{quantity:0,original_quantity:0,status:'sold_out'})
    else if(effect.table==='stock_movements')writer.put(effect.table,effect.id,{status:'VOID'})
    else if(effect.table==='purchase_orders')writer.put(effect.table,effect.id,{status:'CANCELLED'})
    else if(effect.table==='purchase_items')writer.put(effect.table,effect.id,{received_qty:0})
    else if(effect.table!=='purchase_attachments')writer.put(effect.table,effect.id,{is_active:0,...(effect.table==='product_search_keywords'?{version:versions.get(effect.id)}:{})})
   }
   writer.queue(this.config.uniqueCodes,true);this.patch(id,{status:'rolled_back',rolled_back_at:new Date().toISOString(),dedupe_key:null});this.audit(id,'IMPORT_ROLLED_BACK',{effects:effects.length});return {id,status:'rolled_back'}
  }).immediate()
 }
 templates(type:string){this.access(type);return this.db.prepare('SELECT * FROM import_mapping_templates WHERE type=? AND owner_id=? ORDER BY name').all(type,this.actor.userId)}
 saveTemplate(id:string,name:string) {
  const job=this.job(id);if(!name.trim()||name.length>100)throw new Error('Template name must be 1–100 characters')
  if(!['mapped','validated'].includes(job.status))throw new Error('Save a mapping before saving its template')
  const description=this.describe(id),now=new Date().toISOString()
  this.db.prepare('INSERT INTO import_mapping_templates(id,type,name,owner_id,mapping_json,options_json,headers_json,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,type,name) DO UPDATE SET mapping_json=excluded.mapping_json,options_json=excluded.options_json,headers_json=excluded.headers_json,updated_at=excluded.updated_at').run(randomUUID(),job.type,name.trim(),this.actor.userId,job.mapping_json,job.options_json,JSON.stringify(description.headers),now,now)
  this.audit(id,'IMPORT_TEMPLATE_SAVED',{name:name.trim()});return this.templates(job.type)
 }
 removeTemplate(id:string){const row=this.db.prepare('SELECT type FROM import_mapping_templates WHERE id=? AND owner_id=?').get(id,this.actor.userId) as {type:string}|undefined;if(!row)throw new Error('Template not found');this.access(row.type);this.db.prepare('DELETE FROM import_mapping_templates WHERE id=? AND owner_id=?').run(id,this.actor.userId);this.audit(id,'IMPORT_TEMPLATE_REMOVED')}
 cancel(id:string){const job=this.job(id);this.mutable(job);const result=this.db.prepare("UPDATE import_jobs SET status='cancelled',dedupe_key=NULL,updated_at=? WHERE id=? AND applied_rows=0 AND status!='committing'").run(new Date().toISOString(),id);if(!result.changes)throw new Error('Import has started; cannot cancel this staged job');this.audit(id,'IMPORT_CANCELLED')}
 purge(){if(!importsInstalled(this.db))return;this.db.transaction(()=>{const ids=this.db.prepare("SELECT id FROM import_jobs WHERE retained_until<? AND status!='committing' AND file_data IS NOT NULL").all(new Date().toISOString()) as {id:string}[];for(const {id} of ids){this.db.prepare("UPDATE import_jobs SET file_data=NULL,status=CASE WHEN status IN ('completed','rolled_back','cancelled') THEN status ELSE 'expired' END WHERE id=?").run(id);this.db.prepare("UPDATE import_job_rows SET raw_json='[]',normalized_json=NULL WHERE job_id=?").run(id)}})()}
}
