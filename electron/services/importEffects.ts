import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'
export interface ImportEffect {table:string;id:string;before:Record<string,any>|null;after:Record<string,any>|null;movementGuard?:string}
const TABLES=new Set(['products','categories','suppliers','stocks','product_batches','stock_movements','purchase_orders','purchase_items','purchase_attachments','product_search_keywords'])
export const stableImportRow=(row:Record<string,any>|null)=>row?JSON.stringify(Object.keys(row).filter(key=>!['updated_at','synced_at'].includes(key)).sort().map(key=>[key,row[key]])):'null'
export class ImportEffects {
 readonly effects=new Map<string,ImportEffect>()
 private queued=new Map<string,string>()
 constructor(readonly db:Database.Database){}
 row(table:string,id:string){if(!TABLES.has(table))throw new Error('Unsupported import write target');return this.db.prepare(`SELECT * FROM ${table} WHERE id=?`).get(id) as Record<string,any>|undefined}
 capture(table:string,id:string,before:Record<string,any>|null){const key=table+':'+id;const previous=this.effects.get(key),after=this.row(table,id)||null;this.effects.set(key,{table,id,before:previous?previous.before:before,after,...(table==='stocks'&&after?{movementGuard:this.movementGuard(after.product_id)}:{})})}
 movementGuard(productId:string){return JSON.stringify(this.db.prepare("SELECT COUNT(*) n,COALESCE(MAX(rowid),0) latest,COALESCE(SUM(quantity),0) quantity,COALESCE(SUM(CASE WHEN status='VOID' THEN 1 ELSE 0 END),0) voids FROM stock_movements WHERE product_id=?").get(productId))}
 put(table:string,id:string,values:Record<string,any>) {
  const before=this.row(table,id)||null
  const columns=new Set((this.db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(row=>row.name))
  const data=Object.fromEntries(Object.entries(values).filter(([key,value])=>columns.has(key)&&value!==undefined&&!['id','created_at','synced_at'].includes(key)))
  if(columns.has('updated_at'))data.updated_at=new Date().toISOString()
  if(before) {if(Object.keys(data).length)this.db.prepare(`UPDATE ${table} SET ${Object.keys(data).map(key=>`"${key}"=@${key}`).join(',')} WHERE id=@id`).run({...data,id})}
  else {const row={id,...data};this.db.prepare(`INSERT INTO ${table} (${Object.keys(row).map(key=>'"'+key+'"').join(',')}) VALUES (${Object.keys(row).map(key=>'@'+key).join(',')})`).run(row)}
  this.capture(table,id,before);return this.row(table,id)!
 }
 observe(tables:Record<string,()=>Record<string,any>[]>,write:()=>void) {
  const before=new Map<string,Record<string,any>>()
  for(const [table,read] of Object.entries(tables))for(const row of read())before.set(table+':'+row.id,row)
  write()
  for(const [table,read] of Object.entries(tables))for(const row of read()) {
   const prior=before.get(table+':'+row.id)||null
   if(stableImportRow(prior)!==stableImportRow(row))this.capture(table,row.id,prior)
  }
 }
 acknowledge(table:string){for(const [key,effect] of this.effects)if(effect.table===table)this.queued.set(key,stableImportRow(effect.after))}
 queue(uniqueCodes=true,preserveOrder=false) {
  const order=['categories','suppliers','products','purchase_orders','purchase_items','purchase_attachments','stocks','product_batches','stock_movements','product_search_keywords']
  const effects=[...this.effects.values()]
  if(!preserveOrder)effects.sort((a,b)=>order.indexOf(a.table)-order.indexOf(b.table))
  for(const effect of effects) {
   if(!effect.after)continue
   const key=effect.table+':'+effect.id,version=stableImportRow(effect.after)
   if(this.queued.get(key)===version)continue
   if(effect.table==='product_search_keywords'&&!['global','branch'].includes(effect.after.scope_type))continue
   const row=effect.table==='stocks'&&effect.before?{...effect.after,_base_stock:{quantity:effect.before.quantity,damaged_qty:effect.before.damaged_qty}}:effect.table==='product_search_keywords'?{...effect.after,_enforce_unique_codes:uniqueCodes}:effect.after
   this.db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES (?,?,?,?,?)').run(randomUUID(),effect.table,effect.id,effect.before?'UPDATE':'INSERT',JSON.stringify(row))
   this.queued.set(key,version)
  }
 }
}
