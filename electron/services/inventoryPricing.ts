import type Database from 'better-sqlite3'
import {randomUUID} from 'crypto'
import {validateMrp} from '../lib/purchaseMath'
import {queueInventoryRecord} from './inventoryOutbox'

export type InventoryPricingMode='batch'|'latest'|'weighted'
export function inventoryPricingContext(db:Database.Database,productId:string,branchId:string){
 const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId) as Record<string,any>|undefined
 if(!product)throw new Error('Product not found')
 const batches=db.prepare('SELECT * FROM product_batches WHERE product_id=? AND branch_id=? ORDER BY COALESCE(purchase_date,created_at) DESC,created_at DESC,rowid DESC').all(productId,branchId) as Record<string,any>[]
 const receipts=batches.filter(row=>row.historical_cost_known && row.purchase_item_id)
 const stock=db.prepare('SELECT COALESCE(SUM(MAX(0,quantity-COALESCE(damaged_qty,0))),0) quantity FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(productId,branchId) as {quantity:number}
 const batchQuantity=batches.reduce((sum,row)=>sum+Math.max(0,Number(row.quantity)),0)
 const unknown=batches.some(row=>Number(row.quantity)>0&&!row.historical_cost_known)||stock.quantity>batchQuantity+0.000001
 const value=batches.reduce((sum,row)=>sum+Math.max(0,Number(row.quantity))*Number(row.cost_price),0)
 return {product_id:productId,unit:String(product.unit||'pcs'),quantity:Number(stock.quantity),average_cost:unknown?null:batchQuantity>0?value/batchQuantity:0,cost_known:!unknown,
  previous_purchase_price:receipts[1]?.cost_price??null,latest_purchase_price:receipts[0]?.cost_price??Number(product.cost_price||0),
  pricing_mode:(product.inventory_pricing_mode==='weighted'?'weighted':product.inventory_pricing_mode==='latest'||product.sale_as_latest_price?'latest':'batch') as InventoryPricingMode,
  markup_pct:Number(product.pricing_markup_pct||0),selling_price:Number(product.selling_price||0),
  batches:batches.map(row=>({id:row.id,batch_number:row.batch_number,quantity:Number(row.quantity),cost_price:Number(row.cost_price),selling_price:row.selling_price,mrp:row.mrp??null,expiry_date:row.expiry_date,known:!!row.historical_cost_known})),
  packs:db.prepare('SELECT uom_name,conversion_factor FROM product_uom WHERE product_id=? AND is_base=0').all(productId) as {uom_name:string;conversion_factor:number}[],
 }
}

export function inventoryAudit(db:Database.Database,userId:string,branchId:string,action:string,table:string,id:string,before:unknown,after:unknown){
 const row={id:randomUUID(),user_id:userId,branch_id:branchId,action,table_name:table,record_id:id,old_values:JSON.stringify(before),new_values:JSON.stringify(after)}
 db.prepare('INSERT INTO audit_logs(id,user_id,branch_id,action,table_name,record_id,old_values,new_values) VALUES(@id,@user_id,@branch_id,@action,@table_name,@record_id,@old_values,@new_values)').run(row)
 queueInventoryRecord(db,'audit_logs',row)
}

export function setInventoryPricing(db:Database.Database,input:{productId:string;branchId:string;userId:string;authorized:boolean;mode:InventoryPricingMode;markup:number;reason:string}){
 if(!input.authorized)throw new Error('Only authorized price managers can adjust inventory pricing')
 if(!['batch','latest','weighted'].includes(input.mode)||!Number.isFinite(input.markup)||input.markup<0||input.markup>10000)throw new Error('Invalid pricing policy or markup')
 if(input.reason.trim().length<3)throw new Error('Enter a reason for this price policy adjustment')
 return db.transaction(()=>{
  const context=inventoryPricingContext(db,input.productId,input.branchId)
  if(input.mode==='weighted'&&!context.cost_known)throw new Error('Historical opening cost is unknown. Reconcile opening batch costs before using weighted-average selling.')
  const before=db.prepare('SELECT * FROM products WHERE id=?').get(input.productId)
  db.prepare("UPDATE products SET inventory_pricing_mode=?,pricing_markup_pct=?,sale_as_latest_price=?,updated_at=datetime('now') WHERE id=?").run(input.mode,input.markup,input.mode==='latest'?1:0,input.productId)
  const after=db.prepare('SELECT * FROM products WHERE id=?').get(input.productId) as Record<string,unknown>
  queueInventoryRecord(db,'products',after,'UPDATE')
  inventoryAudit(db,input.userId,input.branchId,'INVENTORY_PRICING_POLICY','products',input.productId,before,{...after,reason:input.reason.trim()})
  return inventoryPricingContext(db,input.productId,input.branchId)
 })()
}

export function adjustBatchSellingPrice(db:Database.Database,input:{batchId:string;branchId:string;userId:string;authorized:boolean;price:number;reason:string}){
 if(!input.authorized)throw new Error('Only authorized price managers can adjust batch prices')
 if(input.reason.trim().length<3)throw new Error('Enter a reason for this price adjustment')
 return db.transaction(()=>{
  const before=db.prepare('SELECT * FROM product_batches WHERE id=? AND branch_id=?').get(input.batchId,input.branchId) as Record<string,any>|undefined
  if(!before)throw new Error('Batch not found in this branch')
  const product=db.prepare('SELECT * FROM products WHERE id=?').get(String(before.product_id)) as {tax_rate?:number}
  validateMrp(input.price*(1+Number(product.tax_rate||0)/100),before.mrp)
  db.prepare("UPDATE product_batches SET selling_price=?,updated_at=datetime('now') WHERE id=?").run(input.price,input.batchId)
  const after=db.prepare('SELECT * FROM product_batches WHERE id=?').get(input.batchId) as Record<string,unknown>
  queueInventoryRecord(db,'product_batches',after,'UPDATE')
  inventoryAudit(db,input.userId,input.branchId,'BATCH_SELLING_PRICE_ADJUSTMENT','product_batches',input.batchId,before,{...after,reason:input.reason.trim()})
  return after
 })()
}
