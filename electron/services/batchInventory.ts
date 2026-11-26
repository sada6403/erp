import {claimBatch,inspectBatch,type BatchInput} from './batchIdentity'
import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import {validateMrp} from '../lib/purchaseMath'
import {inventoryPricingContext} from './inventoryPricing'

const QTY_SCALE = 1_000_000
const qty = (value: number) => Math.round((Number(value) || 0) * QTY_SCALE) / QTY_SCALE

export type AllocationMethod = 'FIFO' | 'FEFO'

function saleBatchOrder(db:Database.Database,productId:string,branchId:string,method?:AllocationMethod){
  const useExpiry=method==='FEFO' || (!method && Boolean(db.prepare('SELECT 1 FROM product_batches WHERE product_id=? AND branch_id=? AND quantity>0 AND expiry_date IS NOT NULL LIMIT 1').get(productId,branchId)))
  return useExpiry
    ? `CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, date(expiry_date), COALESCE(date(purchase_date), date(created_at)), created_at, id`
    : `CASE WHEN historical_cost_known=0 THEN 0 ELSE 1 END, COALESCE(date(purchase_date), date(created_at)), created_at, id`
}

export interface SaleBatchAllocation {
  id: string
  invoice_id: string
  invoice_item_id: string
  product_id: string
  batch_id: string
  branch_id: string
  quantity: number
  returned_quantity: number
  unit_cost: number
  unit_selling_price: number
  cost_known: number
}

interface BatchRow {
  id: string
  quantity: number
  cost_price: number
  historical_cost_known: number
  mrp?:number|null
}

function updateBatchStatus(db: Database.Database, batchId: string) {
  db.prepare(`UPDATE product_batches SET status = CASE
    WHEN quantity <= 0 THEN 'sold_out'
    WHEN sold_quantity > 0 THEN 'partially_sold'
    WHEN expiry_date IS NOT NULL AND date(expiry_date) < date('now','+5 hours','+30 minutes') THEN 'expired'
    ELSE 'available' END, updated_at=datetime('now') WHERE id=?`).run(batchId)
}

/**
 * Represents only the quantity gap between aggregate stock and known receipt
 * batches. Cost/date/supplier are deliberately not invented for legacy stock.
 * Must be called inside the caller's database transaction.
 */
export function ensureLegacyOpeningLayer(db: Database.Database, productId: string, branchId: string) {
  const stock = db.prepare(`SELECT MAX(0, quantity - COALESCE(damaged_qty,0)) available
    FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL`)
    .get(productId, branchId) as { available?: number } | undefined
  const known = db.prepare(`SELECT COALESCE(SUM(quantity),0) quantity FROM product_batches
    WHERE product_id=? AND branch_id=?`).get(productId, branchId) as { quantity: number }
  const gap = qty(Number(stock?.available || 0) - Number(known.quantity || 0))
  if (gap <= 0) return
  const openingId=randomUUID()
  db.prepare(`INSERT INTO product_batches
    (id,product_id,branch_id,batch_number,quantity,cost_price,original_quantity,
     historical_cost_known,status,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,0,'available',?,datetime('now'),datetime('now'))`)
    .run(openingId, productId, branchId, `OPENING-${productId.slice(0, 8)}`, gap, 0, gap,
      'Opening stock migrated without historical purchase cost or purchase date')
  if((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).some(column=>column.name==='batch_identity_id')){
    const input={product_id:productId,batch_number:`OPENING-${productId.slice(0,8)}`};const existing=inspectBatch(db,input,openingId).existing
    const identity=claimBatch(db,{...input,batch_resolution:existing?'add_existing':undefined,existing_batch_id:existing?.id,acknowledge_dates:true},openingId)
    db.prepare('UPDATE product_batches SET batch_identity_id=?,batch_entry_mode=? WHERE id=?').run(identity.id,existing?'add_existing':'new',openingId)
  }
  return db.prepare('SELECT * FROM product_batches WHERE id=?').get(openingId) as Record<string,unknown>
}

export function allocateSaleBatches(db: Database.Database, input: {
  invoiceId: string
  invoiceItemId: string
  productId: string
  branchId: string
  quantity: number
  unitSellingPrice: number
  method?: AllocationMethod
}): SaleBatchAllocation[] {
  let remaining = qty(input.quantity)
  if (!Number.isFinite(remaining) || remaining <= 0) throw new Error('Sale quantity must be greater than zero')
  ensureLegacyOpeningLayer(db, input.productId, input.branchId)

  const order = saleBatchOrder(db,input.productId,input.branchId,input.method)
  const batches = db.prepare(`SELECT *
    FROM product_batches
    WHERE product_id=? AND branch_id=? AND quantity > 0
      AND (expiry_date IS NULL OR date(expiry_date) >= date('now','+5 hours','+30 minutes'))
    ORDER BY ${order}`).all(input.productId, input.branchId) as BatchRow[]

  const available = qty(batches.reduce((sum, batch) => sum + Number(batch.quantity), 0))
  if (Math.round(available*QTY_SCALE) < Math.round(remaining*QTY_SCALE)) {
    throw new Error(`Insufficient batch stock (available: ${available})`)
  }
  const product=db.prepare('SELECT * FROM products WHERE id=?').get(input.productId) as {tax_rate?:number}|undefined
  let checkQuantity=remaining
  for(const batch of batches){
    if(checkQuantity<=0)break
    validateMrp(input.unitSellingPrice*(1+Number(product?.tax_rate||0)/100),batch.mrp)
    checkQuantity=qty(checkQuantity-Math.min(checkQuantity,batch.quantity))
  }

  const allocations: SaleBatchAllocation[] = []
  for (const batch of batches) {
    if (remaining <= 0) break
    const take = qty(Math.min(remaining, Number(batch.quantity)))
    if (take <= 0) continue
    const row: SaleBatchAllocation = {
      id: randomUUID(), invoice_id: input.invoiceId, invoice_item_id: input.invoiceItemId,
      product_id: input.productId, batch_id: batch.id, branch_id: input.branchId,
      quantity: take, returned_quantity: 0, unit_cost: Number(batch.cost_price) || 0,
      unit_selling_price: Number(input.unitSellingPrice) || 0,
      cost_known: Number(batch.historical_cost_known ?? 1) ? 1 : 0,
    }
    db.prepare(`INSERT INTO sale_batch_allocations
      (id,invoice_id,invoice_item_id,product_id,batch_id,branch_id,quantity,returned_quantity,
       unit_cost,unit_selling_price,cost_known)
      VALUES (@id,@invoice_id,@invoice_item_id,@product_id,@batch_id,@branch_id,@quantity,
       @returned_quantity,@unit_cost,@unit_selling_price,@cost_known)`).run(row)
    db.prepare(`UPDATE product_batches SET quantity=quantity-?, sold_quantity=sold_quantity+?, updated_at=datetime('now') WHERE id=?`)
      .run(take, take, batch.id)
    updateBatchStatus(db, batch.id)
    allocations.push(row)
    remaining = qty(remaining - take)
  }
  if (remaining > 0) throw new Error(`Unable to allocate ${remaining} units from inventory batches`)
  return allocations
}

export function reverseInvoiceBatchAllocations(db: Database.Database, invoiceId: string): SaleBatchAllocation[] {
  const rows = db.prepare(`SELECT * FROM sale_batch_allocations WHERE invoice_id=? ORDER BY created_at, id`)
    .all(invoiceId) as SaleBatchAllocation[]
  for (const row of rows) {
    const restorable = qty(Number(row.quantity) - Number(row.returned_quantity || 0))
    if (restorable <= 0) continue
    db.prepare(`UPDATE product_batches SET quantity=quantity+?, sold_quantity=MAX(0,sold_quantity-?), updated_at=datetime('now') WHERE id=?`)
      .run(restorable, restorable, row.batch_id)
    updateBatchStatus(db, row.batch_id)
    db.prepare(`UPDATE sale_batch_allocations SET returned_quantity=quantity, updated_at=datetime('now') WHERE id=?`).run(row.id)
  }
  return rows
}

export interface ReturnBatchAllocation {
  id: string
  return_id: string
  return_item_id: string
  sale_allocation_id: string
  batch_id: string
  quantity: number
}

/** Restore a partial sale return to the same cost layers used by the sale. */
export function restoreReturnedSaleBatches(db: Database.Database, input: {
  returnId: string
  returnItemId: string
  invoiceItemId: string
  quantity: number
}): ReturnBatchAllocation[] {
  let remaining = qty(input.quantity)
  const allocations = db.prepare(`SELECT a.* FROM sale_batch_allocations a
    JOIN product_batches b ON b.id=a.batch_id
    WHERE a.invoice_item_id=? AND a.quantity-a.returned_quantity > 0
    ORDER BY CASE WHEN b.historical_cost_known=0 THEN 0 ELSE 1 END DESC,
      COALESCE(date(b.purchase_date),date(b.created_at)) DESC,b.created_at DESC,b.id DESC`).all(input.invoiceItemId) as SaleBatchAllocation[]
  const returnable = qty(allocations.reduce((sum, row) => sum + Number(row.quantity) - Number(row.returned_quantity || 0), 0))
  if (returnable + (1 / QTY_SCALE) < remaining) throw new Error(`Only ${returnable} units remain returnable from the original inventory batches`)
  const rows: ReturnBatchAllocation[] = []
  for (const allocation of allocations) {
    if (remaining <= 0) break
    const take = qty(Math.min(remaining, Number(allocation.quantity) - Number(allocation.returned_quantity || 0)))
    if (take <= 0) continue
    const row = { id: randomUUID(), return_id: input.returnId, return_item_id: input.returnItemId, sale_allocation_id: allocation.id, batch_id: allocation.batch_id, quantity: take }
    db.prepare(`INSERT INTO return_batch_allocations (id,return_id,return_item_id,sale_allocation_id,batch_id,quantity)
      VALUES (@id,@return_id,@return_item_id,@sale_allocation_id,@batch_id,@quantity)`).run(row)
    db.prepare(`UPDATE sale_batch_allocations SET returned_quantity=returned_quantity+?, updated_at=datetime('now') WHERE id=?`).run(take, allocation.id)
    db.prepare(`UPDATE product_batches SET quantity=quantity+?, sold_quantity=MAX(0,sold_quantity-?), returned_quantity=returned_quantity+?, updated_at=datetime('now') WHERE id=?`)
      .run(take, take, take, allocation.batch_id)
    updateBatchStatus(db, allocation.batch_id)
    rows.push(row)
    remaining = qty(remaining - take)
  }
  return rows
}

/** Undo a return using its immutable links; fails if that stock was consumed. */
export function cancelReturnedSaleBatches(db: Database.Database, returnId: string): ReturnBatchAllocation[] {
  const rows = db.prepare(`SELECT * FROM return_batch_allocations WHERE return_id=? ORDER BY created_at,id`)
    .all(returnId) as ReturnBatchAllocation[]
  for (const row of rows) {
    const changed = db.prepare(`UPDATE product_batches
      SET quantity=quantity-?, sold_quantity=sold_quantity+?, returned_quantity=MAX(0,returned_quantity-?), updated_at=datetime('now')
      WHERE id=? AND quantity >= ?`).run(row.quantity, row.quantity, row.quantity, row.batch_id, row.quantity)
    if (!changed.changes) throw new Error('Cannot cancel this return because its original batch stock has already been sold or moved')
    db.prepare(`UPDATE sale_batch_allocations SET returned_quantity=MAX(0,returned_quantity-?), updated_at=datetime('now') WHERE id=?`)
      .run(row.quantity, row.sale_allocation_id)
    updateBatchStatus(db, row.batch_id)
  }
  return rows
}

export function createReceiptBatch(db: Database.Database, input: {
  productId: string
  branchId: string
  purchaseId: string
  purchaseItemId: string
  quantity: number
  unitCost: number
  sellingPrice?: number | null
  mrp?:number|null
  batchNumber?: string | null
  expiryDate?: string | null
  purchaseDate: string
  createdBy?: string | null
  mfgDate?:string|null;batchResolution?:BatchInput['batch_resolution'];existingBatchId?:string;acknowledgeDates?:boolean
}): Record<string, unknown> {
  return db.transaction(()=>{
  const product=db.prepare('SELECT * FROM products WHERE id=?').get(input.productId) as {selling_price?:number;tax_rate?:number;track_expiry?:number}|undefined
  if(product?.track_expiry&&!input.expiryDate)throw new Error('Expiry date is required when receiving this product')
  const price=input.sellingPrice??product?.selling_price
  validateMrp(price==null?null:price*(1+Number(product?.tax_rate||0)/100),input.mrp)
  if (input.sellingPrice != null && (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0)) throw new Error('Selling price must be a valid non-negative amount')
  const received = qty(input.quantity)
  if (!Number.isFinite(received) || received <= 0) throw new Error('Received batch quantity must be greater than zero')
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) throw new Error('Batch unit cost cannot be negative')
  const generated=input.batchNumber||`${input.purchaseId.slice(0,8)}-${input.purchaseItemId.slice(0,8)}-${randomUUID().slice(0,8)}`
  const identity=claimBatch(db,{product_id:input.productId,batch_number:generated,expiry_date:input.expiryDate,mfg_date:input.mfgDate,batch_resolution:input.batchResolution,existing_batch_id:input.existingBatchId,acknowledge_dates:input.acknowledgeDates})
  const row = {
    batch_identity_id:identity.id,mfg_date:identity.mfg||null,batch_entry_mode:input.batchResolution==='add_existing'?'add_existing':'new',batch_warning_ack:input.acknowledgeDates?1:0,
    id: randomUUID(), product_id: input.productId, branch_id: input.branchId,
    batch_number: identity.no,
    expiry_date: input.expiryDate || null, quantity: received, cost_price: input.unitCost,
    selling_price: input.sellingPrice ?? null,mrp:input.mrp??null, po_id: input.purchaseId,
    purchase_item_id: input.purchaseItemId, purchase_date: input.purchaseDate,
    original_quantity: received, sold_quantity: 0, returned_quantity: 0, damaged_quantity: 0,
    historical_cost_known: 1, status: 'available', created_by: input.createdBy || null,
  }
  const columns=new Set((db.prepare('PRAGMA table_info(product_batches)').all() as {name:string}[]).map(column=>column.name))
  const saved=Object.fromEntries(Object.entries(row).filter(([key])=>columns.has(key)))
  db.prepare(`INSERT INTO product_batches (${Object.keys(saved).join(',')}) VALUES (${Object.keys(saved).map(key=>'@'+key).join(',')})`).run(saved)
  return saved
  }).immediate()
}

export function getSellingLayers(db: Database.Database, productId: string, branchId: string) {
  db.transaction(() => ensureLegacyOpeningLayer(db, productId, branchId))()
  const product=db.prepare('SELECT * FROM products WHERE id=?').get(productId) as {sale_as_latest_price?:number;selling_price?:number;inventory_pricing_mode?:string;pricing_markup_pct?:number;tax_rate?:number}|undefined
  const layers=db.prepare(`SELECT * FROM product_batches
    WHERE product_id=? AND branch_id=? AND quantity>0
    AND (expiry_date IS NULL OR date(expiry_date)>=date('now','+5 hours','+30 minutes'))
    ORDER BY ${saleBatchOrder(db,productId,branchId)}`)
    .all(productId, branchId) as { quantity: number; selling_price: number | null;mrp?:number|null }[]
  let common:number|undefined
  if(product?.inventory_pricing_mode==='weighted'){
    const context=inventoryPricingContext(db,productId,branchId)
    if(context.average_cost==null)throw new Error('Weighted-average selling requires known historical costs')
    common=Math.round(context.average_cost*(1+Number(product.pricing_markup_pct||0)/100)*100)/100
  }else if(product?.inventory_pricing_mode==='latest'||Number(product?.sale_as_latest_price)===1)common=Number(product?.selling_price||0)
  return layers.map(layer=>{
    const ceiling=layer.mrp==null?null:Number(layer.mrp)/(1+Number(product?.tax_rate||0)/100)
    return {quantity:layer.quantity,mrp:layer.mrp??null,price_ceiling:ceiling,selling_price:ceiling==null?(common??layer.selling_price):Math.min(common??layer.selling_price??Number(product?.selling_price||0),Math.floor(ceiling*100)/100)}
  })
}

export function quoteBatchPrice(db: Database.Database, productId: string, branchId: string, quantity: number, commonPrice: number): number {
  let remaining = quantity, total = 0,ceiling=Infinity
  for (const layer of getSellingLayers(db, productId, branchId)) {
    const take = Math.min(remaining, layer.quantity)
    if(take>0&&layer.price_ceiling!=null)ceiling=Math.min(ceiling,layer.price_ceiling)
    total += take * (layer.selling_price ?? commonPrice)
    remaining -= take
    if (remaining <= 0) break
  }
  return quantity > 0 ? Math.min(Math.round((total + remaining * commonPrice) / quantity * 100) / 100,Math.floor(ceiling*100)/100) : commonPrice
}

/** Quantity reductions restore the newest consumed layer without changing its cost. */
export function reduceSaleBatchQuantity(db: Database.Database, invoiceItemId: string, quantity: number) {
  let remaining = qty(quantity)
  const rows = db.prepare(`SELECT a.* FROM sale_batch_allocations a JOIN product_batches b ON b.id=a.batch_id
    WHERE a.invoice_item_id=? AND a.quantity>a.returned_quantity
    ORDER BY CASE WHEN b.historical_cost_known=0 THEN 0 ELSE 1 END DESC,
      COALESCE(date(b.purchase_date),date(b.created_at)) DESC,b.created_at DESC,b.id DESC`).all(invoiceItemId) as SaleBatchAllocation[]
  for (const row of rows) {
    const take = qty(Math.min(remaining, row.quantity-row.returned_quantity))
    if (take<=0) continue
    db.prepare("UPDATE sale_batch_allocations SET returned_quantity=returned_quantity+?,updated_at=datetime('now') WHERE id=?").run(take,row.id)
    db.prepare("UPDATE product_batches SET quantity=quantity+?,sold_quantity=MAX(0,sold_quantity-?),updated_at=datetime('now') WHERE id=?").run(take,take,row.batch_id)
    updateBatchStatus(db,row.batch_id)
    remaining=qty(remaining-take)
    if (remaining<=0) break
  }
  if (remaining>0) throw new Error('Original batch quantity is unavailable for this correction')
}
