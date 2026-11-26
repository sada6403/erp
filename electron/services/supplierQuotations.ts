import type Database from 'better-sqlite3'
import { createStockPurchase, replaceDraftPurchase } from './purchaseEntry'
import { queueInventoryRecord } from './inventoryOutbox'
import { withStatementCache } from './statementCache'

const MEASURED = new Set(['kg', 'g', 'ltr', 'l', 'ml'])
const round = (value: number, unit: string) => MEASURED.has(unit.toLowerCase()) ? Math.ceil(value * 1000) / 1000 : Math.ceil(value)

export interface ReorderRow {
  product_id: string; name: string; sku: string; barcode: string; unit: string
  current_stock: number; min_stock_level: number; max_stock_level: number | null
  incoming_quantity: number; incoming_orders: string[]
  sold_quantity: number; sales_days: number
  last_purchase_price: number | null; estimated_cost: number
  recommended_quantity: number
  status: 'out' | 'low' | 'reorder' | 'ok'
  auto_selected: boolean
}

/**
 * Products this supplier provides (explicit mapping or purchase history) with the
 * numbers needed to decide how much to order. Stock/incoming are for one branch.
 */
export function supplierReorderPlan(db: Database.Database, input: { supplierId: string; branchId: string; salesDays?: number; coverDays?: number; excludePurchaseId?: string }) {
  const salesDays = input.salesDays ?? 30, coverDays = input.coverDays ?? 14
  const supplier = db.prepare('SELECT * FROM suppliers WHERE id=?').get(input.supplierId) as Record<string, unknown> | undefined
  if (!supplier) throw new Error('Supplier not found')
  const products = db.prepare(`SELECT p.* FROM products p WHERE p.is_active=1 AND (p.supplier_id=? OR p.id IN (
      SELECT pi.product_id FROM purchase_items pi JOIN purchase_orders po ON po.id=pi.po_id WHERE po.supplier_id=? AND po.status!='CANCELLED'))
    ORDER BY p.name`).all(input.supplierId, input.supplierId) as Record<string, any>[]
  const rows = products.map(product => planRow(db, product, input.supplierId, input.branchId, salesDays, coverDays, input.excludePurchaseId))
  return { supplier, sales_days: salesDays, cover_days: coverDays, rows }
}

export function planRow(db: Database.Database, product: Record<string, any>, supplierId: string, branchId: string, salesDays = 30, coverDays = 14, excludePurchaseId?: string): ReorderRow {
  const unit = String(product.unit || 'pcs')
  const stock = Number((db.prepare(`SELECT COALESCE(SUM(MAX(0,quantity-COALESCE(damaged_qty,0))),0) q FROM stocks WHERE product_id=? AND branch_id=? AND warehouse_id IS NULL`).get(product.id, branchId) as { q: number }).q)
  const incoming = db.prepare(`SELECT po.po_number, SUM(MAX(0, pi.quantity-COALESCE(pi.received_qty,0))) q FROM purchase_items pi JOIN purchase_orders po ON po.id=pi.po_id
    WHERE pi.product_id=? AND po.branch_id=? AND po.status IN ('DRAFT','SENT','PARTIAL') AND po.id<>? GROUP BY po.id HAVING q>0`).all(product.id, branchId, excludePurchaseId || '') as { po_number: string; q: number }[]
  const incomingQuantity = incoming.reduce((sum, row) => sum + Number(row.q), 0)
  const sold = Number((db.prepare(`SELECT COALESCE(SUM(ii.quantity),0) q FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id
    WHERE ii.product_id=? AND i.branch_id=? AND i.status='completed' AND COALESCE(i.bill_type,'RETAIL')<>'QUOTATION'
    AND datetime(i.created_at) >= datetime('now', ?)`).get(product.id, branchId, `-${salesDays} days`) as { q: number }).q)
  const last = db.prepare(`SELECT pi.unit_cost FROM purchase_items pi JOIN purchase_orders po ON po.id=pi.po_id
    WHERE pi.product_id=? AND po.supplier_id=? AND po.status IN ('RECEIVED','PARTIAL') AND COALESCE(pi.price_confirmed,1)=1
    ORDER BY COALESCE(po.received_at, po.purchase_date, po.created_at) DESC LIMIT 1`).get(product.id, supplierId) as { unit_cost: number } | undefined
  const min = Number(product.min_stock_level ?? 0)
  const max = product.max_stock_level == null || Number(product.max_stock_level) <= 0 ? null : Number(product.max_stock_level)
  const daily = sold / salesDays
  const target = max ?? Math.max(min * 2, min + daily * coverDays, min > 0 ? min + 1 : 0)
  const available = stock + incomingQuantity
  const needs = stock <= 0 || stock <= min
  const recommended = needs ? Math.max(0, round(target - available, unit)) : 0
  const status: ReorderRow['status'] = stock <= 0 ? 'out' : stock <= min ? 'low' : available <= min ? 'reorder' : 'ok'
  const lastPrice = last ? Number(last.unit_cost) : null
  return {
    product_id: String(product.id), name: String(product.name), sku: String(product.sku || ''), barcode: String(product.barcode || ''), unit,
    current_stock: stock, min_stock_level: min, max_stock_level: max,
    incoming_quantity: incomingQuantity, incoming_orders: incoming.map(row => row.po_number),
    sold_quantity: sold, sales_days: salesDays,
    last_purchase_price: lastPrice, estimated_cost: lastPrice ?? Number(product.cost_price || 0),
    recommended_quantity: recommended, status,
    auto_selected: status !== 'ok' && recommended > 0,
  }
}

export interface QuotationLineInput { product_id: string; quantity: number; estimated_cost?: number; remarks?: string; link_supplier?: boolean; override_pending?: boolean }
export interface QuotationInput {
  id: string; poNumber: string; supplierId: string; branchId: string; userId?: string | null
  lines: QuotationLineInput[]; requestedItems?: { name: string; quantity: number; unit?: string; remarks?: string }[]
  deliveryRequirements?: string; expectedDate?: string; notes?: string; canOverride: boolean
}

/** Creates or updates a supplier quotation request, stored as a DRAFT purchase order. Stock never changes here. */
export function saveSupplierQuotation(db: Database.Database, input: QuotationInput) {
  return withStatementCache(db, () => db.transaction(() => {
    if (!input.lines.length && !input.requestedItems?.length) throw new Error('Add at least one product to the quotation')
    const existing = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id) as Record<string, any> | undefined
    if (existing && (existing.status !== 'DRAFT' || !existing.is_quotation)) throw new Error('Only a draft quotation can be edited')
    const seen = new Set<string>()
    const duplicates: string[] = []
    for (const line of input.lines) {
      if (seen.has(line.product_id)) throw new Error('A product appears twice in the quotation')
      seen.add(line.product_id)
      if (!(Number(line.quantity) > 0)) throw new Error('Every quotation line needs a quantity above zero')
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(line.product_id) as Record<string, any> | undefined
      if (!product) throw new Error('Product not found')
      const pending = planRow(db, product, input.supplierId, input.branchId, 30, 14, input.id)
      if (pending.incoming_quantity > 0 && !line.override_pending) duplicates.push(`${product.name} (${pending.incoming_quantity} ${pending.unit} on ${pending.incoming_orders.join(', ')})`)
      if (line.override_pending && pending.incoming_quantity > 0 && !input.canOverride) throw new Error('Manager permission is required to order a product that is already on a pending order')
    }
    if (duplicates.length) throw new Error(JSON.stringify({ code: 'PENDING_ORDER', message: 'Already on pending orders', items: duplicates }))
    const items = input.lines.map(line => {
      const product = db.prepare('SELECT cost_price FROM products WHERE id=?').get(line.product_id) as { cost_price?: number }
      const estimate = Number(line.estimated_cost) > 0 ? Number(line.estimated_cost) : Number(product?.cost_price || 0)
      if (!(estimate > 0)) throw new Error('Enter an estimated price for every line (it is not sent to the supplier)')
      return { product_id: line.product_id, quantity: Number(line.quantity), unit_cost: estimate, remarks: line.remarks?.trim() || null, price_confirmed: 0 }
    })
    if (existing) {
      replaceDraftPurchase(db, input.id, input.branchId, { supplier_id: input.supplierId, notes: input.notes, expected_date: input.expectedDate, items: items as never })
    } else if (items.length) {
      createStockPurchase(db, { id: input.id, poNumber: input.poNumber, branchId: input.branchId, userId: input.userId, supplierId: input.supplierId, purchaseType: 'order', purchaseDate: new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), expectedDate: input.expectedDate, notes: input.notes, items })
    } else {
      db.prepare(`INSERT INTO purchase_orders (id,po_number,branch_id,supplier_id,purchase_type,status,purchase_date,expected_date,notes,total_amount,created_by)
        VALUES (?,?,?,?,'order','DRAFT',?,?,?,0,?)`).run(input.id, input.poNumber, input.branchId, input.supplierId, new Date(Date.now() + 330 * 60000).toISOString().slice(0, 10), input.expectedDate || null, input.notes || null, input.userId || null)
    }
    for (const line of input.lines) {
      db.prepare("UPDATE purchase_items SET remarks=?,price_confirmed=0,updated_at=datetime('now') WHERE po_id=? AND product_id=?").run(line.remarks?.trim() || null, input.id, line.product_id)
      if (line.link_supplier) {
        const product = db.prepare('SELECT supplier_id FROM products WHERE id=?').get(line.product_id) as { supplier_id?: string | null }
        if (!product.supplier_id) {
          db.prepare("UPDATE products SET supplier_id=?,updated_at=datetime('now') WHERE id=?").run(input.supplierId, line.product_id)
          queueInventoryRecord(db, 'products', db.prepare('SELECT * FROM products WHERE id=?').get(line.product_id) as Record<string, unknown>, 'UPDATE')
        }
      }
    }
    const number = existing?.quotation_number || `RFQ-${input.poNumber}`
    db.prepare(`UPDATE purchase_orders SET is_quotation=1,quotation_number=?,delivery_requirements=?,requested_items=?,updated_at=datetime('now') WHERE id=?`)
      .run(number, input.deliveryRequirements?.trim() || null, input.requestedItems?.length ? JSON.stringify(input.requestedItems) : null, input.id)
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id) as Record<string, unknown>
    queueInventoryRecord(db, 'purchase_orders', po, 'UPDATE')
    for (const item of db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(input.id) as Record<string, unknown>[]) queueInventoryRecord(db, 'purchase_items', item, 'UPDATE')
    return po
  }).immediate())
}

/** Records the prices and offers the supplier confirmed. Still a draft: stock does not change. */
export function confirmQuotationPrices(db: Database.Database, input: { id: string; branchId: string; lines: { product_id: string; quantity: number; unit_cost: number; free_quantity?: number; discount_amount?: number; remarks?: string | null }[] }) {
  return withStatementCache(db, () => db.transaction(() => {
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=? AND branch_id=?').get(input.id, input.branchId) as Record<string, any> | undefined
    if (!po || po.status !== 'DRAFT' || !po.is_quotation) throw new Error('Only a draft quotation can take supplier prices')
    if (!input.lines.length) throw new Error('The quotation has no lines')
    for (const line of input.lines) if (!(Number(line.unit_cost) > 0)) throw new Error('Enter the supplier-confirmed price for every line')
    replaceDraftPurchase(db, input.id, input.branchId, { items: input.lines.map(line => ({ product_id: line.product_id, quantity: Number(line.quantity), unit_cost: Number(line.unit_cost), free_quantity: Number(line.free_quantity || 0), discount_amount: Number(line.discount_amount || 0), remarks: line.remarks ?? null, price_confirmed: 1 })) as never })
    db.prepare("UPDATE purchase_items SET price_confirmed=1,updated_at=datetime('now') WHERE po_id=?").run(input.id)
    for (const item of db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(input.id) as Record<string, unknown>[]) queueInventoryRecord(db, 'purchase_items', item, 'UPDATE')
    return db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(input.id)
  }).immediate())
}

/** A quotation becomes a purchase order only after every price was confirmed by the supplier. */
export function assertQuotationReady(db: Database.Database, id: string) {
  const po = db.prepare('SELECT is_quotation FROM purchase_orders WHERE id=?').get(id) as { is_quotation?: number } | undefined
  if (!po?.is_quotation) return
  const open = db.prepare('SELECT COUNT(*) n FROM purchase_items WHERE po_id=? AND COALESCE(price_confirmed,1)=0').get(id) as { n: number }
  if (open.n > 0) throw new Error('Record the supplier-confirmed prices before converting this quotation into a purchase order')
  const lines = db.prepare('SELECT COUNT(*) n FROM purchase_items WHERE po_id=?').get(id) as { n: number }
  if (!lines.n) throw new Error('Add products before converting this quotation into a purchase order')
}

/** Supplier-facing WhatsApp text: quantities only, no costs, margins or selling prices. */
export function quotationWhatsAppText(db: Database.Database, id: string, companyName: string) {
  const po = db.prepare(`SELECT po.*, s.name supplier_name, b.name branch_name FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN branches b ON b.id=po.branch_id WHERE po.id=?`).get(id) as Record<string, any> | undefined
  if (!po?.is_quotation) throw new Error('Quotation not found')
  const items = db.prepare(`SELECT pi.quantity, pi.remarks, p.name, p.sku, p.unit FROM purchase_items pi JOIN products p ON p.id=pi.product_id WHERE pi.po_id=? ORDER BY p.name`).all(id) as Record<string, any>[]
  const requested = po.requested_items ? JSON.parse(po.requested_items) as { name: string; quantity: number; unit?: string; remarks?: string }[] : []
  const lines = [
    ...items.map((it, i) => `${i + 1}. ${it.name}${it.sku ? ` (${it.sku})` : ''} - ${it.quantity} ${it.unit || ''}${it.remarks ? ` - ${it.remarks}` : ''}`),
    ...requested.map((it, i) => `${items.length + i + 1}. ${it.name} (new item) - ${it.quantity} ${it.unit || ''}${it.remarks ? ` - ${it.remarks}` : ''}`),
  ]
  return [
    `*REQUEST FOR QUOTATION - ${companyName}*`,
    `RFQ No: ${po.quotation_number}`,
    `Date: ${String(po.purchase_date || '').slice(0, 10)}`,
    `To: ${po.supplier_name}`,
    `Deliver to: ${po.branch_name || 'Main branch'}`,
    po.expected_date ? `Required by: ${po.expected_date}` : '',
    '',
    '*Items requested:*',
    ...lines,
    '',
    po.delivery_requirements ? `Delivery: ${po.delivery_requirements}` : '',
    'Please reply with your unit price, discount and any free quantity for each item.',
  ].filter((line, index, all) => line !== '' || (all[index - 1] !== '' && index > 0)).join('\n')
}
