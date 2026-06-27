import { ipcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'

export function registerCashRegisterHandlers() {
  ipcMain.handle('cash:getOpen', (_e, branchId: string) => {
    const db = getDb()
    try {
      const session = db.prepare(`
        SELECT cs.*, u.name AS opened_by_name
        FROM cash_sessions cs
        LEFT JOIN users u ON u.id = cs.opened_by
        WHERE cs.branch_id = ? AND cs.status = 'open'
        ORDER BY cs.opened_at DESC LIMIT 1
      `).get(branchId)
      return { success: true, data: session }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('cash:open', (_e, data: {
    branch_id: string
    opened_by: string
    opening_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const db = getDb()
    try {
      db.prepare(`UPDATE cash_sessions SET status='force_closed', closed_at=datetime('now') WHERE branch_id=? AND status='open'`).run(data.branch_id)
      const id = crypto.randomUUID()
      db.prepare(`
        INSERT INTO cash_sessions (id, branch_id, opened_by, opening_cash, denominations, notes, status)
        VALUES (?, ?, ?, ?, ?, ?, 'open')
      `).run(id, data.branch_id, data.opened_by, data.opening_cash, JSON.stringify(data.denominations), data.notes ?? null)
      return { success: true, data: id }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('cash:close', (_e, data: {
    session_id: string
    closed_by: string
    closing_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const db = getDb()
    try {
      const session = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(data.session_id) as Record<string, unknown> | undefined
      if (!session) return { success: false, error: 'Session not found' }

      const sales = db.prepare(`
        SELECT COALESCE(SUM(total_amount),0) AS total, COUNT(*) AS count
        FROM invoices
        WHERE branch_id=? AND created_at >= ? AND bill_type='RETAIL' AND status='paid'
      `).get(session.branch_id, session.opened_at) as { total: number; count: number }

      const difference = data.closing_cash - (Number(session.opening_cash) + sales.total)

      db.prepare(`
        UPDATE cash_sessions SET
          status='closed', closed_at=datetime('now'), closed_by=?,
          closing_cash=?, closing_denominations=?, closing_notes=?,
          sales_total=?, sales_count=?, difference=?
        WHERE id=?
      `).run(
        data.closed_by, data.closing_cash,
        JSON.stringify(data.denominations), data.notes ?? null,
        sales.total, sales.count, difference, data.session_id
      )

      return { success: true, data: { ...session, closing_cash: data.closing_cash, sales, difference } }
    } catch (e) { return { success: false, error: String(e) } }
  })

  ipcMain.handle('cash:history', (_e, branchId: string) => {
    const db = getDb()
    try {
      return {
        success: true,
        data: db.prepare(`
          SELECT cs.*, u1.name AS opened_by_name, u2.name AS closed_by_name
          FROM cash_sessions cs
          LEFT JOIN users u1 ON u1.id = cs.opened_by
          LEFT JOIN users u2 ON u2.id = cs.closed_by
          WHERE cs.branch_id = ?
          ORDER BY cs.opened_at DESC LIMIT 60
        `).all(branchId)
      }
    } catch (e) { return { success: false, error: String(e) } }
  })
}
