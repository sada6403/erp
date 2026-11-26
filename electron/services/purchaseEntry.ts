import {batchDates,claimBatch} from './batchIdentity'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { createReceiptBatch, ensureLegacyOpeningLayer } from './batchInventory'
import { requireSavedPurchaseBill } from './purchaseBills'
import { applyReceiptProductPrices } from './receiptProductPricing'
import { insertStockMovement } from './stockMovement'
import { queueInventoryRecord } from './inventoryOutbox'
import { stockUnitFactor } from '../lib/inventoryUnits'
import {purchaseLine,validateMrp} from '../lib/purchaseMath'
import {applyPurchaseBalance} from './purchaseAccounting'

export interface StockPurchaseInput {
  id: string; poNumber: string; branchId: string; userId?: string | null
  supplierId: string; purchaseType: 'order' | 'direct'; purchaseDate: string
  invoiceNumber?: string; expectedDate?: string; notes?: string
  items: { product_id: string; quantity: number; unit_cost: number; free_quantity?:number;discount_amount?:number;mrp?:number|null;selling_price?: number | null; entry_unit?:string; batch_number?:string|null; expiry_date?:string|null;mfg_date?:string|null;batch_resolution?:'add_existing'|'acknowledge';existing_batch_id?:string;acknowledge_dates?:boolean }[]
}
const round = (value: number) => Math.round(value * 1e6)/1e6
export function normalizeStockPurchaseItems(db:Database.Database,lines:StockPurchaseInput['items']){
  return lines.map(item=>{
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id) as {unit?:string;selling_price?:number;tax_rate?:number;is_active?:number}|undefined
    if(!product)throw new Error('Product not found')
    if(product.is_active===0)throw new Error('Inactive products cannot be purchased')
    const packs=item.entry_unit?db.prepare('SELECT uom_name,conversion_factor FROM product_uom WHERE product_id=? AND is_base=0').all(item.product_id) as {uom_name:string;conversion_factor:number}[]:[]
    const factor=item.entry_unit?stockUnitFactor(item.entry_unit,product.unit||'pcs',packs):1
    const normalized={...item,...purchaseLine(item.quantity,item.unit_cost,item.free_quantity??0,item.discount_amount??0,factor),entry_unit:item.entry_unit||product.unit||'pcs',mrp:item.mrp==null?null:item.mrp/factor,selling_price:item.selling_price==null?null:item.selling_price/factor}
    batchDates(normalized);validateMrp((normalized.selling_price??Number(product.selling_price))*(1+Number(product.tax_rate||0)/100),normalized.mrp)
    return normalized
  })
}
export function createStockPurchase(db: Database.Database, input: StockPurchaseInput, saveBills?: (purchaseId: string) => void, persistOutbox=true) {
  const items=normalizeStockPurchaseItems(db,input.items)
  if (!['order','direct'].includes(input.purchaseType)) throw new Error('Invalid purchase type')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) || Number.isNaN(Date.parse(input.purchaseDate)) || new Date(input.purchaseDate+'T00:00:00Z').toISOString().slice(0,10)!==input.purchaseDate) throw new Error('Valid purchase date is required')
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(input.supplierId)) throw new Error('Supplier not found')
  if (!input.items.length) throw new Error('At least one product is required')
  if (!input.id?.trim() || !input.poNumber?.trim()) throw new Error('Purchase reference is required')
  for (const item of items) {
    batchDates({...item})
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(item.product_id)) throw new Error('Product not found')
    if (!Number.isFinite(item.quantity) || round(item.quantity)<=0) throw new Error('Quantity must be greater than zero')
    if (!Number.isFinite(item.unit_cost) || item.unit_cost<0) throw new Error('Purchase price cannot be negative')
    if (item.selling_price != null && (!Number.isFinite(item.selling_price) || item.selling_price<0)) throw new Error('Invalid selling price')
    const product=db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id) as {selling_price:number;tax_rate?:number}
    validateMrp((item.selling_price??Number(product.selling_price))*(1+Number(product.tax_rate||0)/100),item.mrp)
  }
  return db.transaction(() => {
    const existing=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id) as Record<string, unknown> | undefined
    if (existing) {
      if (existing.branch_id!==input.branchId || existing.supplier_id!==input.supplierId) throw new Error('Purchase reference already used')
      return existing
    }
    if(input.invoiceNumber?.trim() && db.prepare('SELECT 1 FROM purchase_orders WHERE supplier_id=? AND LOWER(TRIM(supplier_invoice_number))=LOWER(?)').get(input.supplierId,input.invoiceNumber.trim())) throw new Error('This supplier bill number is already saved. Open the existing purchase.')
    if(input.purchaseType==='order')for(const item of items)claimBatch(db,{...item,product_id:item.product_id})
    const total=Math.round(items.reduce((sum,item)=>sum+item.line_total,0)*100)/100
    const purchase={id:input.id,po_number:input.poNumber,branch_id:input.branchId,supplier_id:input.supplierId,
      purchase_type:input.purchaseType,status:input.purchaseType==='direct'?'RECEIVED':'DRAFT',
      purchase_date:input.purchaseDate,supplier_invoice_number:input.invoiceNumber?.trim()||null,
      expected_date:input.expectedDate||null,received_at:input.purchaseType==='direct'?new Date().toISOString():null,
      notes:input.notes||null,total_amount:total,created_by:input.userId||null}
    db.prepare(`INSERT INTO purchase_orders (id,po_number,branch_id,supplier_id,purchase_type,status,purchase_date,
      supplier_invoice_number,expected_date,received_at,notes,total_amount,created_by)
      VALUES (@id,@po_number,@branch_id,@supplier_id,@purchase_type,@status,@purchase_date,
      @supplier_invoice_number,@expected_date,@received_at,@notes,@total_amount,@created_by)`).run(purchase)
    for(const item of items){
      const row={id:randomUUID(),po_id:input.id,product_id:item.product_id,quantity:round(item.quantity),
        unit_cost:item.unit_cost,line_total:item.line_total,
        selling_price:item.selling_price??null,received_qty:input.purchaseType==='direct'?round(item.quantity):0}
      db.prepare(`INSERT INTO purchase_items (id,po_id,product_id,quantity,unit_cost,line_total,selling_price,received_qty)
        VALUES (@id,@po_id,@product_id,@quantity,@unit_cost,@line_total,@selling_price,@received_qty)`).run(row)
      const cols=new Set((db.prepare('PRAGMA table_info(purchase_items)').all() as {name:string}[]).map(col=>col.name))
      for(const field of ['batch_number','expiry_date','mfg_date'] as const)if(cols.has(field))db.prepare(`UPDATE purchase_items SET ${field}=? WHERE id=?`).run(item[field]||null,row.id)
      for(const field of ['paid_quantity','free_quantity','discount_amount','purchase_unit_cost','mrp','entry_unit','entry_quantity','entry_free_quantity','unit_factor'] as const)if(cols.has(field))db.prepare(`UPDATE purchase_items SET ${field}=? WHERE id=?`).run(item[field],row.id)
      if(input.purchaseType==='direct'){
        applyReceiptProductPrices(db,item.product_id,item.unit_cost,row.selling_price)
        const opening=ensureLegacyOpeningLayer(db,item.product_id,input.branchId)
        if(opening&&persistOutbox)queueInventoryRecord(db,'product_batches',opening)
        const stock=db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(item.product_id,input.branchId) as {id:string}|undefined
        if(stock) db.prepare("UPDATE stocks SET quantity=quantity+?,updated_at=datetime('now') WHERE id=?").run(row.quantity,stock.id)
        else db.prepare('INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run(randomUUID(),item.product_id,input.branchId,row.quantity)
        createReceiptBatch(db,{productId:item.product_id,branchId:input.branchId,purchaseId:input.id,purchaseItemId:row.id,
          quantity:row.quantity,unitCost:item.unit_cost,sellingPrice:row.selling_price,mrp:item.mrp,purchaseDate:input.purchaseDate,createdBy:input.userId,batchNumber:item.batch_number,expiryDate:item.expiry_date,mfgDate:item.mfg_date,batchResolution:item.batch_resolution,existingBatchId:item.existing_batch_id,acknowledgeDates:item.acknowledge_dates})
        insertStockMovement(db,{product_id:item.product_id,to_branch_id:input.branchId,quantity:row.quantity,
          movement_type:'RECEIVE',reference_order_id:input.id,created_by:input.userId,notes:`Direct stock purchase ${input.poNumber}`})
      }
    }
    saveBills?.(input.id)
    // Orders are drafts: the supplier invoice may only arrive with delivery.
    // Direct entries receive inventory immediately and must have a bill.
    if (input.purchaseType === 'direct') requireSavedPurchaseBill(db,input.id)
    if(input.purchaseType==='direct')applyPurchaseBalance(db,input.id,persistOutbox)
    if(persistOutbox){
    queueInventoryRecord(db,'purchase_orders',db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id) as Record<string,unknown>)
    for(const item of db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(input.id) as Record<string,unknown>[]){
      queueInventoryRecord(db,'purchase_items',item)
      if(input.purchaseType==='direct'){
        queueInventoryRecord(db,'products',{...(db.prepare('SELECT * FROM products WHERE id=?').get(String(item.product_id)) as Record<string,unknown>),_purchase_ids:[input.id]},'UPDATE')
        queueInventoryRecord(db,'stocks',{...(db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(String(item.product_id),input.branchId) as Record<string,unknown>),_purchase_ids:[input.id]},'UPDATE')
      }
    }
    for(const batch of db.prepare('SELECT * FROM product_batches WHERE po_id=?').all(input.id) as Record<string,unknown>[])queueInventoryRecord(db,'product_batches',{...batch,_purchase_ids:[input.id]})
    for(const movement of db.prepare('SELECT * FROM stock_movements WHERE reference_order_id=?').all(input.id) as Record<string,unknown>[])queueInventoryRecord(db,'stock_movements',{...movement,_purchase_ids:[input.id]})
    }
    return purchase
  })()
}

export function replaceDraftPurchase(db:Database.Database,id:string,branchId:string,payload:{supplier_id?:string;notes?:string;expected_date?:string;items?:StockPurchaseInput['items']}){
 return db.transaction(()=>{
  const po=db.prepare('SELECT * FROM purchase_orders WHERE id=? AND branch_id=?').get(id,branchId) as Record<string,any>|undefined
  if(!po||po.status!=='DRAFT')throw new Error('Only draft purchases in this branch can be edited')
  if((payload.items||payload.supplier_id&&payload.supplier_id!==po.supplier_id)&&(Number(po.paid_amount)>0||Number(po.outstanding_amount)>0||Number(po.applied_supplier_credit)>0))throw new Error('This draft already has an accounting balance. Reconcile its invoice before changing supplier or items.')
  if(payload.expected_date)batchDates({product_id:'order',mfg_date:payload.expected_date})
  if(payload.supplier_id&&!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(payload.supplier_id))throw new Error('Supplier not found')
  if(payload.items){
   if(!payload.items.length)throw new Error('At least one product is required')
   const lines=normalizeStockPurchaseItems(db,payload.items)
   for(const line of lines)claimBatch(db,line)
   const old=db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(id) as Record<string,unknown>[]
   db.prepare('DELETE FROM purchase_items WHERE po_id=?').run(id)
   for(const item of old)queueInventoryRecord(db,'purchase_items',item,'DELETE')
   const columns=new Set((db.prepare('PRAGMA table_info(purchase_items)').all() as {name:string}[]).map(row=>row.name))
   for(const line of lines){
    const row=Object.fromEntries(Object.entries({...line,id:randomUUID(),po_id:id,received_qty:0,batch_number:line.batch_number||null,mfg_date:line.mfg_date||null,expiry_date:line.expiry_date||null}).filter(([key,value])=>columns.has(key)&&value!==undefined))
    db.prepare(`INSERT INTO purchase_items(${Object.keys(row).join(',')}) VALUES(${Object.keys(row).map(key=>'@'+key).join(',')})`).run(row)
    queueInventoryRecord(db,'purchase_items',db.prepare('SELECT * FROM purchase_items WHERE id=?').get(row.id) as Record<string,unknown>)
   }
   db.prepare('UPDATE purchase_orders SET total_amount=? WHERE id=?').run(Math.round(lines.reduce((sum,line)=>sum+line.line_total,0)*100)/100,id)
  }
  db.prepare("UPDATE purchase_orders SET supplier_id=?,notes=?,expected_date=?,updated_at=datetime('now') WHERE id=?").run(payload.supplier_id??po.supplier_id,payload.notes??po.notes,payload.expected_date??po.expected_date,id)
  const updated=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string,unknown>
  queueInventoryRecord(db,'purchase_orders',updated,'UPDATE');return updated
 })()
}
