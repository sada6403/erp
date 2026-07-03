import { ipcMain } from 'electron'
import { getDb } from '../database'
import { randomUUID } from 'crypto'
import Store from 'electron-store'

const store = new Store()

export type NotifType =
  | 'low_stock' | 'installment_due' | 'installment_overdue'
  | 'sync_failed' | 'license_expiry' | 'subscription_grace'
  | 'subscription_expired' | 'transfer_request' | 'info'

export interface Notification {
  id: string
  type: NotifType
  title: string
  message: string
  is_read: number
  data: string | null
  created_at: string
}

export function createNotification(type: NotifType, title: string, message: string, data?: Record<string, unknown>) {
  try {
    const db = getDb()
    db.prepare(`
      INSERT OR IGNORE INTO notifications (id, type, title, message, data, created_at)
      VALUES (?, ?, ?, ?, ?, datetime('now'))
    `).run(randomUUID(), type, title, message, data ? JSON.stringify(data) : null)
  } catch { /* db not ready */ }
}

function createUniqueTransferNotification(
  event: string,
  transferId: string,
  title: string,
  message: string,
  data: Record<string, unknown>
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
    if (!existing) createNotification('transfer_request', title, message, { ...data, event, transfer_id: transferId })
  } catch { /* db not ready */ }
}

export function registerNotificationHandlers() {
  ipcMain.handle('notifications:getAll', () => {
    try {
      const db = getDb()
      return db.prepare(`
        SELECT * FROM notifications ORDER BY created_at DESC LIMIT 100
      `).all()
    } catch { return [] }
  })

  ipcMain.handle('notifications:getUnreadCount', () => {
    try {
      const db = getDb()
      const row = db.prepare(`SELECT COUNT(*) as cnt FROM notifications WHERE is_read = 0`).get() as { cnt: number }
      return row.cnt
    } catch { return 0 }
  })

  ipcMain.handle('notifications:markRead', (_e, id: string) => {
    try {
      const db = getDb()
      if (id === 'all') {
        db.prepare(`UPDATE notifications SET is_read = 1`).run()
      } else {
        db.prepare(`UPDATE notifications SET is_read = 1 WHERE id = ?`).run(id)
      }
      return { success: true }
    } catch { return { success: false } }
  })

  ipcMain.handle('notifications:delete', (_e, id: string) => {
    try {
      const db = getDb()
      db.prepare(`DELETE FROM notifications WHERE id = ?`).run(id)
      return { success: true }
    } catch { return { success: false } }
  })

  ipcMain.handle('notifications:clearAll', () => {
    try {
      const db = getDb()
      db.prepare(`DELETE FROM notifications WHERE is_read = 1`).run()
      return { success: true }
    } catch { return { success: false } }
  })

  // Generate notifications based on current app state
  ipcMain.handle('notifications:refresh', () => {
    try {
      const db = getDb()

      // Low stock check
      const lowStockItems = db.prepare(`
        SELECT p.name, pi.quantity, p.min_stock_level
        FROM product_inventory pi
        JOIN products p ON p.id = pi.product_id
        WHERE pi.quantity <= p.min_stock_level AND pi.quantity >= 0
        LIMIT 20
      `).all() as { name: string; quantity: number; min_stock_level: number }[]

      if (lowStockItems.length > 0) {
        const names = lowStockItems.slice(0, 3).map(i => i.name).join(', ')
        const more  = lowStockItems.length > 3 ? ` and ${lowStockItems.length - 3} more` : ''
        // Only create if no recent low_stock notification (within 1 hour)
        const recent = db.prepare(`
          SELECT id FROM notifications WHERE type='low_stock'
          AND created_at > datetime('now', '-1 hour') LIMIT 1
        `).get()
        if (!recent) {
          createNotification('low_stock', 'Low Stock Alert',
            `${lowStockItems.length} item${lowStockItems.length > 1 ? 's' : ''} need restocking: ${names}${more}`,
            { count: lowStockItems.length }
          )
        }
      }

      // Overdue installments
      const overdueCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM installments
        WHERE status = 'active' AND next_due_date < date('now') AND due_amount > paid_amount
      `).get() as { cnt: number }

      if (overdueCount.cnt > 0) {
        const recent = db.prepare(`
          SELECT id FROM notifications WHERE type='installment_overdue'
          AND created_at > datetime('now', '-6 hours') LIMIT 1
        `).get()
        if (!recent) {
          createNotification('installment_overdue', 'Overdue Installments',
            `${overdueCount.cnt} installment${overdueCount.cnt > 1 ? 's are' : ' is'} overdue and require attention.`,
            { count: overdueCount.cnt }
          )
        }
      }

      // Due today
      const dueTodayCount = db.prepare(`
        SELECT COUNT(*) as cnt FROM installments
        WHERE status = 'active' AND next_due_date = date('now') AND due_amount > paid_amount
      `).get() as { cnt: number }

      if (dueTodayCount.cnt > 0) {
        const recent = db.prepare(`
          SELECT id FROM notifications WHERE type='installment_due'
          AND created_at > datetime('now', '-6 hours') LIMIT 1
        `).get()
        if (!recent) {
          createNotification('installment_due', 'Installments Due Today',
            `${dueTodayCount.cnt} installment payment${dueTodayCount.cnt > 1 ? 's are' : ' is'} due today.`,
            { count: dueTodayCount.cnt }
          )
        }
      }

      // Expiring batches (within 30 days)
      try {
        const expiringBatches = db.prepare(`
          SELECT COUNT(*) as cnt FROM product_batches
          WHERE expiry_date IS NOT NULL AND quantity > 0
            AND expiry_date <= date('now', '+30 days') AND expiry_date >= date('now')
        `).get() as { cnt: number }
        if (expiringBatches.cnt > 0) {
          const recent = db.prepare(`SELECT id FROM notifications WHERE title='Batches Expiring Soon' AND created_at > datetime('now', '-6 hours') LIMIT 1`).get()
          if (!recent) createNotification('low_stock', 'Batches Expiring Soon', `${expiringBatches.cnt} batch${expiringBatches.cnt > 1 ? 'es' : ''} will expire within 30 days. Review your inventory.`, { count: expiringBatches.cnt })
        }
        const expiredBatches = db.prepare(`SELECT COUNT(*) as cnt FROM product_batches WHERE expiry_date IS NOT NULL AND quantity > 0 AND expiry_date < date('now')`).get() as { cnt: number }
        if (expiredBatches.cnt > 0) {
          const recent = db.prepare(`SELECT id FROM notifications WHERE title='Expired Stock Alert' AND created_at > datetime('now', '-6 hours') LIMIT 1`).get()
          if (!recent) createNotification('low_stock', 'Expired Stock Alert', `${expiredBatches.cnt} batch${expiredBatches.cnt > 1 ? 'es' : ''} have expired but still have stock. Remove from sale immediately.`, { count: expiredBatches.cnt })
        }
      } catch { /* product_batches table may not exist on first run */ }

      // Inter-branch transfer notifications. These are generated from synced
      // stock_transfers so every branch sees the correct request/status after
      // background sync pulls the row down.
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const branchId = String(user?.branch_id || (user?.branch as Record<string, unknown> | undefined)?.id || '')
      if (branchId) {
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
            tf
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
            tf
          )
        }
      }

      return { success: true }
    } catch { return { success: false } }
  })
}
