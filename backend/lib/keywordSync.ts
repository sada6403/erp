import type {QueryClient} from './db'

/** Runs inside the existing sync transaction. Private aliases never leave desktop. */
export async function applyKeywordSync(client:QueryClient, input:{recordId:string;operation:string;record:Record<string,unknown>}) {
  const r=input.record
  if(!['INSERT','UPDATE'].includes(input.operation))throw new Error('Deactivate keywords instead of deleting them')
  if(!['global','branch'].includes(String(r.scope_type))||r.terminal_id!=null||r.user_id!=null)throw new Error('Private keywords cannot enter company sync')
  if(r.id!==input.recordId||typeof r.keyword!=='string'||!r.keyword.trim()||r.keyword.length>255)throw new Error('Invalid keyword identity or text')
  const normalized=r.keyword.normalize('NFC').replace(/[\u200b-\u200d\ufeff]/g,'').toLowerCase().replace(/\s+/g,' ').trim()
  if(normalized!==r.keyword_normalized||/[?\ufffd\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2060-\u206f]/u.test(r.keyword))throw new Error('Invalid normalized keyword')
  if(r.scope_key!==(r.scope_type==='global'?'global':`branch:${r.branch_id}`)||r.scope_type==='global'&&r.branch_id!=null||r.scope_type==='branch'&&!r.branch_id)throw new Error('Invalid keyword scope')
  if(!Number.isSafeInteger(r.version)||Number(r.version)<1||![0,1,false,true].includes(r.is_active as never))throw new Error('Invalid keyword version or status')
  if(!['word','tanglish','native_script','code'].includes(String(r.keyword_type))||!['latin','tamil','sinhala','numeric'].includes(String(r.script))||!['manual','import','auto_translit'].includes(String(r.source))||!['pending','approved','rejected'].includes(String(r.review_status)))throw new Error('Invalid keyword classification')
  const {rows:products}=await client.query('SELECT id FROM products WHERE id=? AND is_active=1',[r.product_id])
  if(!products.length&&r.is_active)throw new Error('Keyword requires active master product')
  const {rows}=await client.query<Record<string,unknown>>('SELECT * FROM product_search_keywords WHERE id=? FOR UPDATE',[r.id])
  const old=rows[0]
  const {rows:identities}=await client.query<{id:string}>('SELECT id FROM product_search_keywords WHERE product_id=? AND keyword_normalized=? AND scope_key=? FOR UPDATE',[r.product_id,normalized,r.scope_key])
  if(identities.some(row=>row.id!==r.id))throw new Error('Keyword conflict: same keyword was created on another device; review required')
  const content=['product_id','keyword','keyword_normalized','keyword_type','script','source','scope_type','scope_key','branch_id','terminal_id','user_id','parent_id','review_status','created_by','is_active']
  const equal=(a:unknown,b:unknown)=>a==null&&b==null||String(a)===String(b)||typeof a==='boolean'&&Number(a)===Number(b)
  if(old) {
    if(['product_id','scope_key','created_by'].some(key=>!equal(old[key],r[key])))throw new Error('Keyword identity is immutable')
    if(Number(r.version)<Number(old.version))throw new Error('Keyword conflict: cloud has a newer version; review before editing')
    if(Number(r.version)===Number(old.version)) {
      if(content.every(key=>equal(old[key],r[key])))return
      throw new Error('Keyword conflict: concurrent edits require review')
    }
    if(Number(r.version)!==Number(old.version)+1)throw new Error('Keyword conflict: version gap requires review')
  } else if(Number(r.version)!==1)throw new Error('Keyword conflict: missing earlier version')
  if(r._enforce_unique_codes!==false&&r.is_active&&r.review_status==='approved'&&(r.keyword_type==='code'||/^\d+$/.test(normalized))) {
    const {rows:conflicts}=await client.query('SELECT id FROM product_search_keywords WHERE keyword_normalized=? AND product_id<>? AND is_active=1 AND review_status=\'approved\' LIMIT 1',[normalized,r.product_id])
    if(conflicts.length)throw new Error('Keyword code conflict requires review')
    const {rows:masters}=await client.query('SELECT id FROM products WHERE id<>? AND is_active=1 AND (LOWER(TRIM(sku))=? OR LOWER(TRIM(barcode))=?) LIMIT 1',[r.product_id,normalized,normalized])
    if(masters.length)throw new Error('Keyword conflicts with a master SKU/barcode')
  }
  const columns=['id',...content,'created_at','updated_at','version']
  const values=columns.filter(key=>key!=='updated_at').map(key=>key.endsWith('_at')?new Date(String(r[key])).toISOString().slice(0,23).replace('T',' '):r[key]??null)
  await client.query(`INSERT INTO product_search_keywords (${columns.join(',')}) VALUES (${columns.map(key=>key==='updated_at'?'CURRENT_TIMESTAMP(3)':'?').join(',')}) ON DUPLICATE KEY UPDATE ${columns.filter(key=>!['id','created_at','created_by'].includes(key)).map(key=>`${key}=VALUES(${key})`).join(',')}`,values)
}
