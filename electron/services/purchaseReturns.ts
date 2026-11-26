import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'
import {batchDates} from './batchIdentity'
import {purchaseMoney} from '../lib/purchaseMath'
import {insertStockMovement} from './stockMovement'
import {queueInventoryRecord} from './inventoryOutbox'
import {applyPurchaseBalance} from './purchaseAccounting'
import {inventoryAudit} from './inventoryPricing'

export function returnPurchaseStock(db:Database.Database,input:{id:string;purchaseId:string;branchId:string;userId:string;date:string;reason:string;items:{batch_id:string;quantity:number}[]}){
 if(!input.id||!input.date||input.reason.trim().length<3||!input.items.length)throw new Error('A return reference, date, reason and at least one batch are required')
 batchDates({product_id:'return',mfg_date:input.date})
 return db.transaction(()=>{
  const po=db.prepare('SELECT * FROM purchase_orders WHERE id=? AND branch_id=?').get(input.purchaseId,input.branchId) as Record<string,any>|undefined
  if(!po||!['PARTIAL','RECEIVED'].includes(po.status))throw new Error('Only received purchases in this branch can be returned')
  const existing=db.prepare('SELECT * FROM purchase_returns WHERE id=?').get(input.id) as Record<string,unknown>|undefined
  if(existing){if(existing.purchase_id!==po.id||existing.branch_id!==input.branchId)throw new Error('Return reference already used');return existing}
  const seen=new Set<string>()
  const rows=input.items.map(item=>{
   if(seen.has(item.batch_id))throw new Error('Duplicate batch in return');seen.add(item.batch_id)
   const quantity=Math.round(Number(item.quantity)*1e6)/1e6
   if(!Number.isFinite(quantity)||quantity<=0)throw new Error('Return quantity must be positive')
   const batch=db.prepare('SELECT * FROM product_batches WHERE id=? AND po_id=? AND branch_id=? AND purchase_item_id IS NOT NULL').get(item.batch_id,po.id,input.branchId) as Record<string,any>|undefined
   if(!batch||quantity>Number(batch.quantity))throw new Error('Return quantity exceeds available purchase batch stock')
   const prior=db.prepare('SELECT COALESCE(SUM(quantity),0) quantity FROM purchase_return_items WHERE batch_id=?').get(batch.id) as {quantity:number}
   const value=purchaseMoney((prior.quantity+quantity)*Number(batch.cost_price))-purchaseMoney(prior.quantity*Number(batch.cost_price))
   return {batch,quantity,value}
  })
  const header={id:input.id,purchase_id:po.id,branch_id:input.branchId,supplier_id:po.supplier_id,return_number:`PR-${input.id.slice(0,12).toUpperCase()}`,return_date:input.date,reason:input.reason.trim(),total_amount:purchaseMoney(rows.reduce((sum,row)=>sum+row.value,0)),created_by:input.userId}
  if(Number(po.returned_amount||0)+header.total_amount>Number(po.total_amount)+0.01)throw new Error('Return credit exceeds the purchase invoice amount')
  db.prepare('INSERT INTO purchase_returns(id,purchase_id,branch_id,supplier_id,return_number,return_date,reason,total_amount,created_by) VALUES(@id,@purchase_id,@branch_id,@supplier_id,@return_number,@return_date,@reason,@total_amount,@created_by)').run(header)
  queueInventoryRecord(db,'purchase_returns',header)
  for(const {batch,quantity,value} of rows){
   const stock=db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(batch.product_id,input.branchId) as Record<string,any>|undefined
   if(!stock||Math.round((Number(stock.quantity)-Number(stock.damaged_qty||0))*1e6)<Math.round(quantity*1e6))throw new Error('Not enough available branch stock for this return')
   db.prepare("UPDATE stocks SET quantity=ROUND(quantity-?,6),updated_at=datetime('now') WHERE id=?").run(quantity,stock.id)
   db.prepare("UPDATE product_batches SET quantity=ROUND(quantity-?,6),supplier_returned_quantity=ROUND(supplier_returned_quantity+?,6),status=CASE WHEN ROUND(quantity-?,6)<=0 THEN 'sold_out' ELSE status END,updated_at=datetime('now') WHERE id=?").run(quantity,quantity,quantity,batch.id)
   const row={id:randomUUID(),purchase_return_id:header.id,purchase_item_id:batch.purchase_item_id,batch_id:batch.id,product_id:batch.product_id,quantity,unit_cost:Number(batch.cost_price),line_total:value}
   db.prepare('INSERT INTO purchase_return_items(id,purchase_return_id,purchase_item_id,batch_id,product_id,quantity,unit_cost,line_total) VALUES(@id,@purchase_return_id,@purchase_item_id,@batch_id,@product_id,@quantity,@unit_cost,@line_total)').run(row)
   queueInventoryRecord(db,'purchase_return_items',row)
   queueInventoryRecord(db,'stocks',db.prepare('SELECT * FROM stocks WHERE id=?').get(stock.id) as Record<string,unknown>,'UPDATE')
   queueInventoryRecord(db,'product_batches',db.prepare('SELECT * FROM product_batches WHERE id=?').get(batch.id) as Record<string,unknown>,'UPDATE')
   queueInventoryRecord(db,'stock_movements',insertStockMovement(db,{product_id:batch.product_id,from_branch_id:input.branchId,quantity,movement_type:'ADJUSTMENT',reference_order_id:po.id,created_by:input.userId,notes:`Supplier return ${header.return_number}: ${input.reason.trim()}`}))
  }
  db.prepare('UPDATE purchase_orders SET returned_amount=ROUND(returned_amount+?,2) WHERE id=?').run(header.total_amount,po.id)
  applyPurchaseBalance(db,po.id)
  queueInventoryRecord(db,'purchase_orders',db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(po.id) as Record<string,unknown>,'UPDATE')
  inventoryAudit(db,input.userId,input.branchId,'PURCHASE_RETURN','purchase_returns',header.id,null,header)
  return header
 }).immediate()
}
