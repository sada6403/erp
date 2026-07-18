import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { createNotification } from './notifications'
import Store from 'electron-store'
import { safeHandle } from './ipcHandler'

const store = new Store()

const ALLOWED_TARGET_TABLES = new Set(['invoices', 'stocks', 'products'])
const APPROVAL_WINDOW_HOURS = 48

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function currentPerms(caller: Record<string, unknown> = authUser()): Record<string, unknown> {
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>)
    || {}
}

export function registerEditRequestHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'editRequests:create', async (_e, payload: {
    target_table: string
    target_record_id: string
    reason: string
    requested_changes: Record<string, unknown>
  }) => {
    {
      if (!ALLOWED_TARGET_TABLES.has(payload.target_table)) {
        return { success: false, error: 'Unsupported edit-request target' }
      }
      const reason = String(payload.reason || '').trim()
      if (!reason) return { success: false, error: 'A reason is required' }

      const db = getDb()
      const user = authUser()

      let branchId: string | null = null
      if (payload.target_table === 'invoices') {
        const invoice = db.prepare('SELECT status, branch_id FROM invoices WHERE id=?').get(payload.target_record_id) as
          { status?: string; branch_id?: string } | undefined
        if (!invoice) return { success: false, error: 'Invoice not found' }
        if (invoice.status !== 'completed') {
          return { success: false, error: 'Only completed invoices need an edit request — this one is still editable directly' }
        }
        branchId = invoice.branch_id || null
      } else if (payload.target_table === 'products') {
        if (payload.target_record_id !== 'new') {
          const productRow = db.prepare('SELECT id FROM products WHERE id=?').get(payload.target_record_id) as { id?: string } | undefined
          if (!productRow) return { success: false, error: 'Product not found' }
        }
        // Products aren't branch-scoped (and a 'new' product doesn't exist yet) —
        // record the requester's own branch for admin filtering/visibility.
        branchId = (user.branch_id as string) || null
      } else {
        // target_record_id for stocks is `${product_id}-${branch_id}`
        const row = db.prepare('SELECT id, branch_id FROM stocks WHERE (product_id || "-" || branch_id) = ?')
          .get(payload.target_record_id) as { id?: string; branch_id?: string } | undefined
        if (!row) return { success: false, error: 'Stock record not found' }
        branchId = row.branch_id || null
      }

      const existing = db.prepare(`
        SELECT id FROM edit_requests
        WHERE target_table=? AND target_record_id=? AND requested_by=?
          AND (status='pending' OR (status='approved' AND approved_expires_at > datetime('now')))
        LIMIT 1
      `).get(payload.target_table, payload.target_record_id, user.id) as { id: string } | undefined
      if (existing) return { success: false, error: 'You already have an open request for this record' }

      const id = crypto.randomUUID()
      const row = {
        id,
        target_table: payload.target_table,
        target_record_id: payload.target_record_id,
        branch_id: branchId,
        requested_by: (user.id as string) || null,
        reason,
        requested_changes: JSON.stringify(payload.requested_changes || {}),
        status: 'pending',
      }
      db.prepare(`
        INSERT INTO edit_requests
          (id, target_table, target_record_id, branch_id, requested_by, reason, requested_changes, status)
        VALUES (@id,@target_table,@target_record_id,@branch_id,@requested_by,@reason,@requested_changes,@status)
      `).run(row)
      await enqueuSync('edit_requests', id, 'INSERT', row)

      const targetLabel = payload.target_table === 'invoices' ? 'completed invoice'
        : payload.target_table === 'products' ? (payload.target_record_id === 'new' ? 'new product' : 'product')
        : 'stock record'
      createNotification(
        'info',
        'Edit request submitted',
        `${String(user.name || 'A user')} requested to edit a ${targetLabel}.`,
        { event: 'edit_request_submitted', edit_request_id: id, target_table: payload.target_table }
      )

      return { success: true, data: { id } }
    }
  })

  safeHandle(ipcMain, 'editRequests:list', (_e, filters: { status?: string; branch_id?: string } = {}) => {
    {
      if (!currentPerms().all) return { success: false, error: 'Company Admin access required' }

      const db = getDb()
      const conditions: string[] = []
      const params: unknown[] = []
      const status = filters.status || 'pending'
      if (status !== 'all') { conditions.push('er.status = ?'); params.push(status) }
      if (filters.branch_id) { conditions.push('er.branch_id = ?'); params.push(filters.branch_id) }
      const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

      const rows = db.prepare(`
        SELECT er.*, u.name as requester_name, b.name as branch_name,
          rv.name as reviewer_name
        FROM edit_requests er
        LEFT JOIN users u ON u.id = er.requested_by
        LEFT JOIN branches b ON b.id = er.branch_id
        LEFT JOIN users rv ON rv.id = er.reviewed_by
        ${where}
        ORDER BY er.created_at DESC
        LIMIT 200
      `).all(...params)
      return { success: true, data: rows }
    }
  })

  safeHandle(ipcMain, 'editRequests:review', async (_e, id: string, action: 'approve' | 'reject', notes?: string) => {
    {
      if (!currentPerms().all) return { success: false, error: 'Company Admin access required' }

      const db = getDb()
      const user = authUser()
      const request = db.prepare('SELECT * FROM edit_requests WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!request) return { success: false, error: 'Edit request not found' }
      if (request.status !== 'pending') return { success: false, error: 'This request has already been reviewed' }

      if (action === 'reject') {
        db.prepare(`
          UPDATE edit_requests
          SET status='rejected', reviewed_by=?, reviewed_at=datetime('now'), review_notes=?, updated_at=datetime('now')
          WHERE id=?
        `).run(user.id || null, notes || null, id)
      } else {
        db.prepare(`
          UPDATE edit_requests
          SET status='approved', reviewed_by=?, reviewed_at=datetime('now'), review_notes=?,
              approved_expires_at=datetime('now', '+${APPROVAL_WINDOW_HOURS} hours'), updated_at=datetime('now')
          WHERE id=?
        `).run(user.id || null, notes || null, id)
      }

      logAudit(db, {
        userId: (user.id as string) || null, branchId: (request.branch_id as string) || null,
        action: action === 'approve' ? 'EDIT_REQUEST_APPROVED' : 'EDIT_REQUEST_REJECTED',
        tableName: 'edit_requests', recordId: id, newValues: { notes },
      })

      const updated = db.prepare('SELECT * FROM edit_requests WHERE id=?').get(id) as Record<string, unknown>
      await enqueuSync('edit_requests', id, 'UPDATE', updated)

      createNotification(
        'info',
        action === 'approve' ? 'Edit request approved' : 'Edit request rejected',
        action === 'approve'
          ? `Your edit request is approved — you have ${APPROVAL_WINDOW_HOURS}h to make the change.`
          : `Your edit request was rejected.${notes ? ` Reason: ${notes}` : ''}`,
        { event: 'edit_request_reviewed', edit_request_id: id, status: updated.status }
      )

      return { success: true }
    }
  })

  safeHandle(ipcMain, 'editRequests:checkUnlocked', (_e, targetTable: string, targetRecordId: string) => {
    {
      const db = getDb()
      const user = authUser()

      const approved = db.prepare(`
        SELECT id, approved_expires_at FROM edit_requests
        WHERE target_table=? AND target_record_id=? AND requested_by=?
          AND status='approved' AND approved_expires_at > datetime('now')
        ORDER BY reviewed_at DESC LIMIT 1
      `).get(targetTable, targetRecordId, user.id) as { id: string; approved_expires_at: string } | undefined

      if (approved) {
        return { success: true, data: { unlocked: true, pending: false, request_id: approved.id, expires_at: approved.approved_expires_at } }
      }

      const pending = db.prepare(`
        SELECT id FROM edit_requests
        WHERE target_table=? AND target_record_id=? AND requested_by=? AND status='pending'
        LIMIT 1
      `).get(targetTable, targetRecordId, user.id) as { id: string } | undefined

      return { success: true, data: { unlocked: false, pending: Boolean(pending), request_id: pending?.id ?? null, expires_at: null } }
    }
  })
}
