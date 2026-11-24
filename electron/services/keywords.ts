import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { normalizeKeyword, validateKeyword, transliterationProposals, type KeywordScope } from '../lib/keywordText'
import { keywordTableExists } from './keywordMigration'

export interface KeywordActor { userId:string; branchId:string; terminalId:string; permissions:Record<string,unknown>; roleName?:string }
export interface KeywordRow extends Record<string,unknown> { id:string; product_id:string; keyword:string; keyword_normalized:string; keyword_type:string; scope_type:KeywordScope; scope_key:string; source:string; branch_id:string|null; terminal_id:string|null; user_id:string|null; review_status:string; is_active:number; version:number }
export function managesKeywords(actor:KeywordActor) {
  return Boolean(actor.permissions.all || actor.permissions['keywords.manage'] === true || actor.permissions['keywords.manage'] === undefined && actor.roleName?.toLowerCase()==='branch manager' && actor.permissions.inventory)
}
export function ownsKeywords(actor:KeywordActor) { return managesKeywords(actor) || actor.permissions['keywords.own']===true || actor.permissions['keywords.own']===undefined && Boolean(actor.permissions.pos) }
export function visibleKeyword(row:KeywordRow,actor:KeywordActor) {
  return row.scope_type==='global' || row.scope_type==='branch' && row.branch_id===actor.branchId || row.scope_type==='terminal' && row.terminal_id===actor.terminalId || row.scope_type==='user' && row.user_id===actor.userId
}
export class KeywordService {
  constructor(readonly db:Database.Database,readonly actor:KeywordActor,private uniqueCodes=true) {}
  private ready() { if(!keywordTableExists(this.db)) throw new Error('Ask Company Admin to enable keywords first') }
  private product(id:string) {
    const product=this.db.prepare('SELECT id,name,branch_id,is_active FROM products WHERE id=?').get(id) as { id:string;name:string;branch_id:string|null;is_active:number }|undefined
    if(!product?.is_active) throw new Error('Choose an active master product')
    if(product.branch_id && product.branch_id!==this.actor.branchId && !this.actor.permissions.all) throw new Error('Product belongs to another branch')
    return product
  }
  private mayWrite(row:KeywordRow) {
    if(this.actor.permissions.all)return
    if(!visibleKeyword(row,this.actor))throw new Error('Keyword belongs to another user, terminal or branch')
    if(row.scope_type==='user' && row.user_id===this.actor.userId && ownsKeywords(this.actor))return
    if(row.scope_type!=='user' && managesKeywords(this.actor))return
    throw new Error('You may manage only your own user keywords')
  }
  private queue(row:KeywordRow) {
    if(!['global','branch'].includes(row.scope_type))return // Private aliases never enter company-wide master sync.
    this.db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES (?,?,?,?,?)')
      .run(randomUUID(),'product_search_keywords',row.id,'INSERT',JSON.stringify({...row,_enforce_unique_codes:this.uniqueCodes}))
  }
  private audit(action:string,id:string,old:unknown,next:unknown) {
    const auditId=randomUUID()
    this.db.prepare('INSERT INTO audit_logs(id,user_id,branch_id,action,table_name,record_id,old_values,new_values) VALUES (?,?,?,?,?,?,?,?)')
      .run(auditId,this.actor.userId,this.actor.branchId||null,action,'product_search_keywords',id,old?JSON.stringify(old):null,next?JSON.stringify(next):null)
    const scope=(next||old) as KeywordRow|undefined
    if(scope&&['global','branch'].includes(scope.scope_type)) {
      const audit=this.db.prepare('SELECT * FROM audit_logs WHERE id=?').get(auditId)
      this.db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES (?,?,?,?,?)').run(randomUUID(),'audit_logs',auditId,'INSERT',JSON.stringify(audit))
    }
  }
  private checkCode(productId:string,keyword:string,type:string,id?:string) {
    if(!this.uniqueCodes || !(type==='code'||/^\d+$/.test(keyword)))return
    const conflict=this.db.prepare(`SELECT k.product_id,p.name FROM product_search_keywords k JOIN products p ON p.id=k.product_id
      WHERE k.keyword_normalized=? AND k.is_active=1 AND k.review_status='approved' AND p.is_active=1 AND k.product_id!=? AND k.id!=? LIMIT 1`).get(keyword,productId,id||'') as {name:string}|undefined
    if(conflict)throw new Error(`Code already belongs to ${conflict.name}`)
    const products=this.db.prepare('SELECT id,name,sku,barcode FROM products WHERE is_active=1 AND id!=?').all(productId) as {name:string;sku:string;barcode?:string}[]
    const existing=products.find(product=>[product.sku,product.barcode].some(value=>value&&normalizeKeyword(value)===keyword))
    if(existing)throw new Error(`Code conflicts with SKU/barcode of ${existing.name}`)
  }
  list(options:{productId?:string;pending?:boolean;management?:boolean}={}) {
    if(!keywordTableExists(this.db))return []
    if(!ownsKeywords(this.actor))throw new Error('Keyword access required')
    const rows=this.db.prepare(`SELECT k.*,p.name AS product_name,p.sku FROM product_search_keywords k JOIN products p ON p.id=k.product_id WHERE p.is_active=1 ${options.productId?'AND k.product_id=?':''} ORDER BY k.updated_at DESC,k.id`).all(...(options.productId?[options.productId]:[])) as KeywordRow[]
    return rows.filter(row=>options.management&&this.actor.permissions.all || visibleKeyword(row,this.actor)).filter(row=>!options.pending || row.review_status==='pending')
  }
  snapshot() {
    if(!keywordTableExists(this.db))return []
    const rows=this.db.prepare("SELECT k.* FROM product_search_keywords k JOIN products p ON p.id=k.product_id WHERE p.is_active=1 AND k.is_active=1 AND k.review_status='approved'").all() as KeywordRow[]
    return rows.filter(row=>visibleKeyword(row,this.actor))
  }
  save(input:{id?:string;version?:number;product_id:string;keyword:string;scope_type:KeywordScope;keyword_type?:string;is_active?:boolean;source?:'manual'|'import'}) {
    this.ready();this.product(input.product_id)
    const text=validateKeyword(input.keyword)
    if(!['global','branch','terminal','user'].includes(input.scope_type))throw new Error('Invalid keyword scope')
    const owner=input.scope_type==='global'?'':input.scope_type==='branch'?this.actor.branchId:input.scope_type==='terminal'?this.actor.terminalId:this.actor.userId
    if(input.scope_type!=='global'&&!owner)throw new Error('Keyword scope identity is missing')
    const scopeKey=input.scope_type==='global'?'global':`${input.scope_type}:${owner}`
    const old=(input.id?this.db.prepare('SELECT * FROM product_search_keywords WHERE id=?').get(input.id):this.db.prepare('SELECT * FROM product_search_keywords WHERE product_id=? AND keyword_normalized=? AND scope_key=?').get(input.product_id,text.normalized,scopeKey)) as KeywordRow|undefined
    if(input.id&&!old)throw new Error('Keyword not found')
    if(old && input.version!==undefined && input.version!==old.version)throw new Error('Keyword changed; reload before editing')
    if(old)this.mayWrite(old)
    const type=text.script==='numeric'?'code':input.keyword_type || (['tamil','sinhala'].includes(text.script)?'native_script':'word')
    if(!['word','tanglish','native_script','code'].includes(type))throw new Error('Invalid keyword type')
    const now=new Date().toISOString()
    const row={id:old?.id||randomUUID(),product_id:input.product_id,keyword:text.keyword,keyword_normalized:text.normalized,keyword_type:type,script:text.script,
      source:input.source==='import'?'import':'manual',scope_type:input.scope_type,scope_key:scopeKey,branch_id:input.scope_type==='branch'?owner:null,terminal_id:input.scope_type==='terminal'?owner:null,user_id:input.scope_type==='user'?owner:null,
      parent_id:null,review_status:'approved',created_by:old?.created_by||this.actor.userId,created_at:old?.created_at||now,updated_at:now,version:Number(old?.version||0)+1,is_active:input.is_active===false?0:1} as KeywordRow
    this.mayWrite(row)
    if(old&&(old.product_id!==row.product_id||old.scope_key!==row.scope_key))throw new Error('Create a separate keyword instead of changing its product or scope')
    return this.db.transaction(()=>{
      if(row.is_active)this.checkCode(row.product_id,row.keyword_normalized,row.keyword_type,row.id)
      this.write(row);this.queue(row);this.audit(old?'KEYWORD_UPDATED':'KEYWORD_CREATED',row.id,old,row)
      if(['tamil','sinhala'].includes(text.script)&&row.is_active) for(const proposal of transliterationProposals(text.keyword)) {
        const normalized=normalizeKeyword(proposal)
        if(this.db.prepare('SELECT 1 FROM product_search_keywords WHERE product_id=? AND keyword_normalized=? AND scope_key=?').get(row.product_id,normalized,row.scope_key))continue
        const generated={...row,id:randomUUID(),keyword:proposal,keyword_normalized:normalized,keyword_type:'tanglish',script:'latin',source:'auto_translit',parent_id:row.id,review_status:'pending',is_active:0,version:1} as KeywordRow
        this.write(generated);this.queue(generated);this.audit('KEYWORD_TRANSLITERATION_PROPOSED',generated.id,null,generated)
      }
      return row
    }).immediate()
  }
  private write(row:KeywordRow) {
    const columns=Object.keys(row)
    this.db.prepare(`INSERT INTO product_search_keywords(${columns.join(',')}) VALUES (${columns.map(column=>'@'+column).join(',')}) ON CONFLICT(id) DO UPDATE SET ${columns.filter(column=>!['id','created_at','created_by'].includes(column)).map(column=>`${column}=excluded.${column}`).join(',')}`).run(row)
  }
  remove(id:string) {
    this.ready()
    return this.db.transaction(()=>{
      const row=this.db.prepare('SELECT * FROM product_search_keywords WHERE id=?').get(id) as KeywordRow|undefined
      if(!row)throw new Error('Keyword not found')
      this.mayWrite(row)
      const children=this.db.prepare("SELECT * FROM product_search_keywords WHERE parent_id=? AND source='auto_translit'").all(id) as KeywordRow[]
      for(const old of [row,...children]) { const next={...old,is_active:0,review_status:old.source==='auto_translit'?'rejected':old.review_status,version:old.version+1,updated_at:new Date().toISOString()};this.write(next);this.queue(next);this.audit('KEYWORD_DEACTIVATED',old.id,old,next) }
    }).immediate()
  }
  review(ids:string[],decision:'approved'|'rejected') {
    this.ready()
    if(!managesKeywords(this.actor))throw new Error('Keyword management permission required for automatic-keyword review')
    if(!Array.isArray(ids)||!ids.length||ids.length>100||!['approved','rejected'].includes(decision))throw new Error('Choose 1–100 review rows')
    return this.db.transaction(()=>{for(const id of new Set(ids)){
      const old=this.db.prepare("SELECT * FROM product_search_keywords WHERE id=? AND source='auto_translit'").get(id) as KeywordRow|undefined
      if(!old)throw new Error('Automatic keyword not found')
      this.mayWrite(old);this.product(old.product_id)
      if(decision==='approved')this.checkCode(old.product_id,old.keyword_normalized,old.keyword_type,old.id)
      const next={...old,review_status:decision,is_active:decision==='approved'?1:0,version:old.version+1,updated_at:new Date().toISOString()}
      this.write(next);this.queue(next);this.audit('KEYWORD_REVIEWED',id,old,next)
    }}).immediate()
  }
}
