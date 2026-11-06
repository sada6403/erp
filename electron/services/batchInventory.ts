import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'

const QTY_SCALE = 1_000_000
const qty = (value: number) => Math.round((Number(value) || 0) * QTY_SCALE) / QTY_SCALE

export type AllocationMethod = 'FIFO' | 'FEFO'

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
}

function updateBatchStatus(db: Database.Database, batchId: string) {
  db.prepare(`UPDATE product_batches SET status = CASE
    WHEN quantity <= 0 THEN 'sold_out'
    WHEN sold_quantity > 0 THEN 'partially_sold'
    WHEN expiry_date IS NOT NULL AND date(expiry_date) < date('now') THEN 'expired'
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
  db.prepare(`INSERT INTO product_batches
    (id,product_id,branch_id,batch_number,quantity,cost_price,original_quantity,
     historical_cost_known,status,notes,created_at,updated_at)
    VALUES (?,?,?,?,?,?,?,0,'available',?,datetime('now'),datetime('now'))`)
    .run(randomUUID(), productId, branchId, `OPENING-${productId.slice(0, 8)}`, gap, 0, gap,
      'Opening stock migrated without historical purchase cost or purchase date')
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

  const order = input.method === 'FEFO'
    ? `CASE WHEN expiry_date IS NULL THEN 1 ELSE 0 END, date(expiry_date), COALESCE(date(purchase_date), date(created_at)), created_at, id`
    : `CASE WHEN historical_cost_known=0 THEN 0 ELSE 1 END, COALESCE(date(purchase_date), date(created_at)), created_at, id`
  const batches = db.prepare(`SELECT id, quantity, cost_price, historical_cost_known
    FROM product_batches
    WHERE product_id=? AND branch_id=? AND quantity > 0
      AND (expiry_date IS NULL OR date(expiry_date) >= date('now'))
    ORDER BY ${order}`).all(input.productId, input.branchId) as BatchRow[]

  const available = qty(batches.reduce((sum, batch) => sum + Number(batch.quantity), 0))
  if (available + (1 / QTY_SCALE) < remaining) {
    throw new Error(`Insufficient batch stock (available: ${available})`)
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
  batchNumber?: string | null
  expiryDate?: string | null
  purchaseDate: string
  createdBy?: string | null
}): Record<string, unknown> {
  if (input.sellingPrice != null && (!Number.isFinite(input.sellingPrice) || input.sellingPrice < 0)) throw new Error('Selling price must be a valid non-negative amount')
  const received = qty(input.quantity)
  if (!Number.isFinite(received) || received <= 0) throw new Error('Received batch quantity must be greater than zero')
  if (!Number.isFinite(input.unitCost) || input.unitCost < 0) throw new Error('Batch unit cost cannot be negative')
  const row = {
    id: randomUUID(), product_id: input.productId, branch_id: input.branchId,
    batch_number: input.batchNumber || `${input.purchaseId.slice(0, 8)}-${input.purchaseItemId.slice(0, 8)}`,
    expiry_date: input.expiryDate || null, quantity: received, cost_price: input.unitCost,
    selling_price: input.sellingPrice ?? null, po_id: input.purchaseId,
    purchase_item_id: input.purchaseItemId, purchase_date: input.purchaseDate,
    original_quantity: received, sold_quantity: 0, returned_quantity: 0, damaged_quantity: 0,
    historical_cost_known: 1, status: 'available', created_by: input.createdBy || null,
  }
  db.prepare(`INSERT INTO product_batches
    (id,product_id,branch_id,batch_number,expiry_date,quantity,cost_price,selling_price,po_id,
     purchase_item_id,purchase_date,original_quantity,sold_quantity,returned_quantity,damaged_quantity,
     historical_cost_known,status,created_by)
    VALUES (@id,@product_id,@branch_id,@batch_number,@expiry_date,@quantity,@cost_price,@selling_price,@po_id,
     @purchase_item_id,@purchase_date,@original_quantity,@sold_quantity,@returned_quantity,@damaged_quantity,
     @historical_cost_known,@status,@created_by)`).run(row)
  return row
}

export function getSellingLayers(db: Database.Database, productId: string, branchId: string) {
  db.transaction(() => ensureLegacyOpeningLayer(db, productId, branchId))()
  return db.prepare(`SELECT quantity, selling_price FROM product_batches
    WHERE product_id=? AND branch_id=? AND quantity>0
    AND (expiry_date IS NULL OR date(expiry_date)>=date('now'))
    ORDER BY CASE WHEN historical_cost_known=0 THEN 0 ELSE 1 END, COALESCE(date(purchase_date),date(created_at)),created_at,id`)
    .all(productId, branchId) as { quantity: number; selling_price: number | null }[]
}

export function quoteBatchPrice(db: Database.Database, productId: string, branchId: string, quantity: number, commonPrice: number): number {
  let remaining = quantity, total = 0
  for (const layer of getSellingLayers(db, productId, branchId)) {
    const take = Math.min(remaining, layer.quantity)
    total += take * (layer.selling_price ?? commonPrice)
    remaining -= take
    if (remaining <= 0) break
  }
  return quantity > 0 ? Math.round((total + remaining * commonPrice) / quantity * 100) / 100 : commonPrice
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
