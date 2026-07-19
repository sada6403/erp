import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { safeHandleModule } from './ipcHandler'

const store = new Store()

function currentPerms(): Record<string, unknown> {
  const caller = (store.get('auth_user') as Record<string, unknown> | undefined) || {}
  return ((caller.role as Record<string, unknown>)?.permissions as Record<string, unknown>)
    || (caller.permissions as Record<string, unknown>) || {}
}

type POStatus = 'DRAFT' | 'SENT' | 'PARTIAL' | 'RECEIVED' | 'CANCELLED'

const PO_TRANSITIONS: Record<string, string[]> = {
  DRAFT:    ['SENT', 'CANCELLED'],
  SENT:     ['PARTIAL', 'RECEIVED', 'CANCELLED'],
  PARTIAL:  ['PARTIAL', 'RECEIVED', 'CANCELLED'],
}

function getNextPONumber(branchId: string): string {
  const db = getDb()
  const year = new Date().getFullYear()
  const branch = db.prepare('SELECT code, name FROM branches WHERE id=?').get(branchId) as
    { code: string | null; name: string } | undefined
  const branchCode = (branch?.code || branch?.name?.slice(0, 4) || 'BR').toUpperCase().replace(/\s+/g, '')

  // Re-use bill_sequences for PO as well (type = 'PO')
  let row = db.prepare('SELECT last_seq FROM bill_sequences WHERE branch_id=? AND bill_type=? AND year=?')
    .get(branchId, 'PO', year) as { last_seq: number } | undefined
  if (!row) {
    db.prepare('INSERT OR IGNORE INTO bill_sequences (branch_id, bill_type, year, last_seq) VALUES (?,?,?,0)')
      .run(branchId, 'PO', year)
    row = { last_seq: 0 }
  }
  db.prepare('UPDATE bill_sequences SET last_seq=last_seq+1 WHERE branch_id=? AND bill_type=? AND year=?')
    .run(branchId, 'PO', year)
  const updated = db.prepare('SELECT last_seq FROM bill_sequences WHERE branch_id=? AND bill_type=? AND year=?')
    .get(branchId, 'PO', year) as { last_seq: number }
  return `${branchCode}-PO-${year}-${String(updated.last_seq).padStart(4, '0')}`
}

export function registerPurchaseHandlers(ipcMain: IpcMain) {
  // List POs with optional filters
  safeHandleModule(ipcMain, 'purchases:list', 'purchase_orders', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
      let sql = `
        SELECT po.*, s.name as supplier_name, b.name as branch_name,
               u.name as created_by_name,
               (SELECT COUNT(*) FROM purchase_items pi WHERE pi.po_id = po.id) as item_count
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN branches b  ON b.id  = po.branch_id
        LEFT JOIN users u     ON u.id  = po.created_by
        WHERE 1=1`
      const params: unknown[] = []
      if (filters.status)    { sql += ' AND po.status=?';    params.push(filters.status) }
      if (filters.branch_id) { sql += ' AND po.branch_id=?'; params.push(filters.branch_id) }
      if (filters.supplier_id) { sql += ' AND po.supplier_id=?'; params.push(filters.supplier_id) }
      sql += ' ORDER BY po.created_at DESC LIMIT 200'
      return { success: true, data: db.prepare(sql).all(...params) }
  })

  // Get single PO with items
  safeHandleModule(ipcMain, 'purchases:get', 'purchase_orders', (_e, id: string) => {
    const db = getDb()
      const po = db.prepare(`
        SELECT po.*, s.name as supplier_name, b.name as branch_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN branches b  ON b.id  = po.branch_id
        WHERE po.id=?`).get(id)
      if (!po) throw new Error('Purchase order not found')
      const items = db.prepare(`
        SELECT pi.*, p.name as product_name, p.sku
        FROM purchase_items pi
        LEFT JOIN products p ON p.id = pi.product_id
        WHERE pi.po_id=?`).all(id)
      return { success: true, data: { ...po as object, items } }
  })

  // Create PO (starts as DRAFT)
  safeHandleModule(ipcMain, 'purchases:create', 'purchase_orders', async (_e, payload) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      if (!payload.supplier_id)       throw new Error('Supplier is required')
      if (!payload.items?.length)     throw new Error('At least one item is required')
      if (!payload.branch_id && !user?.branch_id) throw new Error('Branch is required')

      const branchId = payload.branch_id || user?.branch_id as string
      const id = crypto.randomUUID()
      const po_number = getNextPONumber(branchId)

      const po = {
        id,
        po_number,
        supplier_id:     payload.supplier_id,
        branch_id:       branchId,
        status:          'DRAFT' as POStatus,
        notes:           payload.notes || null,
        expected_date:   payload.expected_date || null,
        total_amount:    0,
        created_by:      user?.id || null,
      }

      let totalAmount = 0
      const items: object[] = []
      for (const item of payload.items as Record<string, unknown>[]) {
        if (!item.product_id) throw new Error('Each item must have a product_id')
        const qty      = Number(item.quantity)      || 0
        const unitCost = Number(item.unit_cost)     || 0
        if (qty <= 0)      throw new Error('Item quantity must be greater than zero')
        if (unitCost <= 0) throw new Error('Item unit cost must be greater than zero')
        const lineTotal = qty * unitCost
        totalAmount += lineTotal
        items.push({
          id: crypto.randomUUID(),
          po_id:       id,
          product_id:  item.product_id,
          quantity:    qty,
          unit_cost:   unitCost,
          line_total:  lineTotal,
          received_qty: 0,
          notes:       item.notes || null,
        })
      }
      po.total_amount = totalAmount

      db.transaction(() => {
        db.prepare(`INSERT INTO purchase_orders
          (id,po_number,supplier_id,branch_id,status,notes,expected_date,total_amount,created_by)
          VALUES (@id,@po_number,@supplier_id,@branch_id,@status,@notes,@expected_date,@total_amount,@created_by)`)
          .run(po)
        for (const item of items as Record<string, unknown>[]) {
          db.prepare(`INSERT INTO purchase_items
            (id,po_id,product_id,quantity,unit_cost,line_total,received_qty,notes)
            VALUES (@id,@po_id,@product_id,@quantity,@unit_cost,@line_total,@received_qty,@notes)`)
            .run(item)
        }
        logAudit(db, {
          userId: user?.id as string, branchId,
          action: 'PO_CREATE', tableName: 'purchase_orders', recordId: id, newValues: po,
        })
      })()

      await enqueuSync('purchase_orders', id, 'INSERT', po)
      return { success: true, data: { id, po_number } }
  })

  // Update PO status (DRAFT→SENT→PARTIAL/RECEIVED/CANCELLED)
  safeHandleModule(ipcMain, 'purchases:updateStatus', 'purchase_orders', async (_e, id: string, status: string, payload: Record<string, unknown> = {}) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')

      const allowed = PO_TRANSITIONS[String(po.status)]
      if (!allowed?.includes(status)) {
        throw new Error(`Cannot move PO from '${po.status}' to '${status}'`)
      }

      // Only a Company Admin can mark stock as received — this is the point
      // new stock actually enters the company (PARTIAL also increments stock
      // and can auto-promote to RECEIVED below, so it's gated too).
      if ((status === 'RECEIVED' || status === 'PARTIAL') && !currentPerms().all) {
        throw new Error('Only a Company Admin can mark a purchase order as received.')
      }

      const now = new Date().toISOString()
      const patch: Record<string, unknown> = { status }

      // When marking RECEIVED or PARTIAL, update received quantities on items and adjust stock
      if ((status === 'RECEIVED' || status === 'PARTIAL') && payload.items) {
        db.transaction(() => {
          let allFullyReceived = true

          for (const item of payload.items as Record<string, unknown>[]) {
            const poItem = db.prepare('SELECT * FROM purchase_items WHERE id=? AND po_id=?')
              .get(String(item.id), id) as Record<string, unknown> | undefined
            if (!poItem) continue

            const newReceived = Number(item.received_qty) || 0
            const totalReceived = Number(poItem.received_qty || 0) + newReceived
            if (totalReceived > Number(poItem.quantity)) {
              throw new Error(`Received quantity exceeds ordered quantity for product`)
            }

            db.prepare(`UPDATE purchase_items SET received_qty=?, updated_at=datetime('now') WHERE id=?`)
              .run(totalReceived, poItem.id)

            // Update stock at receiving branch
            if (newReceived > 0) {
              const branchId = String(po.branch_id)
              const productId = String(poItem.product_id)
              const existingStock = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?')
                .get(productId, branchId) as { id: string } | undefined
              if (existingStock) {
                db.prepare(`UPDATE stocks SET quantity=quantity+?, updated_at=datetime('now') WHERE id=?`)
                  .run(newReceived, existingStock.id)
              } else {
                db.prepare(`INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty)
                  VALUES (?,?,?,?,0)`).run(crypto.randomUUID(), productId, branchId, newReceived)
              }
            }

            if (totalReceived < Number(poItem.quantity)) allFullyReceived = false
          }

          // Auto-promote PARTIAL to RECEIVED if everything is now received
          if (status === 'PARTIAL' && allFullyReceived) patch.status = 'RECEIVED'
          if (status === 'RECEIVED') patch.received_at = now

          db.prepare(`UPDATE purchase_orders SET status=?, updated_at=datetime('now') WHERE id=?`)
            .run(patch.status, id)

          logAudit(db, {
            userId: user?.id as string, branchId: po.branch_id as string,
            action: `PO_${status}`, tableName: 'purchase_orders', recordId: id,
            newValues: { from: po.status, to: patch.status },
          })
        })()
      } else {
        if (status === 'SENT')      patch.sent_at      = now
        if (status === 'RECEIVED')  patch.received_at  = now
        if (status === 'CANCELLED') patch.cancelled_at = now

        const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
        db.prepare(`UPDATE purchase_orders SET ${fields}, updated_at=datetime('now') WHERE id=@id`)
          .run({ id, ...patch })

        logAudit(db, {
          userId: user?.id as string, branchId: po.branch_id as string,
          action: `PO_${status}`, tableName: 'purchase_orders', recordId: id,
          newValues: { from: po.status, to: status },
        })
      }

      await enqueuSync('purchase_orders', id, 'UPDATE', { id, ...patch })
      return { success: true }
  })

  // Update draft PO (add/remove/edit items before sending)
  safeHandleModule(ipcMain, 'purchases:update', 'purchase_orders', async (_e, id: string, payload: Record<string, unknown>) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')
      if (po.status !== 'DRAFT') throw new Error('Only DRAFT purchase orders can be edited')

      db.transaction(() => {
        if (payload.notes !== undefined)         db.prepare('UPDATE purchase_orders SET notes=? WHERE id=?').run(payload.notes, id)
        if (payload.expected_date !== undefined) db.prepare('UPDATE purchase_orders SET expected_date=? WHERE id=?').run(payload.expected_date, id)
        if (payload.supplier_id !== undefined)   db.prepare('UPDATE purchase_orders SET supplier_id=? WHERE id=?').run(payload.supplier_id, id)

        if (payload.items) {
          // Replace items entirely
          db.prepare('DELETE FROM purchase_items WHERE po_id=?').run(id)
          let totalAmount = 0
          for (const item of payload.items as Record<string, unknown>[]) {
            const qty      = Number(item.quantity)  || 0
            const unitCost = Number(item.unit_cost) || 0
            const lineTotal = qty * unitCost
            totalAmount += lineTotal
            db.prepare(`INSERT INTO purchase_items (id,po_id,product_id,quantity,unit_cost,line_total,received_qty,notes)
              VALUES (?,?,?,?,?,?,0,?)`)
              .run(crypto.randomUUID(), id, item.product_id, qty, unitCost, lineTotal, item.notes || null)
          }
          db.prepare(`UPDATE purchase_orders SET total_amount=?, updated_at=datetime('now') WHERE id=?`)
            .run(totalAmount, id)
        }

        logAudit(db, {
          userId: user?.id as string, branchId: po.branch_id as string,
          action: 'PO_UPDATE', tableName: 'purchase_orders', recordId: id, newValues: payload,
        })
      })()

      await enqueuSync('purchase_orders', id, 'UPDATE', { id, ...payload })
      return { success: true }
  })
}
