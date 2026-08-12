import { ipcMain } from 'electron'
import crypto from 'crypto'
import { getDb } from '../database'
import { enqueuSync } from '../services/syncQueue'
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
    opening_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    if (!perms.all && caller.branch_id && data.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot open a cash register for another branch' }
    }
    const db = getDb()
    const forceClosed = db.prepare(`SELECT id FROM cash_sessions WHERE branch_id=? AND status='open'`).all(data.branch_id) as { id: string }[]
    db.prepare(`UPDATE cash_sessions SET status='force_closed', closed_at=datetime('now') WHERE branch_id=? AND status='open'`).run(data.branch_id)
    for (const row of forceClosed) {
      const updated = db.prepare(`SELECT * FROM cash_sessions WHERE id=?`).get(row.id) as Record<string, unknown>
      await enqueuSync('cash_sessions', row.id, 'UPDATE', updated)
    }

    const id = crypto.randomUUID()
    // opened_by is always the AUTHENTICATED caller — a client-supplied
    // opened_by would let one cashier's session open a drawer under
    // another cashier's name.
    const openRow = {
      id, branch_id: data.branch_id, opened_by: caller.id || null, opening_cash: data.opening_cash,
      denominations: JSON.stringify(data.denominations), notes: data.notes ?? null, status: 'open',
    }
    db.prepare(`
      INSERT INTO cash_sessions (id, branch_id, opened_by, opening_cash, denominations, notes, status)
      VALUES (@id, @branch_id, @opened_by, @opening_cash, @denominations, @notes, @status)
    `).run(openRow)
    await enqueuSync('cash_sessions', id, 'INSERT', openRow)
    logAudit(db, { userId: (caller.id as string) || null, branchId: data.branch_id, action: 'CASH_REGISTER_OPENED', tableName: 'cash_sessions', recordId: id, newValues: { opening_cash: data.opening_cash } })
    return { success: true, data: id }
  })

  safeHandle(ipcMain, 'cash:close', async (_e, data: {
    session_id: string
    closing_cash: number
    denominations: Record<string, number>
    notes?: string
  }) => {
    const caller = authUser()
    const perms = currentPerms(caller)
    const db = getDb()
    const session = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(data.session_id) as Record<string, unknown> | undefined
    if (!session) return { success: false, error: 'Session not found' }
    if (!perms.all && caller.branch_id && session.branch_id !== caller.branch_id) {
      return { success: false, error: 'Cannot close a cash register from another branch' }
    }
    // Only the cashier who opened it, or a manager, may close it — otherwise
    // any cashier could close (and thus tamper with the reconciliation of)
    // a colleague's still-open drawer.
    if (!perms.all && !perms.employees && session.opened_by !== caller.id) {
      return { success: false, error: 'Only the cashier who opened this register (or a manager) can close it' }
    }

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
      caller.id || null, data.closing_cash,
      JSON.stringify(data.denominations), data.notes ?? null,
      sales.total, sales.count, difference, data.session_id
    )

    const updated = db.prepare('SELECT * FROM cash_sessions WHERE id=?').get(data.session_id) as Record<string, unknown>
    await enqueuSync('cash_sessions', data.session_id, 'UPDATE', updated)
    logAudit(db, {
      userId: (caller.id as string) || null, branchId: (session.branch_id as string) || null,
      action: 'CASH_REGISTER_CLOSED', tableName: 'cash_sessions', recordId: data.session_id,
      newValues: { closing_cash: data.closing_cash, difference },
    })

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
