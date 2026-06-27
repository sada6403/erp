import { ipcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { enqueuSync } from '../services/syncQueue'

export function registerReturnHandlers() {
  ipcMain.handle('returns:list', (_e, filters: { from_date?: string; to_date?: string; status?: string } = {}) => {
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
    try { return { success: true, data: db.prepare(sql).all(...params) } }
    catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('returns:get', (_e, id: string) => {
    const db = getDb()
    try {
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
    } catch (e) { return { success: false, error: String(e) } }
  })

  // Get invoice items that can be returned
  ipcMain.handle('returns:getInvoiceItems', (_e, invoiceId: string) => {
    const db = getDb()
    try {
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
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('returns:create', async (_e, data: {
    invoice_id: string
    customer_id?: string
    reason: string
    refund_method: string
    notes?: string
    created_by: string
    items: Array<{ product_id: string; invoice_item_id?: string; quantity: number; unit_price: number }>
  }) => {
    const db = getDb()
    try {
      const id = crypto.randomUUID()
      const total_refund = data.items.reduce((s, i) => s + i.quantity * i.unit_price, 0)

      db.prepare(`
        INSERT INTO returns (id, invoice_id, customer_id, reason, total_refund, refund_method, notes, created_by, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'completed')
      `).run(id, data.invoice_id, data.customer_id ?? null, data.reason, total_refund, data.refund_method, data.notes ?? null, data.created_by)

      for (const item of data.items) {
        db.prepare(`
          INSERT INTO return_items (id, return_id, product_id, invoice_item_id, quantity, unit_price)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(crypto.randomUUID(), id, item.product_id, item.invoice_item_id ?? null, item.quantity, item.unit_price)

        // Restore stock in the default branch warehouse
        db.prepare(`UPDATE stocks SET quantity = quantity + ? WHERE product_id = ?`).run(item.quantity, item.product_id)
      }

      await enqueuSync('returns', id, 'INSERT', { id, ...data, total_refund })
      return { success: true, data: { id, total_refund } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('returns:cancel', async (_e, id: string) => {
    const db = getDb()
    try {
      db.prepare(`UPDATE returns SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id)
      await enqueuSync('returns', id, 'UPDATE', { id, status: 'cancelled' })
      return { success: true }
    } catch (e) { return { success: false, error: String(e) } }
  })
}
