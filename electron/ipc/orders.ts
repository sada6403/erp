import type { IpcMain } from 'electron'
import crypto from 'crypto'
import Store from 'electron-store'
import { getDb } from '../database'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { safeHandle } from './ipcHandler'

const store = new Store()

function currentUser() {
  return store.get('auth_user') as Record<string, unknown> | undefined
}

function currentPerms(caller: Record<string, unknown> | undefined = currentUser()): Record<string, unknown> {
  return ((caller?.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller?.permissions as Record<string, unknown>)
    || {}
}

export function registerOrderHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'orders:list', (_e, filters: Record<string, unknown> = {}) => {
    const user = currentUser()
      let sql = `SELECT o.*, b.name branch_name, u.name sales_staff_name,
        (SELECT COUNT(*) FROM customer_order_items oi WHERE oi.order_id=o.id) item_count
        FROM customer_orders o
        LEFT JOIN branches b ON b.id=o.branch_id
        LEFT JOIN users u ON u.id=o.sales_staff_id WHERE 1=1`
      const params: unknown[] = []
      if (filters.status) { sql += ' AND o.status=?'; params.push(filters.status) }
      if (filters.branch_id) { sql += ' AND o.branch_id=?'; params.push(filters.branch_id) }
      else if (user?.branch_id) { sql += ' AND o.branch_id=?'; params.push(user.branch_id) }
      sql += ' ORDER BY o.created_at DESC LIMIT 300'
      return { success: true, data: getDb().prepare(sql).all(...params) }
  })

  safeHandle(ipcMain, 'orders:get', (_e, id: string) => {
    const db = getDb()
    const order = db.prepare('SELECT * FROM customer_orders WHERE id=?').get(id)
    const items = db.prepare(`SELECT oi.*, p.name product_name, p.sku
      FROM customer_order_items oi JOIN products p ON p.id=oi.product_id
      WHERE oi.order_id=?`).all(id)
    return { success: true, data: { ...(order as object), items } }
  })

  safeHandle(ipcMain, 'orders:create', async (_e, payload) => {
    const db = getDb()
      const user = currentUser()
      const perms = currentPerms(user)
      if (!perms.all && !perms.employees && !perms.pos) throw new Error('Access required to create an order')
      const id = crypto.randomUUID()
      // A non-admin can only place an order under their own branch — the
      // client's branch_id is only trusted for admins.
      const branchId = perms.all ? (payload.branch_id || user?.branch_id) : user?.branch_id
      if (!branchId) throw new Error('A branch is required')
      if (!perms.all && payload.branch_id && payload.branch_id !== user?.branch_id) {
        throw new Error('Cannot create an order for another branch')
      }
      if (!payload.customer_name) throw new Error('Customer name is required')
      if (!Array.isArray(payload.items) || payload.items.length === 0) throw new Error('Add at least one product')
      const orderNumber = `ORD-${String(branchId).slice(0, 3).toUpperCase()}-${Date.now().toString(36).toUpperCase()}`
      const total = payload.items.reduce((sum: number, item: Record<string, unknown>) =>
        sum + Number(item.quantity) * Number(item.unit_price), 0)

      const rows: Record<string, unknown>[] = []
      db.transaction(() => {
        db.prepare(`INSERT INTO customer_orders
          (id,order_number,branch_id,customer_id,customer_name,customer_phone,customer_address,
           sales_staff_id,status,payment_status,total_amount,paid_amount,delivery_date,notes)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
          .run(id, orderNumber, branchId, payload.customer_id || null, payload.customer_name,
            payload.customer_phone || null, payload.customer_address || null, user?.id || null,
            'pending', payload.payment_status || 'unpaid', total, payload.paid_amount || 0,
            payload.delivery_date || null, payload.notes || null)
        for (const item of payload.items) {
          const row = {
            id: crypto.randomUUID(), order_id: id, product_id: item.product_id,
            quantity: Number(item.quantity), unit_price: Number(item.unit_price),
            line_total: Number(item.quantity) * Number(item.unit_price),
          }
          db.prepare(`INSERT INTO customer_order_items
            (id,order_id,product_id,quantity,unit_price,line_total)
            VALUES (@id,@order_id,@product_id,@quantity,@unit_price,@line_total)`).run(row)
          rows.push(row)
        }
      })()
      await enqueuSync('customer_orders', id, 'INSERT', {
        id, order_number: orderNumber, branch_id: branchId, customer_id: payload.customer_id || null,
        customer_name: payload.customer_name, customer_phone: payload.customer_phone || null,
        customer_address: payload.customer_address || null, sales_staff_id: user?.id || null,
        status: 'pending', payment_status: payload.payment_status || 'unpaid',
        total_amount: total, paid_amount: payload.paid_amount || 0,
        delivery_date: payload.delivery_date || null, notes: payload.notes || null,
      })
      for (const row of rows) await enqueuSync('customer_order_items', String(row.id), 'INSERT', row)
      logAudit(db, { userId: (user?.id as string) || null, branchId: String(branchId), action: 'ORDER_CREATED', tableName: 'customer_orders', recordId: id, newValues: { order_number: orderNumber, total } })
      return { success: true, data: { id, order_number: orderNumber } }
  })

  // Only these caller-supplied fields are ever allowed into the UPDATE —
  // `details` used to be spread directly into the SQL SET clause's column
  // list, so an arbitrary key from the renderer became an arbitrary column
  // reference. Whitelisting closes that off regardless of what's in details.
  const ORDER_UPDATE_ALLOWED_FIELDS = ['notes', 'delivery_date', 'payment_status', 'paid_amount'] as const

  safeHandle(ipcMain, 'orders:updateStatus', async (_e, id: string, status: string, details: Record<string, unknown> = {}) => {
    const allowed = ['pending','confirmed','processing','preparing','ready_for_delivery','dispatched','in_transit','delivered','cancelled','returned']
      if (!allowed.includes(status)) throw new Error('Invalid order status')
      const user = currentUser()
      const perms = currentPerms(user)
      if (!perms.all && !perms.employees && !perms.pos) throw new Error('Access required to update an order')
      const db0 = getDb()
      const order = db0.prepare('SELECT branch_id FROM customer_orders WHERE id=?').get(id) as { branch_id: string | null } | undefined
      if (!order) throw new Error('Order not found')
      if (!perms.all && user?.branch_id && order.branch_id !== user.branch_id) {
        throw new Error('Cannot update an order from another branch')
      }
      const patch: Record<string, unknown> = { status }
      for (const k of ORDER_UPDATE_ALLOWED_FIELDS) if (details[k] !== undefined) patch[k] = details[k]
      if (status === 'confirmed') patch.approved_by = user?.id || null
      if (status === 'ready_for_delivery') patch.released_by = user?.id || null
      if (status === 'dispatched') patch.dispatch_at = new Date().toISOString()
      if (status === 'delivered') {
        patch.delivered_at = new Date().toISOString()
        patch.delivery_confirmed_by = user?.id || null
      }
      const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
      db0.prepare(`UPDATE customer_orders SET ${fields}, updated_at=datetime('now') WHERE id=@id`)
        .run({ id, ...patch })
      await enqueuSync('customer_orders', id, 'UPDATE', { id, ...patch })
      logAudit(db0, { userId: (user?.id as string) || null, branchId: order.branch_id, action: 'ORDER_STATUS_UPDATED', tableName: 'customer_orders', recordId: id, newValues: { status } })
      return { success: true }
  })
}
