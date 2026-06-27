import { ipcMain, dialog } from 'electron'
import crypto from 'crypto'
import fs from 'fs'
import { getDb } from '../database'

export function registerStockCountHandlers() {

  ipcMain.handle('stockCounts:list', () => {
    const db = getDb()
    try {
      return {
        success: true,
        data: db.prepare(`
          SELECT scs.*,
            b.name AS branch_name,
            w.name AS warehouse_name,
            COUNT(sci.id) AS item_count,
            SUM(CASE WHEN sci.counted_qty IS NOT NULL AND sci.counted_qty != sci.system_qty THEN 1 ELSE 0 END) AS variance_count
          FROM stock_count_sessions scs
          LEFT JOIN branches   b ON b.id = scs.branch_id
          LEFT JOIN warehouses w ON w.id = scs.warehouse_id
          LEFT JOIN stock_count_items sci ON sci.session_id = scs.id
          GROUP BY scs.id
          ORDER BY scs.created_at DESC
          LIMIT 100
        `).all()
      }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:create', (_e, payload: { notes?: string; branch_id?: string; user_id?: string } = {}) => {
    const db = getDb()
    try {
      const id = crypto.randomUUID()

      // Use provided branch_id or fall back to first branch
      let branchId = payload?.branch_id ?? null
      if (!branchId) {
        const branch = db.prepare('SELECT id FROM branches ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined
        branchId = branch?.id ?? null
      }

      const warehouse = db.prepare('SELECT id FROM warehouses WHERE branch_id = ? LIMIT 1').get(branchId) as { id: string } | undefined
      const warehouseId = warehouse?.id ?? null

      db.prepare(`
        INSERT INTO stock_count_sessions (id, branch_id, warehouse_id, notes, status, created_by)
        VALUES (?, ?, ?, ?, 'in_progress', ?)
      `).run(id, branchId, warehouseId, payload?.notes ?? null, payload?.user_id ?? null)

      // Populate items from current stock for this branch
      type StockRow = { product_id: string; system_qty: number; unit: string | null }
      let stocks: StockRow[] = branchId
        ? db.prepare(`
            SELECT s.product_id, COALESCE(s.quantity, 0) AS system_qty, p.unit
            FROM stocks s
            JOIN products p ON p.id = s.product_id
            WHERE s.branch_id = ?
            ORDER BY p.name
          `).all(branchId) as StockRow[]
        : []

      // Fall back to all products if no branch-specific stock found
      if (!stocks.length) {
        stocks = db.prepare(`
          SELECT s.product_id,
            MAX(COALESCE(s.quantity, 0)) AS system_qty,
            p.unit
          FROM stocks s
          JOIN products p ON p.id = s.product_id
          GROUP BY s.product_id
          ORDER BY p.name
        `).all() as StockRow[]
      }

      const insertItem = db.prepare(`
        INSERT INTO stock_count_items (id, session_id, product_id, system_qty, unit)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const s of stocks) {
        insertItem.run(crypto.randomUUID(), id, s.product_id, s.system_qty, s.unit)
      }

      return { success: true, data: { id, item_count: stocks.length } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:get', (_e, id: string) => {
    const db = getDb()
    try {
      const session = db.prepare(`
        SELECT scs.*, b.name AS branch_name, w.name AS warehouse_name
        FROM stock_count_sessions scs
        LEFT JOIN branches   b ON b.id = scs.branch_id
        LEFT JOIN warehouses w ON w.id = scs.warehouse_id
        WHERE scs.id = ?
      `).get(id)

      const items = db.prepare(`
        SELECT sci.*,
          p.name AS product_name, p.sku,
          CASE WHEN sci.counted_qty IS NOT NULL
            THEN (sci.counted_qty - sci.system_qty)
            ELSE NULL END AS variance
        FROM stock_count_items sci
        JOIN products p ON p.id = sci.product_id
        WHERE sci.session_id = ?
        ORDER BY p.name
      `).all(id)

      return { success: true, data: { ...(session as object), items } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:updateItem', (_e, sessionId: string, itemId: string, countedQty: number) => {
    const db = getDb()
    try {
      db.prepare(`
        UPDATE stock_count_items
        SET counted_qty = ?, updated_at = datetime('now')
        WHERE id = ? AND session_id = ?
      `).run(countedQty, itemId, sessionId)

      db.prepare(`
        UPDATE stock_count_sessions
        SET status = 'in_progress', updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'
      `).run(sessionId)

      return { success: true }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:finalize', (_e, id: string) => {
    const db = getDb()
    try {
      const session = db.prepare('SELECT * FROM stock_count_sessions WHERE id = ?').get(id) as Record<string, unknown>
      if (!session) return { success: false, error: 'Session not found' }

      type ItemRow = { product_id: string; counted_qty: number }
      const items = db.prepare(`
        SELECT product_id, counted_qty FROM stock_count_items
        WHERE session_id = ? AND counted_qty IS NOT NULL
      `).all(id) as ItemRow[]

      for (const item of items) {
        if (session.branch_id) {
          db.prepare(`
            UPDATE stocks SET quantity = ?, updated_at = datetime('now')
            WHERE product_id = ? AND branch_id = ?
          `).run(item.counted_qty, item.product_id, session.branch_id)
        } else {
          db.prepare(`
            UPDATE stocks SET quantity = ?, updated_at = datetime('now')
            WHERE product_id = ?
          `).run(item.counted_qty, item.product_id)
        }
      }

      db.prepare(`
        UPDATE stock_count_sessions
        SET status = 'completed', finalized_at = datetime('now'), updated_at = datetime('now')
        WHERE id = ?
      `).run(id)

      return { success: true, data: { adjusted: items.length } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:cancel', (_e, id: string) => {
    const db = getDb()
    try {
      db.prepare(`
        UPDATE stock_count_sessions
        SET status = 'cancelled', updated_at = datetime('now')
        WHERE id = ?
      `).run(id)
      return { success: true }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:exportCsv', async (_e, sessionId: string) => {
    try {
      const db = getDb()
      const { canceled, filePath } = await dialog.showSaveDialog({
        title: 'Export Stock Count CSV',
        defaultPath: `stock-count-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
      })
      if (canceled || !filePath) return { success: false, error: 'Cancelled' }

      type Row = Record<string, unknown>
      const items = db.prepare(`
        SELECT p.name AS product_name, p.sku, sci.unit,
          sci.system_qty, sci.counted_qty,
          CASE WHEN sci.counted_qty IS NOT NULL
            THEN (sci.counted_qty - sci.system_qty)
            ELSE '' END AS variance
        FROM stock_count_items sci
        JOIN products p ON p.id = sci.product_id
        WHERE sci.session_id = ?
        ORDER BY p.name
      `).all(sessionId) as Row[]

      const header = 'Product Name,SKU,Unit,System Qty,Counted Qty,Variance\n'
      const rows = items.map(i =>
        `"${String(i.product_name ?? '').replace(/"/g, '""')}","${i.sku ?? ''}","${i.unit ?? ''}",${i.system_qty ?? 0},${i.counted_qty ?? ''},${i.variance ?? ''}`
      ).join('\n')

      fs.writeFileSync(filePath, header + rows, 'utf-8')
      return { success: true, data: { exported: items.length } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('stockCounts:importCsv', async (_e, sessionId: string) => {
    try {
      const db = getDb()
      const { canceled, filePaths } = await dialog.showOpenDialog({
        title: 'Import Counted Quantities (CSV)',
        filters: [{ name: 'CSV Files', extensions: ['csv'] }],
        properties: ['openFile']
      })
      if (canceled || !filePaths.length) return { success: false, error: 'Cancelled' }

      const content = fs.readFileSync(filePaths[0], 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      const dataLines = lines.slice(1)  // skip header

      let imported = 0
      for (const line of dataLines) {
        // Parse CSV cells (handles quoted fields)
        const cells = line.match(/("(?:[^"]|"")*"|[^,]*)/g) ?? []
        const sku        = cells[1]?.replace(/^"|"$/g, '').trim()
        const countedQty = parseFloat(cells[4]?.trim() ?? '')
        if (!sku || isNaN(countedQty) || countedQty < 0) continue

        const item = db.prepare(`
          SELECT sci.id FROM stock_count_items sci
          JOIN products p ON p.id = sci.product_id
          WHERE sci.session_id = ? AND p.sku = ?
        `).get(sessionId, sku) as { id: string } | undefined

        if (item) {
          db.prepare(`
            UPDATE stock_count_items SET counted_qty = ?, updated_at = datetime('now')
            WHERE id = ?
          `).run(countedQty, item.id)
          imported++
        }
      }

      db.prepare(`
        UPDATE stock_count_sessions
        SET status = 'in_progress', updated_at = datetime('now')
        WHERE id = ? AND status = 'draft'
      `).run(sessionId)

      return { success: true, data: { imported } }
    } catch (e) { return { success: false, error: String(e) } }
  })
}
