import type Database from 'better-sqlite3'
import crypto from 'crypto'
import { usesSupermarketStock } from './supermarketModule'
import { allocateSaleBatches, quoteBatchPrice } from './batchInventory'
import { resolveApplicableDiscount } from '../ipc/discounts'
import { isAdminTypeRole } from './pinPolicy'
import { insertStockMovement } from './stockMovement'
import { logAudit } from './auditLog'
import { computeAndRecordCommission } from './commissionEngine'

const money = (v: number) => Math.round(v * 100) / 100
type Row = Record<string, any>

// One transaction: append lines, sell only the extra stock, collect only the
// extra payment, and preserve the original number, payments and sale lines.
export function appendInvoiceItems(db: Database.Database, user: Row, settings: Row, id: string, payload: Row) {
  const sync: { table: string; id: string; row: Row; op: 'INSERT' | 'UPDATE' }[] = []
  const stockProducts = new Set<string>()
  const result = db.transaction(() => {
    if (!user?.id) throw new Error('Sign in before updating a bill')
    const invoice = db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Row | undefined
    if (!invoice) throw new Error('Bill not found')
    const perms = user.role?.permissions || user.permissions || {}
    if (!perms.all && invoice.branch_id !== user.branch_id) throw new Error('Cannot update a bill from another branch')
    if (invoice.status !== 'completed' || invoice.bill_type !== 'RETAIL') throw new Error('Extra items can be added to completed retail bills only')
    if (invoice.locked_at) throw new Error('This bill is locked for day-end')
    if (invoice.source_order_id) throw new Error('Online order bills must be updated through the order workflow')
    if (Number(invoice.due_amount) > 0.01) throw new Error('Settle the existing bill balance before adding items')
    if (db.prepare("SELECT 1 FROM returns WHERE invoice_id=? AND status!='cancelled' LIMIT 1").get(id)) throw new Error('This bill has sale returns; cancel those returns before adding items')
    if (!Array.isArray(payload.items) || !payload.items.length) throw new Error('Add at least one product')
    if (!['cash', 'card', 'bank_transfer'].includes(payload.method)) throw new Error('Choose cash, card or bank transfer')
    // Optimistic concurrency also prevents retrying a committed append.
    if (!Number.isFinite(payload.expected_total) || Math.abs(Number(invoice.total_amount) - payload.expected_total) > 0.001) throw new Error('This bill changed. Open it again before adding items')
    const existingCount = (db.prepare('SELECT COUNT(*) AS count FROM invoice_items WHERE invoice_id=?').get(id) as { count: number }).count
    if (payload.expected_item_count !== existingCount) throw new Error('This bill changed. Open it again before adding items')
    const supermarket = usesSupermarketStock(settings)
    let subtotal = 0, discount = 0, tax = 0, commission = Number(invoice.agent_commission_amount || 0)
    for (const item of payload.items) {
      const product = db.prepare('SELECT * FROM products WHERE id=? AND is_active=1').get(item.product_id) as Row | undefined
      if (!product) throw new Error('Product is unavailable')
      const qty = Number(item.quantity), price = Number(item.unit_price), pct = Number(item.discount_pct || 0)
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(price) || price < 0 || !Number.isFinite(pct) || pct < 0 || pct > 100) throw new Error('Enter a valid quantity, price and discount')
      let expected = supermarket ? quoteBatchPrice(db, product.id, invoice.branch_id, qty, product.selling_price) : Number(product.selling_price)
      if (item.variant_id) {
        const variant = db.prepare('SELECT * FROM product_variants WHERE id=? AND product_id=? AND is_active=1').get(item.variant_id, product.id) as Row | undefined
        if (!variant) throw new Error('Product variant is unavailable')
        expected = Number(variant.selling_price) || expected
        const changed = db.prepare("UPDATE product_variants SET stock=stock-?,updated_at=datetime('now') WHERE id=? AND stock>=?").run(qty, variant.id, qty)
        if (!changed.changes) throw new Error('Insufficient variant stock')
        sync.push({ table: 'product_variants', id: String(variant.id), row: db.prepare('SELECT * FROM product_variants WHERE id=?').get(variant.id) as Row, op: 'UPDATE' })
      }
      if (!isAdminTypeRole(perms) && Math.abs(price - expected) > 0.01) throw new Error('Product price changed; refresh the product')
      const allowed = resolveApplicableDiscount(db, product.id, price, invoice.branch_id)?.pct || 0
      if (pct > allowed + 0.001) throw new Error('Discount exceeds the product allowance')
      const gross = money(qty * price), disc = money(gross * pct / 100), taxRate = Number(product.tax_rate) || 0
      const lineTax = money((gross - disc) * taxRate / 100)
      if (![gross, disc, lineTax].every(Number.isFinite)) throw new Error('Item total is too large')
      const row = { id: crypto.randomUUID(), invoice_id: id, product_id: product.id, variant_id: item.variant_id || null,
        variant_title: item.variant_name || null, quantity: qty, unit_price: price, discount_pct: pct,
        discount_amount: disc, tax_rate: taxRate, tax_amount: lineTax, line_total: money(gross - disc + lineTax) }
      db.prepare(`INSERT INTO invoice_items (id,invoice_id,product_id,variant_id,variant_title,quantity,unit_price,discount_pct,discount_amount,tax_rate,tax_amount,line_total)
        VALUES (@id,@invoice_id,@product_id,@variant_id,@variant_title,@quantity,@unit_price,@discount_pct,@discount_amount,@tax_rate,@tax_amount,@line_total)`).run(row)
      sync.push({ table: 'invoice_items', id: row.id, row, op: 'INSERT' })
      if (supermarket) {
        const allocations = allocateSaleBatches(db, { invoiceId: id, invoiceItemId: row.id, productId: product.id, branchId: invoice.branch_id, quantity: qty, unitSellingPrice: price * (1 - pct / 100), method: undefined })
        for (const allocation of allocations) {
          sync.push({ table: 'sale_batch_allocations', id: allocation.id, row: { ...allocation }, op: 'INSERT' })
          sync.push({ table: 'product_batches', id: allocation.batch_id, row: db.prepare('SELECT * FROM product_batches WHERE id=?').get(allocation.batch_id) as Row, op: 'UPDATE' })
        }
      }
      const negative = !supermarket && Boolean(settings.allow_negative_stock)
      const changed = db.prepare(`UPDATE stocks SET quantity=quantity-?,updated_at=datetime('now') WHERE product_id=? AND branch_id=? ${negative ? '' : 'AND quantity-COALESCE(damaged_qty,0)>=?'}`)
        .run(...(negative ? [qty, product.id, invoice.branch_id] : [qty, product.id, invoice.branch_id, qty]))
      if (!changed.changes) throw new Error('Insufficient stock for extra items')
      const movement = insertStockMovement(db, { product_id: product.id, from_branch_id: invoice.branch_id, to_branch_id: null, quantity: qty, movement_type: 'SALE', reference_order_id: id, notes: `Extra items on ${invoice.invoice_number}`, created_by: user.id, variant_id: item.variant_id || null })
      sync.push({ table: 'stock_movements', id: String(movement.id), row: movement, op: 'INSERT' })
      stockProducts.add(product.id)
      if (invoice.agent_id) {
        const computed = computeAndRecordCommission(db, { sourceTable: 'invoice_items', sourceId: row.id, productId: product.id, schemeId: null, memberId: null, registrationAgentId: invoice.agent_id, salesAgentId: null, amount: gross - disc, branchId: invoice.branch_id })
        commission += computed.totalCommission
        sync.push(...computed.enqueue)
      }
      subtotal += gross; discount += disc; tax += lineTax
    }
    const extra = money(subtotal - discount + tax), received = Number(payload.received)
    if (!Number.isFinite(received) || received < extra) throw new Error(`Collect Rs.${extra.toFixed(2)} for the extra items`)
    const total = money(Number(invoice.total_amount) + extra), newSubtotal = money(Number(invoice.subtotal) + subtotal)
    db.prepare(`UPDATE invoices SET subtotal=?,discount_amount=discount_amount+?,tax_amount=tax_amount+?,total_amount=?,paid_amount=paid_amount+?,agent_commission_amount=?,agent_commission_pct=?,updated_at=datetime('now') WHERE id=?`)
      .run(newSubtotal, money(discount), money(tax), total, extra, money(commission), newSubtotal > 0 ? money(commission / newSubtotal * 100) : 0, id)
    if (extra > 0) {
      const payment = { id: crypto.randomUUID(), invoice_id: id, method: payload.method, amount: extra, reference: payload.reference || null, received_by: user.id }
      db.prepare('INSERT INTO payments (id,invoice_id,method,amount,reference,received_by) VALUES (@id,@invoice_id,@method,@amount,@reference,@received_by)').run(payment)
      sync.push({ table: 'payments', id: payment.id, row: payment, op: 'INSERT' })
    }
    logAudit(db, { userId: user.id, branchId: invoice.branch_id, action: 'INVOICE_ITEMS_ADDED', tableName: 'invoices', recordId: id, oldValues: { total_amount: invoice.total_amount }, newValues: { total_amount: total, extra_amount: extra, item_count: payload.items.length } })
    sync.push({ table: 'invoices', id, row: db.prepare('SELECT * FROM invoices WHERE id=?').get(id) as Row, op: 'UPDATE' })
    return { id, invoice_number: invoice.invoice_number, extra_amount: extra, change: money(received - extra), branch_id: invoice.branch_id }
  })()
  return { result, sync, stockProducts: [...stockProducts] }
}
