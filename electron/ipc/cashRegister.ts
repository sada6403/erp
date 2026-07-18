import { ipcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { enqueuSync } from '../services/syncQueue'
import { safeHandle } from './ipcHandler'

export function registerCashRegisterHandlers() {
  safeHandle(ipcMain, 'cash:getOpen', (_e, branchId: string) => {
    const db = getDb()
    const session = db.prepare(`
      SELECT cs.*, u.name AS opened_by_name
      FROM cash_sessions cs
      LEFT JOIN users u ON u.id = cs.opened_by
      WHERE cs.branch_id = ? AND cs.status = 'open'
      ORDER BY cs.opened_at DESC LIMIT 1
    `).get(branchId)
    return { success: true, data: session }
  })

  safeHandle(ipcMain, 'cash:open', async (_e, data: {
    branch_id: string
    opened_by: string
    opening_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const db = getDb()
    const forceClosed = db.prepare(`SELECT id FROM cash_sessions WHERE branch_id=? AND status='open'`).all(data.branch_id) as { id: string }[]
    db.prepare(`UPDATE cash_sessions SET status='force_closed', closed_at=datetime('now') WHERE branch_id=? AND status='open'`).run(data.branch_id)
    for (const row of forceClosed) {
      const updated = db.prepare(`SELECT * FROM cash_sessions WHERE id=?`).get(row.id) as Record<string, unknown>
      await enqueuSync('cash_sessions', row.id, 'UPDATE', updated)
    }

    const id = crypto.randomUUID()
    const openRow = {
      id, branch_id: data.branch_id, opened_by: data.opened_by, opening_cash: data.opening_cash,
      denominations: JSON.stringify(data.denominations), notes: data.notes ?? null, status: 'open',
    }
    db.prepare(`
      INSERT INTO cash_sessions (id, branch_id, opened_by, opening_cash, denominations, notes, status)
      VALUES (@id, @branch_id, @opened_by, @opening_cash, @denominations, @notes, @status)
    `).run(openRow)
    await enqueuSync('cash_sessions', id, 'INSERT', openRow)
    return { success: true, data: id }
  })

  safeHandle(ipcMain, 'cash:close', async (_e, data: {
    session_id: string
    closed_by: string
    closing_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const db = getDb()
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

    const updated = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(data.session_id) as Record<string, unknown>
    await enqueuSync('cash_sessions', data.session_id, 'UPDATE', updated)

    return { success: true, data: { ...session, closing_cash: data.closing_cash, sales, difference } }
  })

  safeHandle(ipcMain, 'cash:history', (_e, branchId: string) => {
    const db = getDb()
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
  })
}
