import { ipcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { enqueuSync } from '../services/syncQueue'
import { insertStockMovement } from '../services/stockMovement'
import { syncStockRow } from '../services/stockSync'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'
import Store from 'electron-store'

const store = new Store()

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

export function registerReturnHandlers() {
  safeHandle(ipcMain, 'returns:list', (_e, filters: { from_date?: string; to_date?: string; status?: string } = {}) => {
    const db = getDb()
    let sql = `
      SELECT r.*,
        u.name  AS created_by_name,
        i.invoice_number,
        c.name  AS customer_name
      FROM returns r
      LEFT JOIN users     u ON u.id = r.created_by
      LEFT JOIN invoices  i ON i.id = r.invoice_id
      LEFT JOIN customers c ON c.id = r.customer_id
      WHERE 1=1
    `
    const params: string[] = []
    if (filters.from_date) { sql += ` AND date(r.return_date) >= ?`; params.push(filters.from_date) }
    if (filters.to_date)   { sql += ` AND date(r.return_date) <= ?`; params.push(filters.to_date) }
    if (filters.status)    { sql += ` AND r.status = ?`;             params.push(filters.status) }
    sql += ` ORDER BY r.created_at DESC LIMIT 200`
    return { success: true, data: db.prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'returns:get', (_e, id: string) => {
    const db = getDb()
    const ret = db.prepare(`
      SELECT r.*, i.invoice_number, c.name AS customer_name, u.name AS created_by_name
      FROM returns r
      LEFT JOIN invoices  i ON i.id = r.invoice_id
      LEFT JOIN customers c ON c.id = r.customer_id
      LEFT JOIN users     u ON u.id = r.created_by
      WHERE r.id = ?
    `).get(id)
    const items = db.prepare(`
      SELECT ri.*, p.name AS product_name, p.sku
      FROM return_items ri
      LEFT JOIN products p ON p.id = ri.product_id
      WHERE ri.return_id = ?
    `).all(id)
    return { success: true, data: { ...(ret as object), items } }
  })

  // Get invoice items that can be returned
  safeHandle(ipcMain, 'returns:getInvoiceItems', (_e, invoiceId: string) => {
    const db = getDb()
    const invoice = db.prepare(`
      SELECT i.*, c.name AS customer_name
      FROM invoices i LEFT JOIN customers c ON c.id = i.customer_id
      WHERE i.id = ?
    `).get(invoiceId)
    const items = db.prepare(`
      SELECT ii.*, p.name AS product_name, p.sku, p.image_url
      FROM invoice_items ii LEFT JOIN products p ON p.id = ii.product_id
      WHERE ii.invoice_id = ?
    `).all(invoiceId)
    // How many of each item have already been returned
    const alreadyReturned = db.prepare(`
      SELECT ri.invoice_item_id, COALESCE(SUM(ri.quantity),0) AS returned_qty
      FROM return_items ri
      JOIN returns r ON r.id = ri.return_id
      WHERE r.invoice_id = ? AND r.status != 'cancelled'
      GROUP BY ri.invoice_item_id
    `).all(invoiceId) as { invoice_item_id: string; returned_qty: number }[]
    const returnedMap = Object.fromEntries(alreadyReturned.map(x => [x.invoice_item_id, x.returned_qty]))
    const enriched = (items as Record<string, unknown>[]).map(it => ({
      ...it,
      max_return: Math.max(0, Number(it.quantity) - (returnedMap[it.id as string] || 0))
    }))
    return { success: true, data: { invoice, items: enriched } }
  })

  safeHandle(ipcMain, 'returns:create', async (_e, data: {
    invoice_id: string
    customer_id?: string
    reason: string
    refund_method: string
    notes?: string
    items: Array<{ product_id: string; invoice_item_id?: string; quantity: number; unit_price: number }>
  }) => {
    const perms = currentPerms()
    if (!perms.all && !perms.employees && !perms.pos) return { success: false, error: 'Access required to process a return' }
    const caller = authUser()
    const db = getDb()

    const invoice = db.prepare('SELECT branch_id FROM invoices WHERE id = ?').get(data.invoice_id) as { branch_id?: string } | undefined
    const branchId = invoice?.branch_id
    if (!branchId) return { success: false, error: 'Cannot determine branch for this return — invoice not found' }
    if (!perms.all && caller.branch_id && branchId !== caller.branch_id) {
      return { success: false, error: 'Cannot process a return against a bill from another branch' }
    }
    if (!data.items || data.items.length === 0) return { success: false, error: 'Select at least one item to return' }

    // Re-derive every line's real unit_price (from the actual invoice_items
    // row, never the renderer's claim) and cap quantity at what's actually
    // still returnable — without this, returns:create had no server-side
    // limit at all and the SAME invoice_item_id could be refunded/restocked
    // repeatedly by calling it again.
    const id = crypto.randomUUID()
    let total_refund = 0
    const resolvedItems: Array<{ product_id: string; invoice_item_id: string | null; quantity: number; unit_price: number }> = []
    for (const item of data.items) {
      const qty = Number(item.quantity)
      if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) {
        return { success: false, error: 'Every returned item must have a whole-number quantity greater than zero' }
      }
      let unitPrice = Number(item.unit_price) || 0
      if (item.invoice_item_id) {
        const invoiceItem = db.prepare('SELECT product_id, quantity, unit_price FROM invoice_items WHERE id=? AND invoice_id=?')
          .get(item.invoice_item_id, data.invoice_id) as { product_id: string; quantity: number; unit_price: number } | undefined
        if (!invoiceItem) return { success: false, error: 'One of these items does not belong to this invoice' }
        unitPrice = Number(invoiceItem.unit_price) || 0
        const alreadyReturned = (db.prepare(`
          SELECT COALESCE(SUM(ri.quantity),0) as qty FROM return_items ri
          JOIN returns r ON r.id = ri.return_id
          WHERE ri.invoice_item_id = ? AND r.status != 'cancelled'
        `).get(item.invoice_item_id) as { qty: number }).qty
        if (alreadyReturned + qty > Number(invoiceItem.quantity)) {
          return { success: false, error: `Cannot return more than was sold — ${Number(invoiceItem.quantity) - alreadyReturned} of this item still returnable` }
        }
      }
      total_refund += qty * unitPrice
      resolvedItems.push({ product_id: item.product_id, invoice_item_id: item.invoice_item_id ?? null, quantity: qty, unit_price: unitPrice })
    }
    total_refund = Math.round(total_refund * 100) / 100

    db.prepare(`
      INSERT INTO returns (id, invoice_id, customer_id, reason, total_refund, refund_method, notes, created_by, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')
    `).run(id, data.invoice_id, data.customer_id ?? null, data.reason, total_refund, data.refund_method, data.notes ?? null, caller.id || null)

    const itemRecords: Record<string, unknown>[] = []
    const movementRecords: Record<string, unknown>[] = []
    for (const item of resolvedItems) {
      const itemId = crypto.randomUUID()
      db.prepare(`
        INSERT INTO return_items (id, return_id, product_id, invoice_item_id, quantity, unit_price)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(itemId, id, item.product_id, item.invoice_item_id, item.quantity, item.unit_price)
      itemRecords.push({
        id: itemId, return_id: id, product_id: item.product_id,
        invoice_item_id: item.invoice_item_id, quantity: item.quantity, unit_price: item.unit_price,
      })

      // Restore stock in the branch the sale actually happened in
      db.prepare(`UPDATE stocks SET quantity = quantity + ? WHERE product_id = ? AND branch_id = ?`)
        .run(item.quantity, item.product_id, branchId)
      movementRecords.push(insertStockMovement(db, {
        product_id: item.product_id,
        from_branch_id: null,
        to_branch_id: branchId,
        quantity: item.quantity,
        movement_type: 'ADJUSTMENT',
        reference_order_id: data.invoice_id,
        notes: `Return: ${data.reason}`,
        created_by: (caller.id as string) || null,
      }))
    }

    logAudit(db, {
      userId: (caller.id as string) || null, branchId: branchId as string,
      action: 'RETURN_CREATED', tableName: 'returns', recordId: id,
      newValues: { invoiceId: data.invoice_id, totalRefund: total_refund, itemCount: resolvedItems.length },
    })

    await enqueuSync('returns', id, 'INSERT', { id, invoice_id: data.invoice_id, customer_id: data.customer_id ?? null, reason: data.reason, refund_method: data.refund_method, notes: data.notes ?? null, created_by: caller.id || null, total_refund })
    for (const itemRow of itemRecords) {
      await enqueuSync('return_items', String(itemRow.id), 'INSERT', itemRow)
    }
    for (const movement of movementRecords) {
      await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
      await syncStockRow(db, String(movement.product_id), branchId)
    }
    return { success: true, data: { id, total_refund } }
  })

  safeHandle(ipcMain, 'returns:cancel', async (_e, id: string) => {
    const perms = currentPerms()
    if (!perms.all && !perms.employees) return { success: false, error: 'Manager access required to cancel a return' }
    const caller = authUser()
    const db = getDb()
    const ret = db.prepare(`
      SELECT r.id, r.status, i.branch_id FROM returns r LEFT JOIN invoices i ON i.id = r.invoice_id WHERE r.id=?
    `).get(id) as { id: string; status: string; branch_id: unknown } | undefined
    if (!ret) return { success: false, error: 'Return not found' }
    if (!perms.all && caller.branch_id && ret.branch_id && ret.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot cancel a return from another branch' }
    }
    if (ret.status === 'cancelled') return { success: false, error: 'This return is already cancelled' }
    db.prepare(`UPDATE returns SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id)
    logAudit(db, { userId: (caller.id as string) || null, branchId: (ret.branch_id as string) || null, action: 'RETURN_CANCELLED', tableName: 'returns', recordId: id })
    await enqueuSync('returns', id, 'UPDATE', { id, status: 'cancelled' })
    return { success: true }
  })
}
