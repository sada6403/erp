import type Database from 'better-sqlite3'
import {createHash,randomUUID} from 'crypto'
export interface BatchInput {product_id:string;batch_number?:string|null;expiry_date?:string|null;mfg_date?:string|null;batch_resolution?:'add_existing'|'acknowledge';existing_batch_id?:string;acknowledge_dates?:boolean}
export function batchDates(input:BatchInput) {
 const date=(value:unknown)=>{if(!value)return '';const text=String(value);if(!/^\d{4}-\d{2}-\d{2}$/.test(text)||!Number.isFinite(Date.parse(text))||new Date(text+'T00:00:00Z').toISOString().slice(0,10)!==text)throw new Error('Use a valid YYYY-MM-DD date');return text}
 const expiry=date(input.expiry_date),mfg=date(input.mfg_date)
 if(expiry&&mfg&&expiry<=mfg)throw new Error('Expiry date must be after Manufacture date')
 const no=String(input.batch_number||'').normalize('NFC').trim();if(no.length>191)throw new Error('Batch number must contain at most 191 characters')
 return {expiry,mfg,no}
}
export function inspectBatch(db:Database.Database,input:BatchInput,excludeId?:string) {
 const {expiry,mfg,no}=batchDates(input),warnings:string[]=[]
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 if(expiry&&expiry<today)warnings.push('This batch is already expired')
 if(!no)return {existing:null,warnings,dates:{expiry,mfg,no}}
 const columns=new Set((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).map(row=>row.name))
 const rows=db.prepare('SELECT * FROM product_batches WHERE product_id=? AND TRIM(batch_number)=? AND id!=? ORDER BY created_at,id').all(input.product_id,no,excludeId||'') as Record<string,any>[]
 const matching=rows.filter(row=>String(row.expiry_date||'')===expiry)
 if(rows.some(row=>String(row.expiry_date||'')!==expiry||columns.has('mfg_date')&&String(row.mfg_date||'')!==mfg))warnings.push('Batch number same, aanaal dates vera — batch number is the same but dates differ')
 const existing=matching.length?{id:String(matching[0].batch_identity_id||matching[0].id),quantity:matching.reduce((sum,row)=>sum+Number(row.quantity||0),0),entered_at:matching[0].created_at,mfg_date:matching[0].mfg_date||null,expiry_date:expiry,batch_number:no,layers:matching.length,manufacture_conflict:matching.some(row=>String(row.mfg_date||'')!==mfg)}:null
 return {existing,warnings,dates:{expiry,mfg,no}}
}
/** Must run within the receipt/stock transaction. Multiple receipt cost layers
 * may reference one UNIQUE physical batch, preserving immutable purchase costs. */
export function claimBatch(db:Database.Database,input:BatchInput,excludeId?:string) {
 const check=inspectBatch(db,input,excludeId)
 if(check.existing&&(input.batch_resolution!=='add_existing'||input.existing_batch_id!==check.existing.id))throw new Error(JSON.stringify({code:'BATCH_DUPLICATE',message:'Idhu already add panni irukku — this batch already exists',...check}))
 if(check.warnings.length&&input.acknowledge_dates!==true)throw new Error(JSON.stringify({code:'BATCH_DATE_WARNING',message:check.warnings.join('. '),...check}))
 if(check.existing?.manufacture_conflict&&check.dates.mfg!==String(check.existing.mfg_date||''))throw new Error('Use the existing batch manufacture date, or Cancel and correct the dates')
 const installed=db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='product_batch_identities'").get()
 if(!installed||!check.dates.no)return {id:null,...check.dates}
 const id=createHash('sha256').update(JSON.stringify([input.product_id,check.dates.no,check.dates.expiry])).digest('hex').slice(0,32),now=new Date().toISOString()
 const inserted=db.prepare('INSERT OR IGNORE INTO product_batch_identities(id,product_id,batch_no,expiry_date,mfg_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,input.product_id,check.dates.no,check.dates.expiry,check.dates.mfg||null,now,now)
 const identity=db.prepare('SELECT * FROM product_batch_identities WHERE id=?').get(id) as Record<string,any>
 if(identity.needs_review)throw new Error('Legacy batch manufacture dates conflict; Company Admin must review this physical batch before adding stock')
 if(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='sync_queue'").get())db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES(?,?,?,?,?)').run(randomUUID(),'product_batch_identities',id,'INSERT',JSON.stringify(identity))
 return {id,...check.dates}
}
