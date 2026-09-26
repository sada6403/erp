import { shell, type IpcMain } from 'electron'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import Store from 'electron-store'
import { syncStockRow } from '../services/stockSync'
import { safeHandleModule } from './ipcHandler'
import { sendEmail } from '../services/emailService'
import { sendWhatsApp } from '../services/whatsappService'

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

export async function sendSupplierOrderNotification(
  poId: string,
  options?: { openWhatsApp?: boolean; sendEmail?: boolean }
) {
  const db = getDb()
  const po = db.prepare(`
    SELECT po.*, s.name as supplier_name, s.business_name as supplier_business_name,
           s.email as supplier_email, s.mobile_number as supplier_mobile, s.phone as supplier_phone,
           b.name as branch_name, b.code as branch_code
    FROM purchase_orders po
    LEFT JOIN suppliers s ON s.id = po.supplier_id
    LEFT JOIN branches b  ON b.id  = po.branch_id
    WHERE po.id=?
  `).get(poId) as Record<string, unknown> | undefined

  if (!po) throw new Error('Purchase order not found')

  const items = db.prepare(`
    SELECT pi.*, p.name as product_name, p.sku, p.unit
    FROM purchase_items pi
    LEFT JOIN products p ON p.id = pi.product_id
    WHERE pi.po_id=?
  `).all(poId) as Record<string, unknown>[]

  const supplierName = String(po.supplier_business_name || po.supplier_name || 'Valued Supplier')
  const branchName = String(po.branch_name || 'Main Plantation Facility')
  const poNumber = String(po.po_number || po.id)
  const totalAmount = Number(po.total_amount || 0)
  const orderDate = new Date().toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  })
  const expectedDate = po.expected_date ? new Date(String(po.expected_date)).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric'
  }) : null

  // Phone number sanitation
  const rawPhone = String(po.supplier_mobile || po.supplier_phone || '').trim()
  let cleanPhone = rawPhone.replace(/[^0-9]/g, '')
  if (cleanPhone.length === 10) cleanPhone = '91' + cleanPhone

  // WhatsApp formatted text
  const itemsText = items.map((it, idx) => {
    const pName = String(it.product_name || 'Item')
    const sku = it.sku ? ` (${it.sku})` : ''
    const qty = `${it.quantity} ${it.unit || 'units'}`
    const rate = `₹${Number(it.unit_cost || 0).toLocaleString('en-IN')}`
    const total = `₹${Number(it.line_total || 0).toLocaleString('en-IN')}`
    return `${idx + 1}. *${pName}*${sku}\n   📦 Qty: *${qty}* | Rate: ${rate} | Total: *${total}*`
  }).join('\n\n')

  const waText =
`🌱 *NEW PURCHASE ORDER — NATURAL PLANTATION ERP*
────────────────────────────
📋 *PO Number:* ${poNumber}
🏢 *To Supplier:* ${supplierName}
📅 *Order Date:* ${orderDate}
📍 *Delivery Facility:* ${branchName}
${expectedDate ? `⏳ *Expected Delivery:* ${expectedDate}\n` : ''}────────────────────────────
*ORDERED ITEMS:*
${itemsText}
────────────────────────────
💰 *NET TOTAL ORDER VALUE:* ₹${totalAmount.toLocaleString('en-IN')}
${po.notes ? `📝 *Notes/Instructions:* ${po.notes}\n` : ''}
Please confirm order acceptance and dispatch schedule at your earliest convenience.
Thank you for your partnership!
*Natural Plantation & Bio-Harvest Co.*`

  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodeURIComponent(waText)}` : ''

  // Email HTML template
  const emailHtml = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f4f6f8; margin: 0; padding: 24px; color: #1e293b; }
    .container { max-width: 650px; margin: 0 auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.08); border: 1px solid #e2e8f0; }
    .header { background: linear-gradient(135deg, #15803d, #166534); padding: 32px 28px; color: #ffffff; }
    .header h1 { margin: 0 0 8px 0; font-size: 22px; font-weight: 700; letter-spacing: 0.5px; }
    .header p { margin: 0; opacity: 0.9; font-size: 14px; }
    .badge { display: inline-block; background: #dcfce7; color: #15803d; font-weight: 600; font-size: 12px; padding: 4px 10px; border-radius: 9999px; margin-top: 10px; }
    .content { padding: 28px; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; background: #f8fafc; padding: 16px; border-radius: 8px; border: 1px solid #edf2f7; }
    .meta-item { font-size: 13px; }
    .meta-item strong { display: block; color: #64748b; font-size: 11px; text-transform: uppercase; margin-bottom: 2px; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; margin-bottom: 20px; font-size: 13px; }
    th { background: #f1f5f9; color: #475569; font-weight: 600; text-align: left; padding: 10px 12px; border-bottom: 2px solid #cbd5e1; }
    td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; }
    .text-right { text-align: right; }
    .total-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 8px; padding: 16px; text-align: right; font-size: 16px; font-weight: 700; color: #166534; margin-bottom: 24px; }
    .footer { background: #f8fafc; padding: 20px 28px; text-align: center; font-size: 12px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🌱 Natural Plantation Co.</h1>
      <p>Official Purchase Order: <strong>${poNumber}</strong></p>
      <span class="badge">OFFICIAL PURCHASE ORDER</span>
    </div>
    <div class="content">
      <p>Dear <strong>${supplierName}</strong>,</p>
      <p>Please find our purchase order details below. Kindly acknowledge receipt and confirm expected fulfillment schedule.</p>

      <div class="meta-grid">
        <div class="meta-item"><strong>PO Number</strong>${poNumber}</div>
        <div class="meta-item"><strong>Order Date</strong>${orderDate}</div>
        <div class="meta-item"><strong>Deliver To</strong>${branchName}</div>
        <div class="meta-item"><strong>Expected Delivery</strong>${expectedDate || 'Earliest Available'}</div>
      </div>

      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Item / Description</th>
            <th class="text-right">Qty</th>
            <th class="text-right">Unit Rate (₹)</th>
            <th class="text-right">Total (₹)</th>
          </tr>
        </thead>
        <tbody>
          ${items.map((it, idx) => `
            <tr>
              <td>${idx + 1}</td>
              <td><strong>${it.product_name || 'Item'}</strong><br><span style="font-size:11px;color:#64748b;">SKU: ${it.sku || '—'}</span></td>
              <td class="text-right">${it.quantity} ${it.unit || ''}</td>
              <td class="text-right">₹${Number(it.unit_cost || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</td>
              <td class="text-right"><strong>₹${Number(it.line_total || 0).toLocaleString('en-IN', { minimumFractionDigits: 2 })}</strong></td>
            </tr>
          `).join('')}
        </tbody>
      </table>

      <div class="total-box">
        Total Purchase Order Value: ₹${totalAmount.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
      </div>

      ${po.notes ? `<p style="background:#fffbeb;padding:12px;border-left:4px solid #f59e0b;border-radius:4px;font-size:13px;color:#92400e;"><strong>Notes:</strong> ${po.notes}</p>` : ''}
      <p style="font-size:13px;color:#475569;margin-top:20px;">If you have any questions regarding this order, please contact our procurement desk.</p>
    </div>
    <div class="footer">
      Generated automatically by Natural Plantation ERP • Eco-Friendly & Automated Procurement
    </div>
  </div>
</body>
</html>`

  const emailSubject = `Purchase Order ${poNumber} — Natural Plantation ERP`
  const supplierEmail = String(po.supplier_email || '').trim()
  const mailtoUrl = supplierEmail ? `mailto:${supplierEmail}?subject=${encodeURIComponent(emailSubject)}&body=${encodeURIComponent(waText)}` : ''

  let emailResult: { success: boolean; error?: string } = { success: false, error: 'No email address for supplier' }
  if (supplierEmail && options?.sendEmail !== false) {
    try {
      emailResult = await sendEmail({
        to: supplierEmail,
        subject: emailSubject,
        html: emailHtml,
        text: waText,
      })
    } catch (err) {
      emailResult = { success: false, error: String((err as Error).message || err) }
    }
  }

  let waApiResult: { success: boolean; error?: string } = { success: false, error: 'No mobile number for supplier' }
  if (cleanPhone) {
    try {
      waApiResult = await sendWhatsApp({
        to: cleanPhone,
        message: waText,
      })
    } catch (err) {
      waApiResult = { success: false, error: String((err as Error).message || err) }
    }
  }

  if (whatsappUrl && options?.openWhatsApp) {
    try {
      if (typeof shell !== 'undefined' && shell && typeof shell.openExternal === 'function') {
        await shell.openExternal(whatsappUrl)
      }
    } catch (e) {
      console.warn('[WhatsApp] Failed to open external URL:', e)
    }
  }

  return {
    po_number: poNumber,
    supplier_name: supplierName,
    whatsapp: {
      phone: cleanPhone,
      url: whatsappUrl,
      apiResult: waApiResult,
      openedInBrowser: Boolean(whatsappUrl && options?.openWhatsApp),
    },
    email: {
      to: supplierEmail,
      mailtoUrl,
      result: emailResult,
    },
  }
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
      // pack_uom_name/pack_conversion_factor: see the identical pattern (and
      // comment) on stockCounts:get in electron/ipc/stocks.ts — lets Receive
      // Items accept "N boxes + M pcs" for products with a configured pack unit.
      const items = db.prepare(`
        SELECT pi.*, p.name as product_name, p.sku,
          pu.uom_name as pack_uom_name, pu.conversion_factor as pack_conversion_factor
        FROM purchase_items pi
        LEFT JOIN products p ON p.id = pi.product_id
        LEFT JOIN product_uom pu ON pu.id = (
          SELECT id FROM product_uom
          WHERE product_id = pi.product_id AND is_base = 0 AND conversion_factor > 1
          ORDER BY sort_order LIMIT 1
        )
        WHERE pi.po_id=?`).all(id)
      return { success: true, data: { ...po as object, items } }
  })

  // Create PO (starts as DRAFT)
  safeHandleModule(ipcMain, 'purchases:create', 'purchase_orders', async (_e, payload) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const perms = currentPerms()
      if (!perms.all && !perms.inventory) throw new Error('Inventory access required')
      if (!payload.supplier_id)       throw new Error('Supplier is required')
      if (!payload.items?.length)     throw new Error('At least one item is required')
      if (!payload.branch_id && !user?.branch_id) throw new Error('Branch is required')

      // A non-admin can only raise a PO for their own branch — the client's
      // branch_id is only trusted for admins (who legitimately manage POs
      // across branches). Spoofed branch_id from non-admin is ignored.
      const branchId = perms.all ? (payload.branch_id || user?.branch_id as string) : (user?.branch_id as string)
      if (!branchId) throw new Error('Branch is required')
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
      for (const item of items as Record<string, unknown>[]) {
        await enqueuSync('purchase_items', String(item.id), 'INSERT', item)
      }

      let notification = null
      try {
        notification = await sendSupplierOrderNotification(id, {
          openWhatsApp: payload.open_whatsapp !== false,
          sendEmail: payload.send_email !== false,
        })
      } catch (err) {
        console.warn('[PO Notification Warning]', err)
      }

      return { success: true, data: { id, po_number, notification } }
  })

  // Update PO status (DRAFT→SENT→PARTIAL/RECEIVED/CANCELLED)
  safeHandleModule(ipcMain, 'purchases:updateStatus', 'purchase_orders', async (_e, id: string, status: string, payload: Record<string, unknown> = {}) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const perms = currentPerms()
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')

      if (!perms.all && !perms.inventory) throw new Error('Inventory access required')
      if (!perms.all && user?.branch_id && po.branch_id !== user.branch_id) {
        throw new Error('Cannot update a purchase order from another branch')
      }

      const allowed = PO_TRANSITIONS[String(po.status)]
      if (!allowed?.includes(status)) {
        throw new Error(`Cannot move PO from '${po.status}' to '${status}'`)
      }

      // Only a Company Admin can mark stock as received — this is the point
      // new stock actually enters the company (PARTIAL also increments stock
      // and can auto-promote to RECEIVED below, so it's gated too).
      if ((status === 'RECEIVED' || status === 'PARTIAL') && !perms.all) {
        throw new Error('Only a Company Admin can mark a purchase order as received.')
      }

      const now = new Date().toISOString()
      const patch: Record<string, unknown> = { status }

      // When marking RECEIVED or PARTIAL, update received quantities on items and adjust stock
      const receivedItemIds: string[] = []
      const receivedProductIds: string[] = []
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
            receivedItemIds.push(String(poItem.id))

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
              receivedProductIds.push(productId)
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
        for (const itemId of receivedItemIds) {
          const row = db.prepare('SELECT * FROM purchase_items WHERE id=?').get(itemId)
          await enqueuSync('purchase_items', itemId, 'UPDATE', row as Record<string, unknown>)
        }
        for (const productId of receivedProductIds) {
          await syncStockRow(db, productId, String(po.branch_id))
        }
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

      if (status === 'SENT') {
        try {
          await sendSupplierOrderNotification(id, {
            openWhatsApp: payload.open_whatsapp !== false,
            sendEmail: payload.send_email !== false,
          })
        } catch (err) {
          console.warn('[PO Notification on SENT Warning]', err)
        }
      }

      return { success: true }
  })

  // Update draft PO (add/remove/edit items before sending)
  safeHandleModule(ipcMain, 'purchases:update', 'purchase_orders', async (_e, id: string, payload: Record<string, unknown>) => {
    const db = getDb()
      const user = store.get('auth_user') as Record<string, unknown>
      const perms = currentPerms()
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')
      if (!perms.all && !perms.inventory) throw new Error('Inventory access required')
      if (!perms.all && user?.branch_id && po.branch_id !== user.branch_id) {
        throw new Error('Cannot edit a purchase order from another branch')
      }
      if (po.status !== 'DRAFT') throw new Error('Only DRAFT purchase orders can be edited')

      if (payload.items) {
        for (const item of payload.items as Record<string, unknown>[]) {
          if (!item.product_id) throw new Error('Each item must have a product_id')
          const qty = Number(item.quantity) || 0
          const unitCost = Number(item.unit_cost) || 0
          if (qty <= 0) throw new Error('Item quantity must be greater than zero')
          if (unitCost <= 0) throw new Error('Item unit cost must be greater than zero')
        }
      }

      const newItems: Record<string, unknown>[] = []

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
            const itemId = crypto.randomUUID()
            db.prepare(`INSERT INTO purchase_items (id,po_id,product_id,quantity,unit_cost,line_total,received_qty,notes)
              VALUES (?,?,?,?,?,?,0,?)`)
              .run(itemId, id, item.product_id, qty, unitCost, lineTotal, item.notes || null)
            newItems.push({
              id: itemId, po_id: id, product_id: item.product_id, quantity: qty,
              unit_cost: unitCost, line_total: lineTotal, received_qty: 0, notes: item.notes || null,
            })
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
      for (const item of newItems) {
        await enqueuSync('purchase_items', String(item.id), 'INSERT', item)
      }
      return { success: true }
  })

  // Manually trigger WhatsApp/Email notification to supplier for any PO
  safeHandleModule(ipcMain, 'purchases:notifySupplier', 'purchase_orders', async (_e, id: string, options: Record<string, unknown> = {}) => {
    const notification = await sendSupplierOrderNotification(id, {
      openWhatsApp: options.openWhatsApp !== false,
      sendEmail: options.sendEmail !== false,
    })
    return { success: true, data: notification }
  })
}
