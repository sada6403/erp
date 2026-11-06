import type Database from 'better-sqlite3'
import { randomUUID } from 'crypto'
import { createReceiptBatch, ensureLegacyOpeningLayer } from './batchInventory'
import { applyReceiptProductPrices } from './receiptProductPricing'
import { insertStockMovement } from './stockMovement'

export interface StockPurchaseInput {
  id: string; poNumber: string; branchId: string; userId?: string | null
  supplierId: string; purchaseType: 'order' | 'direct'; purchaseDate: string
  invoiceNumber?: string; expectedDate?: string; notes?: string
  items: { product_id: string; quantity: number; unit_cost: number; selling_price?: number | null }[]
}
const round = (value: number) => Math.round(value * 1e6)/1e6
export function createStockPurchase(db: Database.Database, input: StockPurchaseInput, saveBills?: (purchaseId: string) => void) {
  if (!['order','direct'].includes(input.purchaseType)) throw new Error('Invalid purchase type')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.purchaseDate) || Number.isNaN(Date.parse(input.purchaseDate))) throw new Error('Valid purchase date is required')
  if (!db.prepare('SELECT 1 FROM suppliers WHERE id=?').get(input.supplierId)) throw new Error('Supplier not found')
  if (!input.items.length) throw new Error('At least one product is required')
  for (const item of input.items) {
    if (!db.prepare('SELECT 1 FROM products WHERE id=?').get(item.product_id)) throw new Error('Product not found')
    if (!Number.isFinite(item.quantity) || round(item.quantity)<=0) throw new Error('Quantity must be greater than zero')
    if (!Number.isFinite(item.unit_cost) || item.unit_cost<=0) throw new Error('Purchase price must be greater than zero')
    if (item.selling_price != null && (!Number.isFinite(item.selling_price) || item.selling_price<0)) throw new Error('Invalid selling price')
  }
  return db.transaction(() => {
    const existing=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id) as Record<string, unknown> | undefined
    if (existing) {
      if (existing.branch_id!==input.branchId || existing.supplier_id!==input.supplierId) throw new Error('Purchase reference already used')
      return existing
    }
    if(input.invoiceNumber?.trim() && db.prepare('SELECT 1 FROM purchase_orders WHERE supplier_id=? AND supplier_invoice_number=?').get(input.supplierId,input.invoiceNumber.trim())) throw new Error('This supplier bill number is already saved. Open the existing purchase.')
    const total=Math.round(input.items.reduce((sum,item)=>sum+round(item.quantity)*item.unit_cost,0)*100)/100
    const purchase={id:input.id,po_number:input.poNumber,branch_id:input.branchId,supplier_id:input.supplierId,
      purchase_type:input.purchaseType,status:input.purchaseType==='direct'?'RECEIVED':'DRAFT',
      purchase_date:input.purchaseDate,supplier_invoice_number:input.invoiceNumber?.trim()||null,
      expected_date:input.expectedDate||null,received_at:input.purchaseType==='direct'?new Date().toISOString():null,
      notes:input.notes||null,total_amount:total,created_by:input.userId||null}
    db.prepare(`INSERT INTO purchase_orders (id,po_number,branch_id,supplier_id,purchase_type,status,purchase_date,
      supplier_invoice_number,expected_date,received_at,notes,total_amount,created_by)
      VALUES (@id,@po_number,@branch_id,@supplier_id,@purchase_type,@status,@purchase_date,
      @supplier_invoice_number,@expected_date,@received_at,@notes,@total_amount,@created_by)`).run(purchase)
    for(const item of input.items){
      const row={id:randomUUID(),po_id:input.id,product_id:item.product_id,quantity:round(item.quantity),
        unit_cost:item.unit_cost,line_total:Math.round(round(item.quantity)*item.unit_cost*100)/100,
        selling_price:item.selling_price??null,received_qty:input.purchaseType==='direct'?round(item.quantity):0}
      db.prepare(`INSERT INTO purchase_items (id,po_id,product_id,quantity,unit_cost,line_total,selling_price,received_qty)
        VALUES (@id,@po_id,@product_id,@quantity,@unit_cost,@line_total,@selling_price,@received_qty)`).run(row)
      if(input.purchaseType==='direct'){
        applyReceiptProductPrices(db,item.product_id,item.unit_cost,row.selling_price)
        ensureLegacyOpeningLayer(db,item.product_id,input.branchId)
        const stock=db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL').get(item.product_id,input.branchId) as {id:string}|undefined
        if(stock) db.prepare("UPDATE stocks SET quantity=quantity+?,updated_at=datetime('now') WHERE id=?").run(row.quantity,stock.id)
        else db.prepare('INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,0)').run(randomUUID(),item.product_id,input.branchId,row.quantity)
        createReceiptBatch(db,{productId:item.product_id,branchId:input.branchId,purchaseId:input.id,purchaseItemId:row.id,
          quantity:row.quantity,unitCost:item.unit_cost,sellingPrice:row.selling_price,purchaseDate:input.purchaseDate,createdBy:input.userId})
        insertStockMovement(db,{product_id:item.product_id,to_branch_id:input.branchId,quantity:row.quantity,
          movement_type:'RECEIVE',reference_order_id:input.id,created_by:input.userId,notes:`Direct stock purchase ${input.poNumber}`})
      }
    }
    saveBills?.(input.id)
    return purchase
  })()
}
