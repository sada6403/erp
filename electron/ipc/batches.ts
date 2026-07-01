import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'

interface BatchRow {
  id: string
  product_id: string
  branch_id: string | null
  batch_number: string | null
  serial_number: string | null
  expiry_date: string | null
  mfg_date: string | null
  quantity: number
  cost_price: number
  po_id: string | null
  notes: string | null
  created_at: string
}

export function registerBatchHandlers() {

  ipcMain.handle('batches:list', (_e, filters: { product_id?: string; branch_id?: string; expiring_days?: number }) => {
    try {
      const db = getDb()
      const wheres: string[] = ['b.quantity > 0']
      const params: unknown[] = []
      if (filters.product_id) { wheres.push('b.product_id = ?'); params.push(filters.product_id) }
      if (filters.branch_id)  { wheres.push('b.branch_id = ?');  params.push(filters.branch_id) }
      if (filters.expiring_days) {
        wheres.push(`b.expiry_date IS NOT NULL AND b.expiry_date <= date('now', '+${Math.abs(filters.expiring_days)} days')`)
      }
      const rows = db.prepare(`
        SELECT b.*, p.name as product_name, p.sku as product_sku, br.name as branch_name
        FROM product_batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN branches br ON br.id = b.branch_id
        WHERE ${wheres.join(' AND ')}
        ORDER BY b.expiry_date ASC NULLS LAST, b.created_at ASC
      `).all(...params)
      return { success: true, data: rows }
    } catch (err) { return { success: false, data: [], error: String(err) } }
  })

  ipcMain.handle('batches:get', (_e, id: string) => {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT * FROM product_batches WHERE id = ?`).get(id)
      return { success: true, data: row }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('batches:create', (_e, payload: Partial<BatchRow> & { product_id: string }) => {
    try {
      const db = getDb()
      const id = randomUUID()
      db.prepare(`
        INSERT INTO product_batches (id, product_id, branch_id, batch_number, serial_number, expiry_date, mfg_date, quantity, cost_price, po_id, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, payload.product_id, payload.branch_id ?? null, payload.batch_number ?? null,
        payload.serial_number ?? null, payload.expiry_date ?? null, payload.mfg_date ?? null,
        payload.quantity ?? 0, payload.cost_price ?? 0, payload.po_id ?? null, payload.notes ?? null,
        (payload as Record<string, unknown>).created_by ?? null
      )
      return { success: true, id }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('batches:update', (_e, id: string, payload: Partial<BatchRow>) => {
    try {
      const db = getDb()
      const allowed = ['batch_number','serial_number','expiry_date','mfg_date','quantity','cost_price','notes'] as const
      const sets = allowed.filter(k => payload[k] !== undefined).map(k => `${k} = ?`)
      const vals = allowed.filter(k => payload[k] !== undefined).map(k => payload[k])
      if (!sets.length) return { success: false, error: 'Nothing to update' }
      db.prepare(`UPDATE product_batches SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id)
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('batches:consume', (_e, payload: { batch_id: string; qty: number }) => {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT quantity FROM product_batches WHERE id = ?`).get(payload.batch_id) as { quantity: number } | undefined
      if (!row) return { success: false, error: 'Batch not found' }
      if (row.quantity < payload.qty) return { success: false, error: `Insufficient batch quantity (available: ${row.quantity})` }
      db.prepare(`UPDATE product_batches SET quantity = quantity - ?, updated_at = datetime('now') WHERE id = ?`).run(payload.qty, payload.batch_id)
      return { success: true }
    } catch (err) { return { success: false, error: String(err) } }
  })

  ipcMain.handle('batches:expiring', (_e, days: number = 30) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT b.*, p.name as product_name, p.sku as product_sku, br.name as branch_name,
               julianday(b.expiry_date) - julianday('now') as days_until_expiry
        FROM product_batches b
        JOIN products p ON p.id = b.product_id
        LEFT JOIN branches br ON br.id = b.branch_id
        WHERE b.expiry_date IS NOT NULL
          AND b.quantity > 0
          AND b.expiry_date <= date('now', '+' || ? || ' days')
        ORDER BY b.expiry_date ASC
      `).all(days)
      return { success: true, data: rows }
    } catch (err) { return { success: false, data: [], error: String(err) } }
  })

  ipcMain.handle('batches:summary', (_e, productId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT
          COUNT(*) as batch_count,
          SUM(quantity) as total_qty,
          MIN(expiry_date) as earliest_expiry,
          SUM(CASE WHEN expiry_date < date('now') THEN quantity ELSE 0 END) as expired_qty
        FROM product_batches
        WHERE product_id = ? AND quantity > 0
      `).get(productId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: String(err) } }
  })
}
