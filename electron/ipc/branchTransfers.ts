import type { IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import Store from 'electron-store'
import { insertStockMovement } from '../services/stockMovement'
import { safeHandleModule } from './ipcHandler'

const store = new Store()

function currentUserId(): string | null {
  const user = store.get('auth_user') as Record<string, unknown> | undefined
  return (user?.id as string) || null
}

function logTransferAction(db: ReturnType<typeof getDb>, transferId: string, action: string, oldValues: any = null, newValues: any = null, notes: string | null = null) {
  const logId = crypto.randomUUID()
  const record = {
    id: logId,
    transfer_id: transferId,
    user_id: currentUserId(),
    action,
    old_values: oldValues ? JSON.stringify(oldValues) : null,
    new_values: newValues ? JSON.stringify(newValues) : null,
    notes,
    created_at: new Date().toISOString()
  }
  db.prepare(`
    INSERT INTO branch_transfer_logs (id, transfer_id, user_id, action, old_values, new_values, notes, created_at)
    VALUES (@id, @transfer_id, @user_id, @action, @old_values, @new_values, @notes, @created_at)
  `).run(record)
  return record
}

export function registerBranchTransferHandlers(ipcMain: IpcMain) {
  // Create new branch transfer
  safeHandleModule(ipcMain, 'branchTransfers:create', 'stock_transfers', async (_e, payload: Record<string, any>) => {
    {
      const db = getDb()
      const transferId = crypto.randomUUID()
      const transferNumber = `BTR-${Date.now().toString(36).toUpperCase()}`
      
      const { from_branch_id, to_branch_id, status, items, ...rest } = payload
      
      if (!from_branch_id || !to_branch_id || !items || !items.length) {
        throw new Error('Missing required fields for transfer')
      }

      const transfer: Record<string, any> = {
        id: transferId,
        transfer_number: transferNumber,
        from_branch_id,
        to_branch_id,
        status: status || 'draft',
        created_by: currentUserId(),
        ...rest
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO branch_transfers (
            id, transfer_number, from_branch_id, to_branch_id, status, driver_name, vehicle_number, driver_phone, issuing_officer_name, dispatch_at, expected_delivery_at, notes, created_by
          ) VALUES (
            @id, @transfer_number, @from_branch_id, @to_branch_id, @status, @driver_name, @vehicle_number, @driver_phone, @issuing_officer_name, @dispatch_at, @expected_delivery_at, @notes, @created_by
          )
        `).run({
          id: transferId,
          transfer_number: transferNumber,
          from_branch_id,
          to_branch_id,
          status: transfer.status,
          driver_name: transfer.driver_name || null,
          vehicle_number: transfer.vehicle_number || null,
          driver_phone: transfer.driver_phone || null,
          issuing_officer_name: transfer.issuing_officer_name || null,
          dispatch_at: transfer.status === 'dispatched' ? new Date().toISOString() : (transfer.dispatch_at || null),
          expected_delivery_at: transfer.expected_delivery_at || null,
          notes: transfer.notes || null,
          created_by: transfer.created_by
        })

        const insertedItems = []
        for (const item of items) {
          const itemId = crypto.randomUUID()
          const itemRecord = {
            id: itemId,
            transfer_id: transferId,
            product_id: item.product_id,
            quantity: Number(item.quantity),
            unit: item.unit || null,
            package_count: Number(item.package_count || 0),
            serial_batch_no: item.serial_batch_no || null,
            description: item.description || null
          }
          db.prepare(`
            INSERT INTO branch_transfer_items (
              id, transfer_id, product_id, quantity, unit, package_count, serial_batch_no, description
            ) VALUES (
              @id, @transfer_id, @product_id, @quantity, @unit, @package_count, @serial_batch_no, @description
            )
          `).run(itemRecord)
          insertedItems.push(itemRecord)

          // If directly dispatched, reserve/deduct stock immediately
          if (transfer.status === 'dispatched') {
            const qty = Number(item.quantity)
            const changed = db.prepare(`
              UPDATE stocks SET quantity=quantity-?, updated_at=datetime('now')
              WHERE product_id=? AND branch_id=? AND quantity>=?
            `).run(qty, item.product_id, from_branch_id, qty)
            
            if (!changed.changes) throw new Error(`Insufficient stock for product ${item.product_id}`)
            
            insertStockMovement(db, {
              product_id: item.product_id,
              from_branch_id,
              to_branch_id,
              quantity: qty,
              movement_type: 'TRANSFER',
              reference_transfer_id: transferId,
              notes: `Branch Transfer Out: ${transferNumber}`,
              created_by: currentUserId()
            })
          }
        }

        logTransferAction(db, transferId, 'CREATED', null, { status: transfer.status, items: items.length })
      })()

      // Enqueue syncs after transaction
      const savedTransfer = db.prepare('SELECT * FROM branch_transfers WHERE id = ?').get(transferId)
      const savedItems = db.prepare('SELECT * FROM branch_transfer_items WHERE transfer_id = ?').all(transferId)
      
      await enqueuSync('branch_transfers', transferId, 'INSERT', savedTransfer as Record<string, any>)
      for (const item of savedItems) {
        await enqueuSync('branch_transfer_items', String((item as any).id), 'INSERT', item as Record<string, any>)
      }

      return { success: true, data: { id: transferId, transfer_number: transferNumber } }
    }
  })

  // List branch transfers
  safeHandleModule(ipcMain, 'branchTransfers:list', 'stock_transfers', (_e, filters: Record<string, any> = {}) => {
    {
      const db = getDb()
      let sql = `
        SELECT bt.*, 
               fb.name as from_branch_name, 
               tb.name as to_branch_name,
               u.name as created_by_name
        FROM branch_transfers bt
        LEFT JOIN branches fb ON fb.id = bt.from_branch_id
        LEFT JOIN branches tb ON tb.id = bt.to_branch_id
        LEFT JOIN users u ON u.id = bt.created_by
        WHERE 1=1
      `
      const params: any[] = []
      
      if (filters.status) {
        sql += ' AND bt.status = ?'
        params.push(filters.status)
      }
      
      if (filters.branch_id) {
        sql += ' AND (bt.from_branch_id = ? OR bt.to_branch_id = ?)'
        params.push(filters.branch_id, filters.branch_id)
      }

      sql += ' ORDER BY bt.created_at DESC LIMIT 200'
      const rows = db.prepare(sql).all(...params)
      return { success: true, data: rows }
    }
  })

  // Get transfer by ID with items, logs, mismatches
  safeHandleModule(ipcMain, 'branchTransfers:getById', 'stock_transfers', (_e, id: string) => {
    {
      const db = getDb()
      const transfer = db.prepare(`
        SELECT bt.*, 
               fb.name as from_branch_name, fb.address as from_branch_address, fb.phone as from_branch_phone,
               tb.name as to_branch_name, tb.address as to_branch_address, tb.phone as to_branch_phone,
               u.name as created_by_name
        FROM branch_transfers bt
        LEFT JOIN branches fb ON fb.id = bt.from_branch_id
        LEFT JOIN branches tb ON tb.id = bt.to_branch_id
        LEFT JOIN users u ON u.id = bt.created_by
        WHERE bt.id = ?
      `).get(id) as Record<string, any> | undefined

      if (!transfer) return { success: false, error: 'Transfer not found' }

      const items = db.prepare(`
        SELECT bti.*, p.name as product_name, p.sku, p.barcode
        FROM branch_transfer_items bti
        LEFT JOIN products p ON p.id = bti.product_id
        WHERE bti.transfer_id = ?
      `).all(id)

      const mismatches = db.prepare(`
        SELECT m.*, bti.product_id, p.name as product_name
        FROM branch_transfer_mismatches m
        LEFT JOIN branch_transfer_items bti ON bti.id = m.item_id
        LEFT JOIN products p ON p.id = bti.product_id
        WHERE m.transfer_id = ?
        ORDER BY m.created_at DESC
      `).all(id)

      const logs = db.prepare(`
        SELECT l.*, u.name as user_name
        FROM branch_transfer_logs l
        LEFT JOIN users u ON u.id = l.user_id
        WHERE l.transfer_id = ?
        ORDER BY l.created_at DESC
      `).all(id)

      const prints = db.prepare(`
        SELECT p.*, u.name as printed_by_name
        FROM branch_transfer_prints p
        LEFT JOIN users u ON u.id = p.printed_by
        WHERE p.transfer_id = ?
        ORDER BY p.created_at DESC
      `).all(id)

      return { success: true, data: { ...transfer, items, mismatches, logs, prints } }
    }
  })

  // Update status (e.g. dispatch)
  safeHandleModule(ipcMain, 'branchTransfers:updateStatus', 'stock_transfers', async (_e, id: string, status: string, payload: any = {}) => {
    {
      const db = getDb()
      const transfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id) as Record<string, any>
      if (!transfer) throw new Error('Transfer not found')
      
      const now = new Date().toISOString()
      const patch: any = { status }
      
      if (status === 'approved') {
        patch.approved_by = currentUserId()
      }
      
      if (status === 'dispatched') {
        patch.dispatch_at = now
        if (!transfer.approved_by) {
          patch.approved_by = currentUserId()
        }
        if (payload.driver_name) patch.driver_name = payload.driver_name
        if (payload.driver_phone) patch.driver_phone = payload.driver_phone
        if (payload.vehicle_number) patch.vehicle_number = payload.vehicle_number
        if (payload.issuing_officer_name) patch.issuing_officer_name = payload.issuing_officer_name
      }

      db.transaction(() => {
        // If dispatching, deduct stock
        if (status === 'dispatched' && transfer.status !== 'dispatched') {
          const items = db.prepare('SELECT * FROM branch_transfer_items WHERE transfer_id=?').all(id) as any[]
          for (const item of items) {
            const qty = Number(item.quantity)
            const changed = db.prepare(`
              UPDATE stocks SET quantity=quantity-?, updated_at=datetime('now')
              WHERE product_id=? AND branch_id=? AND quantity>=?
            `).run(qty, item.product_id, transfer.from_branch_id, qty)
            
            if (!changed.changes) throw new Error(`Insufficient stock for product ${item.product_id}`)
            
            insertStockMovement(db, {
              product_id: item.product_id,
              from_branch_id: String(transfer.from_branch_id),
              to_branch_id: String(transfer.to_branch_id),
              quantity: qty,
              movement_type: 'TRANSFER',
              reference_transfer_id: id,
              notes: `Branch Transfer Out: ${transfer.transfer_number}`,
              created_by: currentUserId()
            })
          }
        }

        const fields = Object.keys(patch).map(k => `${k}=@${k}`).join(',')
        db.prepare(`UPDATE branch_transfers SET ${fields}, updated_at=datetime('now') WHERE id=@id`)
          .run({ id, ...patch })
          
        logTransferAction(db, id, `STATUS_${status.toUpperCase()}`, { status: transfer.status }, patch)
      })()

      await enqueuSync('branch_transfers', id, 'UPDATE', { id, ...patch })
      return { success: true }
    }
  })

  // Receive transfer items
  safeHandleModule(ipcMain, 'branchTransfers:receive', 'stock_transfers', async (_e, id: string, payload: any) => {
    {
      const db = getDb()
      const transfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id) as Record<string, any>
      if (!transfer) throw new Error('Transfer not found')
      
      const { items, received_by_name, received_designation, notes } = payload
      // items should be [{ item_id, received_qty, damaged_qty }]
      
      const now = new Date().toISOString()
      let totalSent = 0
      let totalReceived = 0
      let hasMismatch = false
      const newMismatches: any[] = []

      db.transaction(() => {
        for (const input of items) {
          const item = db.prepare('SELECT * FROM branch_transfer_items WHERE id=?').get(input.item_id) as any
          if (!item) continue
          
          const sent = Number(item.quantity)
          const rec = Number(input.received_qty || 0)
          const dam = Number(input.damaged_qty || 0)
          const missing = sent - rec - dam
          
          totalSent += sent
          totalReceived += rec
          
          if (missing !== 0 || dam > 0) {
            hasMismatch = true
            const mismatchId = crypto.randomUUID()
            const mismatchRecord = {
              id: mismatchId,
              transfer_id: id,
              item_id: item.id,
              missing_qty: missing,
              damaged_qty: dam,
              reason_category: missing > 0 ? 'Missing Quantity' : 'Damaged Goods',
              detailed_reason: notes || 'Automated mismatch creation upon receipt.',
              status: 'under_admin_review',
              reported_by: currentUserId(),
              created_at: now,
              updated_at: now
            }
            db.prepare(`
              INSERT INTO branch_transfer_mismatches (
                id, transfer_id, item_id, missing_qty, damaged_qty, reason_category, detailed_reason, reported_by, status, created_at, updated_at
              ) VALUES (
                @id, @transfer_id, @item_id, @missing_qty, @damaged_qty, @reason_category, @detailed_reason, @reported_by, @status, @created_at, @updated_at
              )
            `).run(mismatchRecord)
            newMismatches.push(mismatchRecord)
          }

          // Update item
          db.prepare(`
            UPDATE branch_transfer_items 
            SET received_qty=?, damaged_qty=?, missing_qty=?, updated_at=datetime('now')
            WHERE id=?
          `).run(rec, dam, missing, item.id)

          // Add to dest stock
          if (rec > 0) {
            const dest = db.prepare('SELECT id FROM stocks WHERE product_id=? AND branch_id=?')
              .get(item.product_id, transfer.to_branch_id) as { id: string } | undefined
            
            if (dest) {
              db.prepare(`UPDATE stocks SET quantity=quantity+?, damaged_qty=damaged_qty+?, updated_at=datetime('now') WHERE id=?`)
                .run(rec, dam, dest.id)
            } else {
              db.prepare(`INSERT INTO stocks (id,product_id,branch_id,quantity,damaged_qty) VALUES (?,?,?,?,?)`)
                .run(crypto.randomUUID(), item.product_id, transfer.to_branch_id, rec, dam)
            }

            insertStockMovement(db, {
              product_id: item.product_id,
              from_branch_id: String(transfer.from_branch_id),
              to_branch_id: String(transfer.to_branch_id),
              quantity: rec,
              movement_type: 'RECEIVE',
              reference_transfer_id: id,
              notes: `Branch Transfer Received: ${transfer.transfer_number}`,
              created_by: currentUserId()
            })
          }
        }

        const newStatus = hasMismatch ? 'discrepancy' : (totalReceived < totalSent ? 'partially_received' : 'received')
        
        db.prepare(`
          UPDATE branch_transfers 
          SET status=?, actual_delivery_at=?, received_by=?, received_by_name=?, received_designation=?, notes=COALESCE(notes || '\n', '') || ?, updated_at=datetime('now')
          WHERE id=?
        `).run(newStatus, now, currentUserId(), received_by_name || null, received_designation || null, notes || '', id)

        logTransferAction(db, id, 'RECEIVED', { status: transfer.status }, { status: newStatus, received_by_name })
      })()

      // sync updates
      const updatedTransfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id)
      const updatedItems = db.prepare('SELECT * FROM branch_transfer_items WHERE transfer_id=?').all(id)
      await enqueuSync('branch_transfers', id, 'UPDATE', updatedTransfer as Record<string, any>)
      for (const item of updatedItems) {
        await enqueuSync('branch_transfer_items', String((item as any).id), 'UPDATE', item as Record<string, any>)
      }
      for (const m of newMismatches) {
        await enqueuSync('branch_transfer_mismatches', m.id, 'INSERT', m)
      }

      return { success: true }
    }
  })

  // Report mismatch specifically
  safeHandleModule(ipcMain, 'branchTransfers:reportMismatch', 'stock_transfers', async (_e, id: string, payload: any) => {
    {
      const db = getDb()
      const transfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id) as Record<string, any>
      if (!transfer) throw new Error('Transfer not found')
      
      const { item_id, reason_category, detailed_reason } = payload
      
      const item = db.prepare('SELECT * FROM branch_transfer_items WHERE id=?').get(item_id) as any
      if (!item) throw new Error('Item not found')

      const mismatchId = crypto.randomUUID()
      const mismatch = {
        id: mismatchId,
        transfer_id: id,
        item_id,
        missing_qty: Number(item.missing_qty || 0),
        damaged_qty: Number(item.damaged_qty || 0),
        reason_category,
        detailed_reason,
        reported_by: currentUserId(),
        status: 'under_admin_review'
      }

      db.transaction(() => {
        db.prepare(`
          INSERT INTO branch_transfer_mismatches (
            id, transfer_id, item_id, missing_qty, damaged_qty, reason_category, detailed_reason, reported_by, status
          ) VALUES (
            @id, @transfer_id, @item_id, @missing_qty, @damaged_qty, @reason_category, @detailed_reason, @reported_by, @status
          )
        `).run(mismatch)

        db.prepare(`UPDATE branch_transfers SET status='under_admin_review', updated_at=datetime('now') WHERE id=?`).run(id)
        
        logTransferAction(db, id, 'MISMATCH_REPORTED', null, mismatch)
      })()

      await enqueuSync('branch_transfer_mismatches', mismatchId, 'INSERT', mismatch)
      await enqueuSync('branch_transfers', id, 'UPDATE', { id, status: 'under_admin_review' })

      return { success: true }
    }
  })

  // Log print
  safeHandleModule(ipcMain, 'branchTransfers:logPrint', 'stock_transfers', async (_e, id: string) => {
    {
      const db = getDb()
      const logId = crypto.randomUUID()
      const log = {
        id: logId,
        transfer_id: id,
        printed_by: currentUserId(),
        print_type: 'print'
      }
      db.prepare(`INSERT INTO branch_transfer_prints (id, transfer_id, printed_by, print_type) VALUES (@id, @transfer_id, @printed_by, @print_type)`).run(log)
      await enqueuSync('branch_transfer_prints', logId, 'INSERT', log)
      return { success: true }
    }
  })

  // Resolve mismatch
  safeHandleModule(ipcMain, 'branchTransfers:resolveMismatch', 'stock_transfers', async (_e, id: string, payload: any) => {
    {
      const db = getDb()
      const transfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id) as Record<string, any>
      if (!transfer) throw new Error('Transfer not found')
      
      const { admin_reason } = payload
      
      db.transaction(() => {
        db.prepare(`
          UPDATE branch_transfer_mismatches 
          SET status='resolved', admin_reason=?, resolved_by=?, updated_at=datetime('now')
          WHERE transfer_id=?
        `).run(admin_reason || 'Resolved by Administrator', currentUserId(), id)
        
        db.prepare(`
          UPDATE branch_transfers
          SET status='corrected', updated_at=datetime('now')
          WHERE id=?
        `).run(id)
        
        logTransferAction(db, id, 'MISMATCH_RESOLVED', { status: transfer.status }, { status: 'corrected', admin_reason })
      })()

      const updatedTransfer = db.prepare('SELECT * FROM branch_transfers WHERE id=?').get(id)
      await enqueuSync('branch_transfers', id, 'UPDATE', updatedTransfer as Record<string, any>)
      
      const updatedMismatches = db.prepare('SELECT * FROM branch_transfer_mismatches WHERE transfer_id=?').all(id) as any[]
      for (const m of updatedMismatches) {
        await enqueuSync('branch_transfer_mismatches', m.id, 'UPDATE', m)
      }
      
      return { success: true }
    }
  })
}
