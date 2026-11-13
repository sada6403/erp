// POS moderation of product reviews. Reviews are created in the cloud by customers (delivered orders only) and
// pulled into the local DB; the POS can only hide/unhide them (synced back, last write wins).
import type { IpcMain } from 'electron'
import { getDb } from '../database'
import { createCompanyStore } from '../services/companyWorkspace'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'

const store = createCompanyStore()
type Json = Record<string, unknown>

function requireAdmin(): Json {
  const caller = (store.get('auth_user') as Json | undefined) || {}
  const perms = ((caller.role as Json)?.permissions as Json) || (caller.permissions as Json) || {}
  if (!caller.id || !perms.all) throw new Error('Only Super Admin can moderate reviews')
  return caller
}

export function registerProductReviewHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'productReviews:list', (_e, f: Json = {}) => {
    requireAdmin()
    let sql = `SELECT r.id, r.product_id, p.name AS product_name, p.sku AS product_sku, r.customer_id,
        COALESCE(c.name, r.author_name) AS customer_name, r.author_name, r.rating, r.comment, r.is_hidden,
        r.hidden_by, r.hidden_at, r.hidden_reason, r.created_at
      FROM product_reviews r LEFT JOIN products p ON p.id = r.product_id LEFT JOIN customers c ON c.id = r.customer_id WHERE 1=1`
    const params: unknown[] = []
    if (f.state === 'visible') sql += ' AND r.is_hidden = 0'
    if (f.state === 'hidden') sql += ' AND r.is_hidden = 1'
    const q = String(f.search || '').trim()
    if (q) { sql += ' AND (p.name LIKE ? OR r.comment LIKE ? OR c.name LIKE ?)'; params.push(`%${q}%`, `%${q}%`, `%${q}%`) }
    sql += ' ORDER BY r.created_at DESC LIMIT 500'
    return { success: true, data: getDb().prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'productReviews:setHidden', async (_e, id: string, hidden: boolean, reason?: string) => {
    const caller = requireAdmin()
    const db = getDb()
    const row = db.prepare('SELECT * FROM product_reviews WHERE id = ?').get(String(id)) as Json | undefined
    if (!row) throw new Error('Review not found')
    const isHidden = hidden ? 1 : 0
    const why = hidden ? (String(reason ?? '').trim().slice(0, 255) || null) : null
    const by = hidden ? String(caller.name || caller.email || caller.id) : null
    const at = hidden ? new Date().toISOString().slice(0, 19).replace('T', ' ') : null
    db.prepare(`UPDATE product_reviews SET is_hidden=?, hidden_by=?, hidden_at=?, hidden_reason=?, updated_at=datetime('now') WHERE id=?`)
      .run(isHidden, by, at, why, String(id))
    const next = { ...row, is_hidden: isHidden, hidden_by: by, hidden_at: at, hidden_reason: why }
    delete (next as Json).synced_at
    await enqueuSync('product_reviews', String(id), 'UPDATE', next)
    logAudit(db, { userId: caller.id as string, branchId: (caller.branch_id as string) || null, action: hidden ? 'REVIEW_HIDDEN' : 'REVIEW_UNHIDDEN', tableName: 'product_reviews', recordId: String(id), newValues: { is_hidden: isHidden, reason: why } })
    return { success: true }
  })
}
