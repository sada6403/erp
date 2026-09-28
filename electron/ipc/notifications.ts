import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'
import Store from 'electron-store'
import { safeHandle } from './ipcHandler'

const store = new Store()

export type NotifType =
  | 'low_stock' | 'installment_due' | 'installment_overdue'
  | 'sync_failed' | 'license_expiry' | 'subscription_grace'
  | 'subscription_expired' | 'transfer_request' | 'info'
  | 'chit_collaboration_invite' | 'chit_payment_due' | 'chit_scheme_closing'
  | 'agent_registered' | 'agent_approved' | 'scheme_created' | 'scheme_status_update'
  | 'commission_pending_manager' | 'commission_pending_admin'
  | 'commission_approved' | 'commission_paid' | 'commission_rejected'
  | 'commission_large_payout' | 'branch_performance_alert'
  | 'chit_claim_delayed'

export interface Notification {
  id: string
  type: NotifType
  title: string
  message: string
  is_read: number
  data: string | null
  created_at: string
}

// Targeting is entirely optional and additive — omit all three for today's
// broadcast behavior (visible to everyone), same as every pre-existing call
// site. Only the new SmartBuy events pass a target.
export interface NotificationTarget {
  userId?: string | null
  roleScope?: string | null
  branchId?: string | null
  requiredPermission?: string | null
}

const INVENTORY_NOTIFICATION_TYPES = new Set<NotifType>(['low_stock', 'transfer_request'])

function defaultPermission(type: NotifType): string {
  if (INVENTORY_NOTIFICATION_TYPES.has(type)) return 'inventory'
  if (type === 'installment_due' || type === 'installment_overdue') return 'customers'
  if (type === 'sync_failed') return 'branches'
  if (type === 'license_expiry' || type === 'subscription_grace' || type === 'subscription_expired') return 'settings'
  if (
    type.startsWith('chit_') || type.startsWith('commission_') ||
    type === 'agent_registered' || type === 'agent_approved' ||
    type === 'scheme_created' || type === 'scheme_status_update' ||
    type === 'branch_performance_alert'
  ) return 'chits'
  return 'all'
}

export function createNotification(
  type: NotifType, title: string, message: string,
  data?: Record<string, unknown>, target?: NotificationTarget
) {
  try {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO notifications
        (id, type, title, message, data, user_id, role_scope, target_branch_id, required_permission, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(
      randomUUID(), type, title, message, data ? JSON.stringify(data) : null,
      target?.userId || null, target?.roleScope || null, target?.branchId || null,
      target?.requiredPermission || defaultPermission(type)
    )
  } catch { /* db not ready */ }
}

function authUser(): Record<string, unknown> {
  return (store.get('auth_user') as Record<string, unknown> | undefined) || {}
}

function authPermissions(caller: Record<string, unknown> = authUser()): Record<string, boolean> {
  try {
    const role = caller.role as Record<string, unknown> | undefined
    const raw = role?.permissions ?? caller.permissions ?? {}
    return typeof raw === 'string' ? JSON.parse(raw) as Record<string, boolean> : raw as Record<string, boolean>
  } catch {
    return {}
  }
}

const LEGACY_PERMISSION_SQL = `CASE
  WHEN type IN ('low_stock','transfer_request') THEN 'inventory'
  WHEN type IN ('installment_due','installment_overdue') THEN 'customers'
  WHEN type = 'sync_failed' THEN 'branches'
  WHEN type IN ('license_expiry','subscription_grace','subscription_expired') THEN 'settings'
  WHEN type LIKE 'chit_%' OR type LIKE 'commission_%'
    OR type IN ('agent_registered','agent_approved','scheme_created','scheme_status_update','branch_performance_alert') THEN 'chits'
  ELSE 'all'
END`

// Transfers belong to the physical device's assigned branch. In particular,
// a Company Admin account may itself be attached to HQ while signed in on a
// Mannar terminal. Using only auth_user.branch_id made that terminal scan HQ
// transfers and silently miss every transfer addressed to Mannar.
function notificationBranchId(caller: Record<string, unknown> = authUser()): string | null {
  const scope = caller.scope as { branchId?: string | null } | undefined
  const nestedBranch = caller.branch as { id?: string } | undefined
  return String(
    store.get('device_branch_id')
    || scope?.branchId
    || caller.branch_id
    || nestedBranch?.id
    || ''
  ) || null
}

// Broadcast rows (no targeting at all) are visible to everyone, same as
// before targeting existed. A targeted row is visible to its exact user, or
// to every session matching its role_scope (optionally narrowed to one
// branch). Super Admin ('owner') always sees everything, targeted or not —
// matches "Super Admin can view all branch commissions" etc. elsewhere.
function notificationVisibilityWhere(): { where: string; params: unknown[] } {
  const caller = authUser()
  const scope = caller.scope as { level?: string; branchId?: string | null } | undefined
  const permissions = authPermissions(caller)
  if (scope?.level === 'owner' || permissions.all) return { where: '', params: [] }
  const userId = caller.id as string | undefined
  const roleLevel = scope?.level
  const branchId = notificationBranchId(caller)

  const conditions: string[] = []
  const params: unknown[] = []
  if (userId) { conditions.push('user_id = ?'); params.push(userId) }

  const audience: string[] = ['(role_scope IS NULL AND target_branch_id IS NULL)']
  if (branchId) {
    audience.push('(role_scope IS NULL AND target_branch_id = ?)')
    params.push(branchId)
  }
  if (roleLevel) {
    audience.push('(role_scope = ? AND (target_branch_id IS NULL OR target_branch_id = ?))')
    params.push(roleLevel, branchId)
  }

  const granted = Object.entries(permissions).filter(([, enabled]) => Boolean(enabled)).map(([name]) => name)
  if (granted.length) {
    const placeholders = granted.map(() => '?').join(',')
    const stockBranchSql = branchId
      ? `(type NOT IN ('low_stock','transfer_request') OR target_branch_id = ?)`
      : `type NOT IN ('low_stock','transfer_request')`
    conditions.push(`(
      user_id IS NULL
      AND (${audience.join(' OR ')})
      AND COALESCE(required_permission, ${LEGACY_PERMISSION_SQL}) IN (${placeholders})
      AND ${stockBranchSql}
    )`)
    params.push(...granted)
    if (branchId) params.push(branchId)
  }
  if (!conditions.length) return { where: 'WHERE 0', params: [] }
  return { where: `WHERE ${conditions.join(' OR ')}`, params }
}

function createUniqueTransferNotification(
  event: string,
  transferId: string,
  title: string,
  message: string,
  data: Record<string, unknown>,
  targetBranchId?: string | null,
) {
  try {
    const db = getDb()
    const existing = db.prepare(`
      SELECT id FROM notifications
      WHERE type='transfer_request'
        AND data LIKE ?
        AND data LIKE ?
      LIMIT 1
    `).get(`%"transfer_id":"${transferId}"%`, `%"event":"${event}"%`)
    if (!existing) {
      createNotification(
        'transfer_request', title, message,
        { ...data, event, transfer_id: transferId },
        { branchId: targetBranchId || null, requiredPermission: 'inventory' },
      )
    }
  } catch { /* db not ready */ }
}

export function registerNotificationHandlers() {
  ipcMain.handle('notifications:getAll', () => {
    try {
      const db = getDb()
      const { where, params } = notificationVisibilityWhere()
      return db.prepare(`
        SELECT * FROM notifications ${where} ORDER BY created_at DESC LIMIT 100
      `).all(...params)
    } catch { return [] }
  })

  ipcMain.handle('notifications:getUnreadCount', () => {
    try {
      const db = getDb()
      const { where, params } = notificationVisibilityWhere()
      const visible = where ? where.replace(/^WHERE\s+/i, '') : '1=1'
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE (${visible}) AND is_read = 0`).get(...params) as { cnt: number }
      return row.cnt
    } catch { return 0 }
  })

  safeHandle(ipcMain, 'notifications:markRead', (_e, id: string) => {
    const db = getDb()
    if (id === 'all') {
      // Scoped to what this caller can actually see — otherwise "mark all
      // read" would silently mark other users' targeted notifications read.
      const { where, params } = notificationVisibilityWhere()
      db.prepare(`UPDATE notifications SET is_read = 1 ${where}`).run(...params)
    } else {
      const { where, params } = notificationVisibilityWhere()
      const visible = where ? where.replace(/^WHERE\s+/i, '') : '1=1'
      db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ? AND (${visible})`).run(id, ...params)
    }
    return { success: true }
  })

  safeHandle(ipcMain, 'notifications:delete', (_e, id: string) => {
    const db = getDb()
    const { where, params } = notificationVisibilityWhere()
    const visible = where ? where.replace(/^WHERE\s+/i, '') : '1=1'
    db.prepare(`DELETE FROM notifications WHERE id = ? AND (${visible})`).run(id, ...params)
    return { success: true }
  })

  safeHandle(ipcMain, 'notifications:clearAll', () => {
    const db = getDb()
    const { where, params } = notificationVisibilityWhere()
    const visible = where ? where.replace(/^WHERE\s+/i, '') : '1=1'
    db.prepare(`DELETE FROM notifications WHERE is_read = 1 AND (${visible})`).run(...params)
    return { success: true }
  })

  // Generate notifications based on current app state
  safeHandle(ipcMain, 'notifications:refresh', () => {
      const db = getDb()
      const caller = authUser()
      const permissions = authPermissions(caller)
      const branchId = notificationBranchId(caller) || ''
      const canInventory = Boolean(permissions.all || permissions.inventory)
      const canCustomers = Boolean(permissions.all || permissions.customers)

      // Keep the refresh light: branch inventory users calculate only their
      // own branch. Company Admin reads the alerts produced by branch sessions.
      if (canInventory && branchId) {
        const lowStockItems = db.prepare(`
          SELECT p.name,
                 COALESCE(SUM(COALESCE(s.quantity, 0) - COALESCE(s.damaged_qty, 0)), 0) AS quantity,
                 COALESCE(p.min_stock_level, 5) AS min_stock_level
          FROM products p
          LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
          WHERE p.is_active = 1 AND (p.branch_id = ? OR p.branch_id IS NULL)
          GROUP BY p.id, p.name, p.min_stock_level
          HAVING quantity <= COALESCE(p.min_stock_level, 5) AND quantity >= 0
          ORDER BY quantity ASC, p.name
          LIMIT 20
        `).all(branchId, branchId) as { name: string; quantity: number; min_stock_level: number }[]

        if (lowStockItems.length > 0) {
          const names = lowStockItems.slice(0, 3).map(i => i.name).join(', ')
          const more = lowStockItems.length > 3 ? ` and ${lowStockItems.length - 3} more` : ''
          const recent = db.prepare(`
            SELECT id FROM notifications WHERE type='low_stock' AND title='Low Stock Alert'
            AND target_branch_id = ?
            AND created_at > datetime('now', '-1 hour') LIMIT 1
          `).get(branchId)
          if (!recent) {
            createNotification('low_stock', 'Low Stock Alert',
              `${lowStockItems.length} item${lowStockItems.length > 1 ? 's' : ''} need restocking: ${names}${more}`,
              { count: lowStockItems.length, branchId },
              { branchId, requiredPermission: 'inventory' }
            )
          }
        }
      }

      if (canCustomers) {
        const branchClause = branchId ? 'AND branch_id = ?' : ''
        const branchParams = branchId ? [branchId] : []
        const overdueCount = db.prepare(`
          SELECT COUNT(*) as cnt FROM installments
          WHERE status = 'active' AND next_due_date < date('now') AND due_amount > paid_amount
          ${branchClause}
        `).get(...branchParams) as { cnt: number }

        if (overdueCount.cnt > 0) {
          const recent = db.prepare(`
            SELECT id FROM notifications WHERE type='installment_overdue'
            AND target_branch_id IS ?
            AND created_at > datetime('now', '-6 hours') LIMIT 1
          `).get(branchId || null)
          if (!recent) {
            createNotification('installment_overdue', 'Overdue Installments',
              `${overdueCount.cnt} installment${overdueCount.cnt > 1 ? 's are' : ' is'} overdue and require attention.`,
              { count: overdueCount.cnt, branchId: branchId || null },
              { branchId: branchId || null, requiredPermission: 'customers' }
            )
          }
        }

        const dueTodayCount = db.prepare(`
          SELECT COUNT(*) as cnt FROM installments
          WHERE status = 'active' AND next_due_date = date('now') AND due_amount > paid_amount
          ${branchClause}
        `).get(...branchParams) as { cnt: number }

        if (dueTodayCount.cnt > 0) {
          const recent = db.prepare(`
            SELECT id FROM notifications WHERE type='installment_due'
            AND target_branch_id IS ?
            AND created_at > datetime('now', '-6 hours') LIMIT 1
          `).get(branchId || null)
          if (!recent) {
            createNotification('installment_due', 'Installments Due Today',
              `${dueTodayCount.cnt} installment payment${dueTodayCount.cnt > 1 ? 's are' : ' is'} due today.`,
              { count: dueTodayCount.cnt, branchId: branchId || null },
              { branchId: branchId || null, requiredPermission: 'customers' }
            )
          }
        }
      }

      if (canInventory) {
        try {
          const batchBranchClause = branchId ? 'AND branch_id = ?' : ''
          const batchParams = branchId ? [branchId] : []
          const expiringBatches = db.prepare(`
            SELECT COUNT(*) as cnt FROM product_batches
            WHERE expiry_date IS NOT NULL AND quantity > 0
              AND expiry_date <= date('now', '+30 days') AND expiry_date >= date('now')
              ${batchBranchClause}
          `).get(...batchParams) as { cnt: number }
          if (expiringBatches.cnt > 0) {
            const recent = db.prepare(`SELECT id FROM notifications WHERE title='Batches Expiring Soon' AND target_branch_id IS ? AND created_at > datetime('now', '-6 hours') LIMIT 1`).get(branchId || null)
            if (!recent) createNotification('low_stock', 'Batches Expiring Soon', `${expiringBatches.cnt} batch${expiringBatches.cnt > 1 ? 'es' : ''} will expire within 30 days. Review your inventory.`, { count: expiringBatches.cnt, branchId: branchId || null }, { branchId: branchId || null, requiredPermission: 'inventory' })
          }
          const expiredBatches = db.prepare(`SELECT COUNT(*) as cnt FROM product_batches WHERE expiry_date IS NOT NULL AND quantity > 0 AND expiry_date < date('now') ${batchBranchClause}`).get(...batchParams) as { cnt: number }
          if (expiredBatches.cnt > 0) {
            const recent = db.prepare(`SELECT id FROM notifications WHERE title='Expired Stock Alert' AND target_branch_id IS ? AND created_at > datetime('now', '-6 hours') LIMIT 1`).get(branchId || null)
            if (!recent) createNotification('low_stock', 'Expired Stock Alert', `${expiredBatches.cnt} batch${expiredBatches.cnt > 1 ? 'es' : ''} have expired but still have stock. Remove from sale immediately.`, { count: expiredBatches.cnt, branchId: branchId || null }, { branchId: branchId || null, requiredPermission: 'inventory' })
          }
        } catch { /* product_batches table may not exist on first run */ }
      }

      // Inter-branch transfer notifications. These are generated from synced
      // stock_transfers so every branch sees the correct request/status after
      // background sync pulls the row down.
      if (canInventory && branchId) {
        const incoming = db.prepare(`
          SELECT st.id, st.transfer_number, st.quantity, st.status,
                 p.name AS product_name, fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM stock_transfers st
          LEFT JOIN products p ON p.id = st.product_id
          LEFT JOIN branches fb ON fb.id = st.from_branch_id
          LEFT JOIN branches tb ON tb.id = st.to_branch_id
          WHERE st.from_branch_id = ?
            AND st.status = 'pending_approval'
          ORDER BY st.initiated_at DESC
          LIMIT 20
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of incoming) {
          createUniqueTransferNotification(
            'incoming_request',
            String(tf.id),
            'New stock request',
            `${tf.to_branch_name || 'A branch'} requested ${Number(tf.quantity)} x ${tf.product_name || 'product'}.`,
            tf,
            branchId,
          )
        }

        const updates = db.prepare(`
          SELECT st.id, st.transfer_number, st.quantity, st.status,
                 p.name AS product_name, fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM stock_transfers st
          LEFT JOIN products p ON p.id = st.product_id
          LEFT JOIN branches fb ON fb.id = st.from_branch_id
          LEFT JOIN branches tb ON tb.id = st.to_branch_id
          WHERE st.to_branch_id = ?
            AND st.status IN ('approved','rejected','dispatched','in_transit','received','partially_received','discrepancy','cancelled')
          ORDER BY st.updated_at DESC
          LIMIT 30
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of updates) {
          const status = String(tf.status).replace(/_/g, ' ')
          createUniqueTransferNotification(
            `status_${tf.status}`,
            String(tf.id),
            `Stock request ${status}`,
            `${tf.from_branch_name || 'Source branch'} marked ${Number(tf.quantity)} x ${tf.product_name || 'product'} as ${status}.`,
            tf,
            branchId,
          )
        }

        const sourceUpdates = db.prepare(`
          SELECT st.id, st.transfer_number, st.quantity, st.status,
                 p.name AS product_name, fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM stock_transfers st
          LEFT JOIN products p ON p.id = st.product_id
          LEFT JOIN branches fb ON fb.id = st.from_branch_id
          LEFT JOIN branches tb ON tb.id = st.to_branch_id
          WHERE st.from_branch_id = ?
            AND st.status IN ('received','partially_received','discrepancy','cancelled')
          ORDER BY st.updated_at DESC
          LIMIT 30
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of sourceUpdates) {
          const status = String(tf.status).replace(/_/g, ' ')
          createUniqueTransferNotification(
            `source_status_${tf.status}`,
            String(tf.id),
            `Transfer ${status}`,
            `${tf.to_branch_name || 'Destination branch'} confirmed ${Number(tf.quantity)} x ${tf.product_name || 'product'} as ${status}.`,
            tf,
            branchId,
          )
        }
        
        // Multi-item branch transfers notifications
        const incomingMulti = db.prepare(`
          SELECT bt.id, bt.transfer_number, bt.status,
                 fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM branch_transfers bt
          LEFT JOIN branches fb ON fb.id = bt.from_branch_id
          LEFT JOIN branches tb ON tb.id = bt.to_branch_id
          WHERE bt.from_branch_id = ?
            AND bt.status = 'pending_approval'
          ORDER BY bt.created_at DESC
          LIMIT 20
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of incomingMulti) {
          createUniqueTransferNotification(
            'multi_incoming_request',
            String(tf.id),
            'New branch transfer request',
            `${tf.to_branch_name || 'A branch'} requested stock from your branch.`,
            tf,
            branchId,
          )
        }

        const updatesMulti = db.prepare(`
          SELECT bt.id, bt.transfer_number, bt.status,
                 fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM branch_transfers bt
          LEFT JOIN branches fb ON fb.id = bt.from_branch_id
          LEFT JOIN branches tb ON tb.id = bt.to_branch_id
          WHERE bt.to_branch_id = ?
            AND bt.status IN ('approved','rejected','dispatched','in_transit','received','partially_received','discrepancy','cancelled')
          ORDER BY bt.updated_at DESC
          LIMIT 30
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of updatesMulti) {
          const status = String(tf.status).replace(/_/g, ' ')
          createUniqueTransferNotification(
            `multi_status_${tf.status}`,
            String(tf.id),
            `Transfer request ${status}`,
            `${tf.from_branch_name || 'Source branch'} marked transfer ${tf.transfer_number} as ${status}.`,
            tf,
            branchId,
          )
        }

        const sourceUpdatesMulti = db.prepare(`
          SELECT bt.id, bt.transfer_number, bt.status,
                 fb.name AS from_branch_name, tb.name AS to_branch_name
          FROM branch_transfers bt
          LEFT JOIN branches fb ON fb.id = bt.from_branch_id
          LEFT JOIN branches tb ON tb.id = bt.to_branch_id
          WHERE bt.from_branch_id = ?
            AND bt.status IN ('received','partially_received','discrepancy','cancelled')
          ORDER BY bt.updated_at DESC
          LIMIT 30
        `).all(branchId) as Record<string, unknown>[]
        for (const tf of sourceUpdatesMulti) {
          const status = String(tf.status).replace(/_/g, ' ')
          createUniqueTransferNotification(
            `multi_source_status_${tf.status}`,
            String(tf.id),
            `Transfer ${status}`,
            `${tf.to_branch_name || 'Destination branch'} confirmed receipt of transfer ${tf.transfer_number} as ${status}.`,
            tf,
            branchId,
          )
        }
      }

      return { success: true }
  })
}
