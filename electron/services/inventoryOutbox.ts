import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'

/** Synchronous by design: an outbox failure must roll back the inventory write. */
export function queueInventoryRecord(db:Database.Database,table:string,row:Record<string,unknown>,operation:'INSERT'|'UPDATE'|'DELETE'='INSERT'){
  if(!row.id)throw new Error('Inventory sync record requires an id')
  let payload=row
  if(table==='stocks'){
    const baseline=db.prepare('SELECT quantity,damaged_qty FROM sync_stock_baselines WHERE record_id=?').get(String(row.id))
    if(baseline)payload={...row,_base_stock:baseline}
  }
  const existing=db.prepare("SELECT id,operation,payload,status FROM sync_queue WHERE table_name=? AND record_id=? AND status IN ('pending','processing','failed') ORDER BY rowid DESC LIMIT 1").get(table,String(row.id)) as {id:string;operation:'INSERT'|'UPDATE';payload:string;status:string}|undefined
  if(existing){
    const prior=JSON.parse(existing.payload)
    payload={...prior,...payload}
    if(prior._purchase_ids||row._purchase_ids)payload._purchase_ids=[...new Set([...(prior._purchase_ids||[]),...((row._purchase_ids as string[])||[])])]
    if(existing.operation==='INSERT'&&operation!=='DELETE')operation='INSERT'
    if(existing.status!=='processing'){
      db.prepare("UPDATE sync_queue SET operation=?,payload=?,status='pending',attempts=0,failure_cycles=0,next_retry_at=NULL,last_error=NULL WHERE id=?").run(operation,JSON.stringify(payload),existing.id)
      return
    }
  }
  db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES(?,?,?,?,?)').run(randomUUID(),table,String(row.id),operation,JSON.stringify(payload))
}
