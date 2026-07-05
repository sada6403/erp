import type { IpcMain } from 'electron'
import { dialog } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'
import fs from 'fs'
import { insertStockMovement } from '../services/stockMovement'
import { createNotification } from './notifications'

const store = new Store()

function currentBranchId(): string {
  const user = store.get('auth_user') as Record<string, unknown> | undefined
  return (user?.branch_id as string) || 'b1111111-1111-4111-8111-111111111111'
}

function csvCell(value: unknown): string {
  const text = String(value ?? '')
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`
  return text
}

function parseCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (ch === '"' && quoted && line[i + 1] === '"') { current += '"'; i++; continue }
    if (ch === '"') { quoted = !quoted; continue }
    if (ch === ',' && !quoted) { result.push(current); current = ''; continue }
    current += ch
  }
  result.push(current)
  return result
}

function insertTransferHistory(
  db: ReturnType<typeof getDb>,
  transfer: Record<string, unknown>,
  status: string,
  actorId: unknown,
  notes?: string | null
) {
  const record = {
    id: crypto.randomUUID(),
    transfer_id: String(transfer.id),
    product_id: String(transfer.product_id),
    variant_id: transfer.variant_id ? String(transfer.variant_id) : null,
    quantity: Number(transfer.quantity || 0),
    from_branch_id: transfer.from_branch_id ? String(transfer.from_branch_id) : null,
    to_branch_id: transfer.to_branch_id ? String(transfer.to_branch_id) : null,
    requested_by: transfer.initiated_by ? String(transfer.initiated_by) : null,
    approved_by: transfer.approved_by ? String(transfer.approved_by) : null,
    status,
    notes: notes || null,
    created_by: actorId ? String(actorId) : null,
  }
  db.prepare(`
    INSERT INTO stock_transfer_history (
      id, transfer_id, product_id, variant_id, quantity, from_branch_id, to_branch_id,
      requested_by, approved_by, status, notes, created_by
    )
    VALUES (
      @id, @transfer_id, @product_id, @variant_id, @quantity, @from_branch_id, @to_branch_id,
      @requested_by, @approved_by, @status, @notes, @created_by
    )
  `).run(record)
  return record
}

export function registerStockHandlers(ipcMain: IpcMain) {
  ipcMain.handle('stocks:list', (_e, branchId?: string) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const bid = branchId || user?.branch_id || 'b1111111-1111-4111-8111-111111111111'
      const rows = db.prepare(`
        SELECT s.*, p.name as product_name, p.sku, p.min_stock_level,
               w.name as warehouse_name
        FROM stocks s
        LEFT JOIN products p ON p.id = s.product_id
        LEFT JOIN warehouses w ON w.id = s.warehouse_id
        WHERE s.branch_id = ?
        ORDER BY p.name
      `).all(bid)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:lowStock', (_e, branchId?: string) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const bid = branchId || user?.branch_id || 'b1111111-1111-4111-8111-111111111111'
      const rows = db.prepare(`
        SELECT s.*, p.name as product_name, p.sku, p.min_stock_level
        FROM stocks s
        LEFT JOIN products p ON p.id = s.product_id
        WHERE s.branch_id = ? AND s.quantity <= p.min_stock_level
        ORDER BY s.quantity ASC
      `).all(bid)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:get', (_e, productId: string) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const row = db.prepare(`
        SELECT * FROM stocks WHERE product_id = ? AND branch_id = ?
      `).get(productId, user?.branch_id || 'b1111111-1111-4111-8111-111111111111')
      return { success: true, data: row }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:adjust', async (_e, payload) => {
    try {
      const db = getDb()
      const { product_id, branch_id, warehouse_id, quantity, reason } = payload
      const user = store.get('auth_user') as Record<string, unknown>

      const existing = db.prepare(`
        SELECT * FROM stocks WHERE product_id = ? AND branch_id = ?
      `).get(product_id, branch_id)

      if (existing) {
        db.prepare(`UPDATE stocks SET quantity = ?, updated_at = datetime('now')
          WHERE product_id = ? AND branch_id = ?`).run(quantity, product_id, branch_id)
      } else {
        const id = crypto.randomUUID()
        db.prepare(`INSERT INTO stocks (id, product_id, branch_id, warehouse_id, quantity)
          VALUES (?, ?, ?, ?, ?)`).run(id, product_id, branch_id, warehouse_id || null, quantity)
      }

      const previousQty = existing ? Number((existing as Record<string, unknown>).quantity || 0) : 0
      const delta = Number(quantity) - previousQty
      let movement: Record<string, unknown> | null = null
      if (delta !== 0) {
        movement = insertStockMovement(db, {
          product_id,
          from_branch_id: delta < 0 ? branch_id : null,
          to_branch_id: delta > 0 ? branch_id : null,
          quantity: Math.abs(delta),
          movement_type: 'ADJUSTMENT',
          notes: reason || `Stock adjusted from ${previousQty} to ${quantity}`,
          created_by: (user?.id as string) || null,
        })
      }

      db.prepare(`INSERT INTO audit_logs (id, user_id, branch_id, action, table_name, record_id, new_values)
        VALUES (?,?,?,?,?,?,?)`)
        .run(crypto.randomUUID(), user?.id, branch_id, 'STOCK_ADJUST', 'stocks', product_id,
          JSON.stringify({ quantity, reason }))

      await enqueuSync('stocks', `${product_id}-${branch_id}`, 'UPDATE', payload)
      if (movement) await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:transfer', async (_e, payload) => {
    try {
      const db = getDb()
      const id = crypto.randomUUID()
      const user = store.get('auth_user') as Record<string, unknown>
      const transferNumber = `TRF-${Date.now().toString(36).toUpperCase()}`

      if (!payload.product_id || !payload.from_branch_id || !payload.to_branch_id) {
        throw new Error('Product, source branch and destination branch are required')
      }
      if (payload.from_branch_id === payload.to_branch_id) throw new Error('Branches must be different')
      if (Number(payload.quantity) <= 0) throw new Error('Quantity must be greater than zero')
      const record = {
        id, transfer_number: transferNumber, product_id: payload.product_id,
        from_branch_id: payload.from_branch_id, to_branch_id: payload.to_branch_id,
        from_warehouse_id: payload.from_warehouse_id || null,
        to_warehouse_id: payload.to_warehouse_id || null,
        quantity: Number(payload.quantity), status: 'pending_approval',
        notes: payload.notes || null, initiated_by: user?.id || null,
        driver_name: payload.driver_name || null, driver_phone: payload.driver_phone || null,
        vehicle_number: payload.vehicle_number || null,
        expected_delivery_at: payload.expected_delivery_at || null,
      }
      db.transaction(() => {
        db.prepare(`INSERT INTO stock_transfers
          (id,transfer_number,product_id,from_branch_id,to_branch_id,from_warehouse_id,
           to_warehouse_id,quantity,status,notes,initiated_by,driver_name,driver_phone,
           vehicle_number,expected_delivery_at)
          VALUES (@id,@transfer_number,@product_id,@from_branch_id,@to_branch_id,@from_warehouse_id,
           @to_warehouse_id,@quantity,@status,@notes,@initiated_by,@driver_name,@driver_phone,
           @vehicle_number,@expected_delivery_at)`).run(record)
        insertTransferHistory(db, record, 'Pending', user?.id, record.notes)
        db.prepare(`INSERT INTO audit_logs (id,user_id,branch_id,action,table_name,record_id,new_values)
          VALUES (?,?,?,?,?,?,?)`)
          .run(
            crypto.randomUUID(),
            user?.id,
            record.to_branch_id,
            'TRANSFER_REQUEST_CREATED',
            'stock_transfers',
            id,
            JSON.stringify(record)
          )
      })()
      const product = db.prepare('SELECT name FROM products WHERE id=?').get(payload.product_id) as { name?: string } | undefined
      const fromBranch = db.prepare('SELECT name FROM branches WHERE id=?').get(payload.from_branch_id) as { name?: string } | undefined
      createNotification(
        'transfer_request',
        'Stock request submitted',
        `${Number(payload.quantity)} x ${product?.name || 'product'} requested from ${fromBranch?.name || 'source branch'}.`,
        { event: 'request_submitted', transfer_id: id, transfer_number: transferNumber, from_branch_id: payload.from_branch_id, to_branch_id: payload.to_branch_id }
      )
      await enqueuSync('stock_transfers', id, 'INSERT', record)
      return { success: true, data: { id, transfer_number: transferNumber } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:listTransfers', (_e, filters: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `
        SELECT st.*, p.name as product_name, p.sku,
               fb.name as from_branch_name, tb.name as to_branch_name,
               iu.name as initiated_by_name, au.name as approved_by_name,
               ru.name as received_by_name
        FROM stock_transfers st
        LEFT JOIN products p ON p.id = st.product_id
        LEFT JOIN branches fb ON fb.id = st.from_branch_id
        LEFT JOIN branches tb ON tb.id = st.to_branch_id
        LEFT JOIN users iu ON iu.id = st.initiated_by
        LEFT JOIN users au ON au.id = st.approved_by
        LEFT JOIN users ru ON ru.id = st.received_by
        WHERE 1=1`
      const params: unknown[] = []
      if (filters.status) { sql += ' AND st.status=?'; params.push(filters.status) }
      if (filters.branch_id) {
        sql += ' AND (st.from_branch_id = ? OR st.to_branch_id = ?)'
        params.push(filters.branch_id, filters.branch_id)
      }
      sql += ' ORDER BY st.initiated_at DESC LIMIT 200'
      const rows = db.prepare(sql).all(...params)
      return { success: true, data: rows }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:movements', (_e, filters: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      let sql = `
        SELECT sm.*, p.name AS product_name, p.sku,
               fb.name AS from_branch_name, tb.name AS to_branch_name,
               u.name AS done_by_name,
               i.invoice_number,
               st.transfer_number
        FROM stock_movements sm
        JOIN products p ON p.id = sm.product_id
        LEFT JOIN branches fb ON fb.id = sm.from_branch_id
        LEFT JOIN branches tb ON tb.id = sm.to_branch_id
        LEFT JOIN users u ON u.id = sm.created_by
        LEFT JOIN invoices i ON i.id = sm.reference_order_id
        LEFT JOIN stock_transfers st ON st.id = sm.reference_transfer_id
        WHERE 1=1
      `
      const params: unknown[] = []
      if (filters.date_from) { sql += ' AND date(sm.created_at) >= ?'; params.push(filters.date_from) }
      if (filters.date_to) { sql += ' AND date(sm.created_at) <= ?'; params.push(filters.date_to) }
      if (filters.branch_id) {
        sql += ' AND (sm.from_branch_id = ? OR sm.to_branch_id = ?)'
        params.push(filters.branch_id, filters.branch_id)
      }
      if (filters.product_id) { sql += ' AND sm.product_id = ?'; params.push(filters.product_id) }
      if (filters.movement_type) { sql += ' AND sm.movement_type = ?'; params.push(filters.movement_type) }
      sql += ' ORDER BY sm.created_at DESC LIMIT 1000'
      return { success: true, data: db.prepare(sql).all(...params) }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:availability', (_e, productId: string) => {
    try {
      const rows = getDb().prepare(`
        SELECT s.id, s.product_id, s.branch_id, b.name branch_name, b.address branch_address,
          s.quantity, s.damaged_qty, MAX(s.quantity - s.damaged_qty, 0) available_quantity
        FROM stocks s JOIN branches b ON b.id=s.branch_id
        WHERE s.product_id=? AND b.is_active=1 ORDER BY available_quantity DESC
      `).all(productId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stocks:updateTransfer', async (_e, id: string, status: string, payload: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const transfer = db.prepare('SELECT * FROM stock_transfers WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!transfer) throw new Error('Transfer not found')

      // Physical transfer flow: goods leave source on APPROVE (deducted, now in
      // transit), and only reach destination on RECEIVE. So 'received' is NOT
      // allowed straight from pending (source hasn't been deducted yet).
      const transitions: Record<string, string[]> = {
        pending:            ['approved', 'rejected', 'cancelled'],
        pending_approval:   ['approved', 'rejected', 'cancelled'],
        approved:           ['ready_for_dispatch', 'dispatched', 'received', 'partially_received', 'cancelled'],
        ready_for_dispatch: ['dispatched', 'received', 'partially_received', 'cancelled'],
        dispatched:         ['in_transit', 'received', 'partially_received', 'discrepancy'],
        in_transit:         ['received', 'partially_received', 'discrepancy'],
      }
      const allowed = transitions[String(transfer.status)]
      if (!allowed?.includes(status)) {
        throw new Error(`Cannot move transfer from '${transfer.status}' to '${status}'`)
      }

      // Maker-checker: the person who initiated cannot approve
      if (status === 'approved') {
        if (String(transfer.initiated_by) === String(user?.id)) {
          throw new Error('You cannot approve a transfer you initiated (maker-checker rule)')
        }
        const source = db.prepare(`
          SELECT quantity FROM stocks
          WHERE product_id=? AND branch_id=?
          LIMIT 1
        `).get(transfer.product_id, transfer.from_branch_id) as { quantity: number } | undefined
        if (!source || Number(source.quantity) < Number(transfer.quantity)) {
          throw new Error('Insufficient source stock at approval time')
        }
      }

      // Rejection requires a reason
      if (status === 'rejected' && !payload.reject_reason) {
        throw new Error('A reject_reason is required when rejecting a transfer')
      }

      // Discrepancy requires a note
      if (status === 'discrepancy' && !payload.discrepancy_note) {
        throw new Error('A discrepancy_note is required when flagging a discrepancy')
      }

      const now = new Date().toISOString()
      const patch: Record<string, unknown> = { status }
      const movementRecords: Record<string, unknown>[] = []
      const qty = Number(transfer.quantity)

      // Has the source branch already been deducted? (goods left source on approve)
      const sourceDeducted = ['approved', 'ready_for_dispatch', 'dispatched', 'in_transit'].includes(String(transfer.status))

      if (status === 'approved') {
        patch.approved_by = user?.id || null
      }
      if (status === 'rejected') {
        patch.rejected_by   = user?.id || null
        patch.reject_reason = payload.reject_reason
      }
      if (status === 'ready_for_dispatch') {
        patch.released_by = user?.id || null
      }
      if (status === 'dispatched' || status === 'in_transit') {
        patch.dispatch_at = transfer.dispatch_at || now
        if (payload.driver_name)          patch.driver_name          = payload.driver_name
        if (payload.driver_phone)         patch.driver_phone         = payload.driver_phone
        if (payload.vehicle_number)       patch.vehicle_number       = payload.vehicle_number
        if (payload.expected_delivery_at) patch.expected_delivery_at = payload.expected_delivery_at
      }
      if (status === 'received' || status === 'partially_received') {
        const received = status === 'received' ? qty : Number(payload.received_quantity || 0)
        const damaged  = Number(payload.damaged_quantity || 0)
        if (received < 0 || damaged < 0 || received + damaged > qty) {
          throw new Error('Received and damaged quantities exceed the dispatched quantity')
        }
        patch.received_quantity  = received
        patch.damaged_quantity   = damaged
        patch.missing_quantity   = qty - received - damaged
        patch.actual_delivery_at = now
        patch.received_by        = user?.id || null
      }
      if (status === 'discrepancy') {
        patch.discrepancy_note = payload.discrepancy_note
        patch.discrepancy_by   = user?.id || null
        if (payload.received_quantity !== undefined) {
          const received = Number(payload.received_quantity)
          const damaged  = Number(payload.damaged_quantity || 0)
          patch.received_quantity  = received
          patch.damaged_quantity   = damaged
          patch.missing_quantity   = qty - received - damaged
          patch.actual_delivery_at = now
          patch.received_by        = user?.id || null
        }
      }

      // Does this step credit the destination branch? (goods arrive)
      const creditsDestination = status === 'received' || status === 'partially_received' ||
        (status === 'discrepancy' && patch.received_quantity !== undefined)

      db.transaction(() => {
        // 1. APPROVE → goods leave source: deduct source stock, mark in-transit.
        if (status === 'approved') {
          const changed = db.prepare(`UPDATE stocks SET quantity=quantity-?, updated_at=datetime('now')
            WHERE product_id=? AND branch_id=? AND quantity>=?`)
            .run(qty, transfer.product_id, transfer.from_branch_id, qty)
          if (!changed.changes) throw new Error('Insufficient source stock at approval time')
          movementRecords.push(insertStockMovement(db, {
            product_id: String(transfer.product_id),
            from_branch_id: String(transfer.from_branch_id),
            to_branch_id: String(transfer.to_branch_id),
            quantity: qty, movement_type: 'TRANSFER', reference_transfer_id: id,
            notes: `Approved - dispatched from source (in transit): ${transfer.transfer_number || id}`,
            created_by: (user?.id as string) || null,
          }))
        }

        // 2. RECEIVE / partial / discrepancy → goods arrive: credit destination
        //    with the actually-received qty (missing goods stay lost in transit).
        if (creditsDestination) {
          const received = Number(patch.received_quantity ?? qty)
          const damaged  = Number(patch.damaged_quantity || 0)
          if (received > 0 || damaged > 0) {
            const dest = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?')
              .get(transfer.product_id, transfer.to_branch_id) as { id: string } | undefined
            if (dest) {
              db.prepare(`UPDATE stocks SET quantity=quantity+?, damaged_qty=damaged_qty+?,
                updated_at=datetime('now') WHERE id=?`).run(received, damaged, dest.id)
            } else {
              db.prepare(`INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty)
                VALUES (?,?,?,?,?)`)
                .run(crypto.randomUUID(), transfer.product_id, transfer.to_branch_id, received, damaged)
            }
            if (received > 0) {
              movementRecords.push(insertStockMovement(db, {
                product_id: String(transfer.product_id),
                from_branch_id: String(transfer.from_branch_id),
                to_branch_id: String(transfer.to_branch_id),
                quantity: received, movement_type: 'RECEIVE', reference_transfer_id: id,
                notes: `Received at destination: ${transfer.transfer_number || id}`,
                created_by: (user?.id as string) || null,
              }))
            }
          }
        }

        // 3. CANCEL after source was deducted → return goods to source.
        if (status === 'cancelled' && sourceDeducted) {
          const src = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?')
            .get(transfer.product_id, transfer.from_branch_id) as { id: string } | undefined
          if (src) db.prepare(`UPDATE stocks SET quantity=quantity+?, updated_at=datetime('now') WHERE id=?`).run(qty, src.id)
          else db.prepare(`INSERT INTO stocks (id,product_id,branch_id,quantity) VALUES (?,?,?,?)`)
            .run(crypto.randomUUID(), transfer.product_id, transfer.from_branch_id, qty)
          movementRecords.push(insertStockMovement(db, {
            product_id: String(transfer.product_id),
            from_branch_id: String(transfer.to_branch_id),
            to_branch_id: String(transfer.from_branch_id),
            quantity: qty, movement_type: 'TRANSFER', reference_transfer_id: id,
            notes: `Cancelled - stock returned to source: ${transfer.transfer_number || id}`,
            created_by: (user?.id as string) || null,
          }))
        }

        const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
        db.prepare(`UPDATE stock_transfers SET ${fields}, updated_at=datetime('now') WHERE id=@id`)
          .run({ id, ...patch })

        const historyLabel: Record<string, string> = {
          approved:           'Approved & dispatched from source',
          rejected:           'Rejected',
          ready_for_dispatch: 'Ready for dispatch',
          dispatched:         'Dispatched — in transit',
          in_transit:         'In transit',
          received:           'Received — completed',
          partially_received: 'Partially received',
          discrepancy:        'Discrepancy reported',
          cancelled:          'Cancelled',
        }
        insertTransferHistory(
          db,
          { ...transfer, ...patch },
          historyLabel[status] || status.replace(/_/g, ' '),
          user?.id,
          String(payload.notes || payload.reject_reason || payload.discrepancy_note || '')
        )

        // Audit log
        db.prepare(`INSERT INTO audit_logs (id,user_id,branch_id,action,table_name,record_id,new_values)
          VALUES (?,?,?,?,?,?,?)`)
          .run(
            crypto.randomUUID(),
            user?.id, transfer.from_branch_id,
            `TRANSFER_${status.toUpperCase()}`,
            'stock_transfers', id,
            JSON.stringify({ from_status: transfer.status, to_status: status, ...patch })
          )
      })()

      await enqueuSync('stock_transfers', id, 'UPDATE', { id, ...patch })

      // Sync whichever branch stock actually changed
      const changedBranches = new Set<string>()
      if (status === 'approved' || (status === 'cancelled' && sourceDeducted)) changedBranches.add(String(transfer.from_branch_id))
      if (creditsDestination) changedBranches.add(String(transfer.to_branch_id))
      for (const bId of changedBranches) {
        const s = db.prepare('SELECT * FROM stocks WHERE product_id=? AND branch_id=?')
          .get(transfer.product_id, bId) as Record<string, unknown> | undefined
        if (s) await enqueuSync('stocks', String(s.id), 'UPDATE', s)
      }
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
      }

      const product = db.prepare('SELECT name FROM products WHERE id=?').get(transfer.product_id) as { name?: string } | undefined
      const fromBranch = db.prepare('SELECT name FROM branches WHERE id=?').get(transfer.from_branch_id) as { name?: string } | undefined
      const messageStatus = status.replace(/_/g, ' ')
      createNotification(
        'transfer_request',
        `Stock transfer ${messageStatus}`,
        `${fromBranch?.name || 'Source branch'} — ${Number(transfer.quantity)} x ${product?.name || 'product'} is now ${messageStatus}.`,
        { event: `status_${status}`, transfer_id: id, transfer_number: transfer.transfer_number, status }
      )

      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  // Full handover timeline for one transfer (who did what, when) — read the audit trail
  ipcMain.handle('stocks:transferHistory', (_e, transferId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT h.id, h.status, h.notes, h.quantity, h.created_at,
               u.name  AS actor_name,
               fb.name AS from_branch_name,
               tb.name AS to_branch_name
        FROM stock_transfer_history h
        LEFT JOIN users    u  ON u.id  = h.created_by
        LEFT JOIN branches fb ON fb.id = h.from_branch_id
        LEFT JOIN branches tb ON tb.id = h.to_branch_id
        WHERE h.transfer_id = ?
        ORDER BY h.created_at ASC, h.id ASC
      `).all(transferId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  // Multi-branch summary for admin overview
  ipcMain.handle('stocks:branchSummary', () => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT b.id, b.name, b.code, b.address, b.is_active,
          COUNT(DISTINCT s.product_id)  AS product_count,
          COALESCE(SUM(s.quantity), 0)  AS total_units,
          COALESCE(SUM(s.quantity * COALESCE(p.cost_price, 0)), 0) AS total_value,
          COUNT(CASE WHEN s.quantity > 0 AND s.quantity <= p.min_stock_level
                     AND p.min_stock_level > 0 THEN 1 END) AS low_stock_count,
          COUNT(CASE WHEN s.quantity = 0 THEN 1 END) AS out_of_stock_count,
          (SELECT COUNT(*) FROM stock_transfers st
           WHERE st.to_branch_id = b.id AND st.status = 'pending_approval') AS pending_requests,
          (SELECT COUNT(*) FROM stock_transfers st
           WHERE st.to_branch_id = b.id AND st.status IN ('approved','dispatched','in_transit')) AS in_transit_count
        FROM branches b
        LEFT JOIN stocks     s ON s.branch_id = b.id
        LEFT JOIN products   p ON p.id = s.product_id AND p.is_active = 1
        WHERE b.is_active = 1
        GROUP BY b.id
        ORDER BY b.name
      `).all()
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  // Branch stock with product details (low-stock items first)
  ipcMain.handle('stocks:branchDetail', (_e, branchId: string) => {
    try {
      const db = getDb()
      const rows = db.prepare(`
        SELECT s.id, s.product_id, s.quantity, s.damaged_qty,
          p.name AS product_name, p.sku, p.image_url, p.unit,
          p.min_stock_level, p.selling_price, p.cost_price,
          p.category_id, cat.name AS category_name,
          CASE
            WHEN s.quantity = 0 THEN 'out'
            WHEN s.quantity <= p.min_stock_level AND p.min_stock_level > 0 THEN 'low'
            ELSE 'ok'
          END AS stock_status
        FROM stocks s
        JOIN products p   ON p.id = s.product_id AND p.is_active = 1
        LEFT JOIN categories cat ON cat.id = p.category_id
        WHERE s.branch_id = ?
        ORDER BY
          CASE WHEN s.quantity = 0 THEN 0
               WHEN s.quantity <= p.min_stock_level THEN 1
               ELSE 2 END,
          p.name
      `).all(branchId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:list', () => {
    try {
      const db = getDb()
      const branchId = currentBranchId()
      const rows = db.prepare(`
        SELECT scs.*, b.name as branch_name, w.name as warehouse_name,
          COUNT(sci.id) as item_count,
          SUM(CASE WHEN sci.counted_qty IS NOT NULL AND sci.counted_qty != sci.system_qty THEN 1 ELSE 0 END) as variance_count
        FROM stock_count_sessions scs
        LEFT JOIN branches b ON b.id = scs.branch_id
        LEFT JOIN warehouses w ON w.id = scs.warehouse_id
        LEFT JOIN stock_count_items sci ON sci.session_id = scs.id
        WHERE scs.branch_id = ?
        GROUP BY scs.id
        ORDER BY scs.created_at DESC
      `).all(branchId)
      return { success: true, data: rows }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:create', async (_e, payload: Record<string, unknown> = {}) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const branchId = currentBranchId()
      const id = crypto.randomUUID()
      db.transaction(() => {
        db.prepare(`
          INSERT INTO stock_count_sessions (id, branch_id, warehouse_id, notes, created_by)
          VALUES (?, ?, ?, ?, ?)
        `).run(id, branchId, payload.warehouse_id || null, payload.notes || null, user?.id || null)

        const products = db.prepare(`
          SELECT p.id, COALESCE(s.quantity, 0) as quantity
          FROM products p
          LEFT JOIN stocks s ON s.product_id = p.id AND s.branch_id = ?
          WHERE p.is_active = 1 AND (p.branch_id = ? OR p.branch_id IS NULL)
          ORDER BY p.name
        `).all(branchId, branchId) as { id: string; quantity: number }[]

        for (const product of products) {
          db.prepare(`
            INSERT INTO stock_count_items (id, session_id, product_id, system_qty)
            VALUES (?, ?, ?, ?)
          `).run(crypto.randomUUID(), id, product.id, product.quantity || 0)
        }
      })()
      await enqueuSync('stock_count_sessions', id, 'INSERT', { id, branch_id: branchId, notes: payload.notes || null })
      return { success: true, data: { id } }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:get', (_e, id: string) => {
    try {
      const db = getDb()
      const session = db.prepare(`
        SELECT scs.*, b.name as branch_name, w.name as warehouse_name
        FROM stock_count_sessions scs
        LEFT JOIN branches b ON b.id = scs.branch_id
        LEFT JOIN warehouses w ON w.id = scs.warehouse_id
        WHERE scs.id = ?
      `).get(id) as Record<string, unknown> | undefined
      if (!session) return { success: false, error: 'Stock count not found' }
      const items = db.prepare(`
        SELECT sci.*, p.name as product_name, p.sku, p.unit
        FROM stock_count_items sci
        LEFT JOIN products p ON p.id = sci.product_id
        WHERE sci.session_id = ?
        ORDER BY p.name
      `).all(id)
      return { success: true, data: { ...session, items } }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:updateItem', async (_e, sessionId: string, itemId: string, countedQty: number) => {
    try {
      const db = getDb()
      db.prepare(`
        UPDATE stock_count_items SET counted_qty = ?, updated_at = datetime('now')
        WHERE id = ? AND session_id = ?
      `).run(countedQty, itemId, sessionId)
      await enqueuSync('stock_count_items', itemId, 'UPDATE', { id: itemId, session_id: sessionId, counted_qty: countedQty })
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:finalize', async (_e, id: string) => {
    try {
      const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown> | undefined
      const session = db.prepare('SELECT * FROM stock_count_sessions WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!session) return { success: false, error: 'Stock count not found' }
      if (session.status === 'completed') return { success: false, error: 'Stock count already completed' }
      const items = db.prepare('SELECT * FROM stock_count_items WHERE session_id=? AND counted_qty IS NOT NULL').all(id) as Record<string, unknown>[]
      const movementRecords: Record<string, unknown>[] = []

      db.transaction(() => {
        for (const item of items) {
          const existing = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?')
            .get(item.product_id, session.branch_id) as { id: string; quantity?: number } | undefined
          const previousQty = existing
            ? Number((db.prepare('SELECT quantity FROM stocks WHERE id=?').get(existing.id) as { quantity: number } | undefined)?.quantity || 0)
            : 0
          const countedQty = Number(item.counted_qty || 0)
          if (existing) {
            db.prepare("UPDATE stocks SET quantity=?, updated_at=datetime('now') WHERE id=?")
              .run(countedQty, existing.id)
          } else {
            db.prepare('INSERT INTO stocks (id, product_id, branch_id, quantity) VALUES (?,?,?,?)')
              .run(crypto.randomUUID(), item.product_id, session.branch_id, countedQty)
          }
          const delta = countedQty - previousQty
          if (delta !== 0) {
            movementRecords.push(insertStockMovement(db, {
              product_id: String(item.product_id),
              from_branch_id: delta < 0 ? String(session.branch_id) : null,
              to_branch_id: delta > 0 ? String(session.branch_id) : null,
              quantity: Math.abs(delta),
              movement_type: 'ADJUSTMENT',
              notes: `Stock count finalized: ${previousQty} to ${countedQty}`,
              created_by: (user?.id as string) || null,
            }))
          }
        }
        db.prepare(`
          UPDATE stock_count_sessions
          SET status='completed', completed_by=?, completed_at=datetime('now'), updated_at=datetime('now')
          WHERE id=?
        `).run(user?.id || null, id)
      })()
      await enqueuSync('stock_count_sessions', id, 'UPDATE', { id, status: 'completed' })
      for (const movement of movementRecords) {
        await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
      }
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:cancel', async (_e, id: string) => {
    try {
      getDb().prepare(`UPDATE stock_count_sessions SET status='cancelled', updated_at=datetime('now') WHERE id=?`).run(id)
      await enqueuSync('stock_count_sessions', id, 'UPDATE', { id, status: 'cancelled' })
      return { success: true }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:exportCsv', async (_e, sessionId: string) => {
    try {
      const result = await dialog.showSaveDialog({
        title: 'Export Stock Count CSV',
        defaultPath: `stock-count-${new Date().toISOString().slice(0, 10)}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }]
      })
      if (result.canceled || !result.filePath) return { success: false, error: 'Cancelled' }

      const rows = getDb().prepare(`
        SELECT sci.id as item_id, sci.product_id, p.sku, p.name as product_name, p.unit,
               sci.system_qty, COALESCE(sci.counted_qty, '') as counted_qty, COALESCE(sci.notes, '') as notes
        FROM stock_count_items sci
        LEFT JOIN products p ON p.id = sci.product_id
        WHERE sci.session_id = ?
        ORDER BY p.name
      `).all(sessionId) as Record<string, unknown>[]
      const headers = ['item_id', 'product_id', 'sku', 'product_name', 'unit', 'system_qty', 'counted_qty', 'notes']
      const csv = [headers.join(','), ...rows.map(row => headers.map(h => csvCell(row[h])).join(','))].join('\r\n')
      fs.writeFileSync(result.filePath, csv, 'utf8')
      return { success: true, data: { exported: rows.length, path: result.filePath } }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('stockCounts:importCsv', async (_e, sessionId: string) => {
    try {
      const { filePaths } = await dialog.showOpenDialog({
        title: 'Import Stock Count CSV',
        filters: [{ name: 'CSV', extensions: ['csv'] }],
        properties: ['openFile']
      })
      if (!filePaths || filePaths.length === 0) return { success: false, error: 'Cancelled' }

      const text = fs.readFileSync(filePaths[0], 'utf8')
      const lines = text.split(/\r?\n/).filter(Boolean)
      if (lines.length < 2) return { success: false, error: 'CSV has no rows' }
      const headers = parseCsvLine(lines[0]).map(h => h.trim().toLowerCase())
      const idx = (name: string) => headers.indexOf(name)
      const itemIdx = idx('item_id')
      const skuIdx = idx('sku')
      const countIdx = idx('counted_qty')
      if (countIdx < 0) return { success: false, error: 'CSV must include counted_qty column' }

      const db = getDb()
      let imported = 0
      db.transaction(() => {
        for (const line of lines.slice(1)) {
          const cols = parseCsvLine(line)
          const counted = parseInt(cols[countIdx])
          if (Number.isNaN(counted) || counted < 0) continue
          let item: { id: string } | undefined
          if (itemIdx >= 0 && cols[itemIdx]) {
            item = db.prepare('SELECT id FROM stock_count_items WHERE id=? AND session_id=?')
              .get(cols[itemIdx], sessionId) as { id: string } | undefined
          }
          if (!item && skuIdx >= 0 && cols[skuIdx]) {
            item = db.prepare(`
              SELECT sci.id FROM stock_count_items sci
              JOIN products p ON p.id = sci.product_id
              WHERE sci.session_id=? AND p.sku=?
            `).get(sessionId, cols[skuIdx]) as { id: string } | undefined
          }
          if (!item) continue
          db.prepare('UPDATE stock_count_items SET counted_qty=?, updated_at=datetime("now") WHERE id=?')
            .run(counted, item.id)
          imported++
        }
      })()
      return { success: true, data: { imported } }
    } catch (err) { return { success: false, error: (err as Error).message } }
  })
}
