import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'
import {claimBatch,type BatchInput} from './batchIdentity'
import {ensureLegacyOpeningLayer} from './batchInventory'
import {insertStockMovement} from './stockMovement'
export function createOpeningBatch(db:Database.Database,input:BatchInput&{branch_id:string;quantity:number;cost_price:number;created_by:string}){
 if(!Number.isFinite(input.quantity)||input.quantity<0||!Number.isFinite(input.cost_price)||input.cost_price<0)throw new Error('Valid quantity and cost required')
 if(!db.prepare('SELECT 1 FROM branches WHERE id=? AND is_active=1').get(input.branch_id))throw new Error('Select an active branch')
 return db.transaction(()=>{
  const identity=claimBatch(db,{...input,batch_number:input.batch_number||`ENTRY-${randomUUID().slice(0,8)}`})
  ensureLegacyOpeningLayer(db,input.product_id,input.branch_id)
  const row={id:randomUUID(),product_id:input.product_id,branch_id:input.branch_id,batch_number:identity.no,expiry_date:identity.expiry||null,mfg_date:identity.mfg||null,batch_identity_id:identity.id,batch_entry_mode:input.batch_resolution==='add_existing'?'add_existing':'new',batch_warning_ack:input.acknowledge_dates?1:0,quantity:input.quantity,cost_price:input.cost_price,original_quantity:input.quantity,historical_cost_known:1,status:'available',created_by:input.created_by}
  const columns=new Set((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).map(col=>col.name)),saved=Object.fromEntries(Object.entries(row).filter(([key])=>columns.has(key)))
  db.prepare(`INSERT INTO product_batches(${Object.keys(saved).join(',')}) VALUES(${Object.keys(saved).map(key=>'@'+key).join(',')})`).run(saved)
  const queue=(table:string,data:Record<string,unknown>)=>db.prepare('INSERT INTO sync_queue(id,table_name,record_id,operation,payload) VALUES(?,?,?,?,?)').run(randomUUID(),table,data.id,'INSERT',JSON.stringify(data))
  if(input.quantity>0){
   const stock=db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(input.product_id,input.branch_id) as Record<string,any>|undefined
   if(stock)db.prepare("UPDATE stocks SET quantity=ROUND(quantity+?,6),updated_at=datetime('now') WHERE id=?").run(input.quantity,stock.id)
   else db.prepare('INSERT INTO stocks(id,product_id,branch_id,quantity,damaged_qty) VALUES(?,?,?,?,0)').run(randomUUID(),input.product_id,input.branch_id,input.quantity)
   const current=db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(input.product_id,input.branch_id) as Record<string,unknown>;queue('stocks',current)
   queue('stock_movements',insertStockMovement(db,{product_id:input.product_id,to_branch_id:input.branch_id,quantity:input.quantity,movement_type:'ADJUSTMENT',created_by:input.created_by,notes:'Opening batch stock'}))
  }
  queue('product_batches',saved);return saved
 }).immediate()
}
