import type {QueryClient} from './db'
export async function validateSyncedBatch(client:QueryClient,record:Record<string,unknown>,id:string){
 const expiry=String(record.expiry_date||''),mfg=String(record.mfg_date||''),no=String(record.batch_number||'').normalize('NFC').trim()
 for(const date of [expiry,mfg])if(date&&(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date))||new Date(date).toISOString().slice(0,10)!==date))throw new Error('Invalid batch date')
 if(expiry&&mfg&&expiry<=mfg)throw new Error('Expiry date must be after Manufacture date')
 const {rows:old}=await client.query<Record<string,unknown>>('SELECT * FROM product_batches WHERE id=?',[id])
 if(old.length&&['product_id','batch_number','expiry_date','mfg_date','batch_identity_id'].every(key=>record[key]===undefined||String(record[key]||'')===String(old[0][key]||'')))return
 if(!no)return
 if(record.batch_identity_id)await client.query('SELECT id FROM product_batch_identities WHERE id=? FOR UPDATE',[record.batch_identity_id])
 const {rows:duplicates}=await client.query('SELECT id,quantity,created_at FROM product_batches WHERE product_id=? AND TRIM(batch_number)=? AND COALESCE(expiry_date,\'\')=? AND id<>? FOR UPDATE',[record.product_id,no,expiry,id])
 if(duplicates.length&&record.batch_entry_mode!=='add_existing')throw new Error('Idhu already add panni irukku — explicit add_existing batch resolution is required')
 const {rows:variants}=await client.query<Record<string,unknown>>('SELECT expiry_date,mfg_date FROM product_batches WHERE product_id=? AND TRIM(batch_number)=? AND id<>?',[record.product_id,no,id])
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date())
 if((expiry&&expiry<today||variants.some(row=>String(row.expiry_date||'')!==expiry||String(row.mfg_date||'')!==mfg))&&record.batch_warning_ack!==1&&record.batch_warning_ack!==true)throw new Error('Expired or different batch dates require explicit warning acknowledgment')
 if(!record.batch_identity_id)throw new Error('Batch identity is required; upgrade the receiving client')
 const {rows:identities}=await client.query<Record<string,unknown>>('SELECT * FROM product_batch_identities WHERE id=?',[record.batch_identity_id])
 const key=identities[0]
 if(!key||key.product_id!==record.product_id||key.batch_no!==no||String(key.expiry_date||'')!==expiry||String(key.mfg_date||'')!==mfg||key.needs_review)throw new Error('Physical batch identity mismatch or review required')
}
