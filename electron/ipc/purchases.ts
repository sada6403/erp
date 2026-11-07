import { listPurchaseBills, type BillHistoryFilters } from '../services/purchaseBillHistory'
import { applyReceiptProductPrices, repairMissingReceiptPrices } from '../services/receiptProductPricing'
import { createStockPurchase } from '../services/purchaseEntry'
import { stagePurchaseBills, persistStagedBills, completeStagedBills, discardStagedBills, requireSavedPurchaseBill } from '../services/purchaseBills'
import { usesSupermarketStock } from '../services/supermarketModule'
import { BrowserWindow, dialog, shell, type IpcMain } from 'electron'
import fs from 'fs'
import path from 'path'
import { getDb } from '../database'
import crypto from 'crypto'
import { enqueuSync } from '../services/syncQueue'
import { logAudit } from '../services/auditLog'
import { createCompanyStore, getWorkspaceDataPath } from '../services/companyWorkspace'
import { syncStockRow } from '../services/stockSync'
import { insertStockMovement } from '../services/stockMovement'
import { safeHandleModule } from './ipcHandler'
import { sendEmail } from '../services/emailService'
import { sendWhatsApp } from '../services/whatsappService'
import { canManageProcurement, resolveMainBranchId } from '../services/branchAccess'
import { importPOsFromExcel, downloadPOTemplate } from '../services/purchaseImportExport'
import { createReceiptBatch } from '../services/batchInventory'

const store = createCompanyStore()

async function publishProductPrices(productIds:string[]) {
  const db=getDb()
  for(const id of new Set(productIds)) {
    const row=db.prepare('SELECT * FROM products WHERE id=?').get(id) as Record<string,unknown>
    if(row) await enqueuSync('products',id,'UPDATE',row)
  }
  for(const win of BrowserWindow.getAllWindows()) win.webContents.send('products:updated',{product_ids:productIds})
}

function requireMainBranchProcurement(): { user: Record<string, unknown>; mainBranchId: string } {
  const db = getDb()
  const user = (store.get('auth_user') as Record<string, unknown> | undefined) || {}
  if (!canManageProcurement(db, user)) {
    throw new Error('Purchase orders and supplier procurement are available only at the main branch')
  }
  return { user, mainBranchId: resolveMainBranchId(db) }
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
  options?: { openWhatsApp?: boolean; sendEmail?: boolean; sendWhatsAppApi?: boolean }
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

  // Click-to-chat requires an international number without `+`, spaces, or a
  // local trunk prefix. Supplier records in this installation commonly store
  // Sri Lankan mobiles as 07XXXXXXXX, so convert only that local form to 94...
  // Numbers already entered with an international prefix (for example +94 or
  // +91) are preserved and never have a second country code prepended.
  const rawPhone = String(po.supplier_mobile || po.supplier_phone || '').trim()
  const phoneDigits = rawPhone.replace(/[^0-9]/g, '')
  const cleanPhone = rawPhone.startsWith('00')
    ? phoneDigits.slice(2)
    : phoneDigits.length === 10 && phoneDigits.startsWith('0')
      ? `94${phoneDigits.slice(1)}`
      : phoneDigits.length === 9 && phoneDigits.startsWith('7')
        ? `94${phoneDigits}`
        : phoneDigits

  // WhatsApp formatted text
  const itemsText = items.map((it, idx) => {
    const pName = String(it.product_name || 'Item')
    const sku = it.sku ? ` (${it.sku})` : ''
    const qty = `${it.quantity} ${it.unit || 'units'}`
    const rate = `Rs.${Number(it.unit_cost || 0).toLocaleString('en-LK')}`
    const total = `Rs.${Number(it.line_total || 0).toLocaleString('en-LK')}`
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
💰 *NET TOTAL ORDER VALUE:* Rs.${totalAmount.toLocaleString('en-LK')}
${po.notes ? `📝 *Notes/Instructions:* ${po.notes}\n` : ''}
Please confirm order acceptance and dispatch schedule at your earliest convenience.
Thank you for your partnership!
*Natural Plantation & Bio-Harvest Co.*`

  const encodedWhatsAppText = encodeURIComponent(waText)
  const whatsappAppUrl = cleanPhone ? `whatsapp://send?phone=${cleanPhone}&text=${encodedWhatsAppText}` : ''
  const whatsappUrl = cleanPhone ? `https://wa.me/${cleanPhone}?text=${encodedWhatsAppText}` : ''

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

  let waApiResult: { success: boolean; error?: string } = { success: false, error: 'Business API delivery not requested' }
  // The normal PO WhatsApp action is a manual compose flow: open the exact
  // supplier chat with this message pre-filled, leaving only the Send button
  // for the user. Business API delivery is opt-in and never happens merely
  // because the WhatsApp button was clicked.
  if (cleanPhone && options?.sendWhatsAppApi) {
    try {
      waApiResult = await sendWhatsApp({
        to: cleanPhone,
        message: waText,
      })
    } catch (err) {
      waApiResult = { success: false, error: String((err as Error).message || err) }
    }
  }

  let openedInWhatsApp = false
  if (options?.openWhatsApp && !cleanPhone) {
    throw new Error('This supplier does not have a mobile number')
  }
  if (whatsappUrl && options?.openWhatsApp) {
    try {
      if (typeof shell !== 'undefined' && shell && typeof shell.openExternal === 'function') {
        // Use WhatsApp's HTTPS compose endpoint as the primary route. Some
        // WhatsApp Desktop releases report that the whatsapp:// protocol was
        // opened successfully but silently discard its `text` parameter. The
        // wa.me route preserves both the exact phone and the pre-filled order
        // text, then lets the user choose Desktop or Web and press Send.
        await shell.openExternal(whatsappUrl)
        openedInWhatsApp = true
      }
    } catch (e) {
      console.warn('[WhatsApp] Failed to open compose URL:', e)
      throw new Error('Unable to open WhatsApp Desktop or WhatsApp Web')
    }
  }

  return {
    po_number: poNumber,
    supplier_name: supplierName,
    whatsapp: {
      phone: cleanPhone,
      url: whatsappUrl,
      appUrl: whatsappAppUrl,
      message: waText,
      apiResult: waApiResult,
      openedInBrowser: openedInWhatsApp,
    },
    email: {
      to: supplierEmail,
      mailtoUrl,
      result: emailResult,
    },
  }
}

export function registerPurchaseHandlers(ipcMain: IpcMain) {
  safeHandleModule(ipcMain,'purchases:billHistory','purchase_orders',(_e,filters:BillHistoryFilters={})=>{
    const {mainBranchId}=requireMainBranchProcurement();const db=getDb()
    return {success:true,data:{rows:listPurchaseBills(db,mainBranchId,filters),uploaders:db.prepare(`SELECT DISTINCT u.id,u.name FROM purchase_attachments a JOIN purchase_orders po ON po.id=a.purchase_id JOIN users u ON u.id=a.uploaded_by WHERE po.branch_id=? AND a.is_active=1 ORDER BY u.name`).all(mainBranchId)}}
  })
  safeHandleModule(ipcMain,'purchases:chooseBills','purchase_orders',async()=>{
    const {user}=requireMainBranchProcurement()
    const selected=await dialog.showOpenDialog({title:'Select supplier bills',properties:['openFile','multiSelections'],filters:[{name:'Supplier bills',extensions:['pdf','png','jpg','jpeg']}]})
    if(selected.canceled) return {success:false,cancelled:true}
    return {success:true,data:stagePurchaseBills(selected.filePaths,getWorkspaceDataPath('purchase-invoices'),String(user.id))}
  })
  safeHandleModule(ipcMain,'purchases:discardBills','purchase_orders',(_e,token:string)=>{
    const {user}=requireMainBranchProcurement()
    discardStagedBills(token,getWorkspaceDataPath('purchase-invoices'),String(user.id))
    return {success:true}
  })
  safeHandleModule(ipcMain,'purchases:receiptHistory','purchase_orders',(_e,filters:Record<string,unknown>={})=>{
    const {mainBranchId}=requireMainBranchProcurement(); const db=getDb()
    const where=['b.branch_id=?','b.purchase_item_id IS NOT NULL']; const args:unknown[]=[mainBranchId]
    if(filters.from){where.push('date(b.purchase_date)>=date(?)');args.push(filters.from)}
    if(filters.to){where.push('date(b.purchase_date)<=date(?)');args.push(filters.to)}
    if(filters.supplier_id){where.push('po.supplier_id=?');args.push(filters.supplier_id)}
    if(filters.has_bill) where.push('EXISTS (SELECT 1 FROM purchase_attachments a WHERE a.purchase_id=po.id AND a.is_active=1)')
    if(filters.search){where.push('(p.name LIKE ? OR p.sku LIKE ? OR po.po_number LIKE ? OR po.supplier_invoice_number LIKE ?)');args.push(...Array(4).fill(`%${String(filters.search)}%`))}
    const data=db.prepare(`SELECT b.*,p.name product_name,p.sku,po.po_number,po.purchase_type,po.supplier_invoice_number,s.name supplier_name,
      (SELECT COUNT(*) FROM purchase_attachments a WHERE a.purchase_id=po.id AND a.is_active=1) bill_count
      FROM product_batches b JOIN products p ON p.id=b.product_id JOIN purchase_orders po ON po.id=b.po_id
      LEFT JOIN suppliers s ON s.id=po.supplier_id WHERE ${where.join(' AND ')} ORDER BY b.purchase_date DESC,b.created_at DESC,b.id`).all(...args)
    return {success:true,data}
  })
  safeHandleModule(ipcMain,'purchases:refreshProductPrices','purchase_orders',async(_e,id:string)=>{
    const {user,mainBranchId}=requireMainBranchProcurement();const db=getDb()
    if(!usesSupermarketStock(store.get('app_settings') as Record<string,unknown>)) throw new Error('Supermarket module required')
    if(!db.prepare('SELECT 1 FROM purchase_orders WHERE id=? AND branch_id=?').get(id,mainBranchId)) throw new Error('Purchase not found')
    const rows=db.transaction(()=>{
      const changed=repairMissingReceiptPrices(db,id)
      for(const row of changed) logAudit(db,{userId:String(user.id),branchId:mainBranchId,action:'RECEIPT_PRODUCT_PRICE_REPAIR',tableName:'products',recordId:String(row.id),newValues:row})
      return changed
    })()
    await publishProductPrices(rows.map(row=>String(row.id)))
    return {success:true,data:{updated:rows.length}}
  })
  // List POs with optional filters
  safeHandleModule(ipcMain, 'purchases:list', 'purchase_orders', (_e, filters: Record<string, unknown> = {}) => {
    const db = getDb()
      const { mainBranchId } = requireMainBranchProcurement()
      let sql = `
        SELECT po.*, s.name as supplier_name, b.name as branch_name,
               u.name as created_by_name,
               (SELECT COUNT(*) FROM purchase_items pi WHERE pi.po_id = po.id) as item_count,
               (SELECT COUNT(*) FROM purchase_attachments pa WHERE pa.purchase_id=po.id AND pa.is_active=1) as bill_count
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN branches b  ON b.id  = po.branch_id
        LEFT JOIN users u     ON u.id  = po.created_by
        WHERE po.branch_id=?`
      const params: unknown[] = [mainBranchId]
      if (filters.purchase_type) { sql += ' AND po.purchase_type=?'; params.push(filters.purchase_type) }
      if (filters.has_bill) sql += ' AND EXISTS (SELECT 1 FROM purchase_attachments a WHERE a.purchase_id=po.id AND a.is_active=1)'
      if (filters.search) { sql += ' AND (po.po_number LIKE ? OR po.supplier_invoice_number LIKE ? OR s.name LIKE ?)'; params.push(...Array(3).fill(`%${String(filters.search)}%`)) }
      if (filters.status)    { sql += ' AND po.status=?';    params.push(filters.status) }
      if (filters.branch_id) { sql += ' AND po.branch_id=?'; params.push(filters.branch_id) }
      if (filters.supplier_id) { sql += ' AND po.supplier_id=?'; params.push(filters.supplier_id) }
      if (filters.from) { sql += ' AND date(COALESCE(po.purchase_date,po.created_at))>=date(?)'; params.push(filters.from) }
      if (filters.to) { sql += ' AND date(COALESCE(po.purchase_date,po.created_at))<=date(?)'; params.push(filters.to) }
      sql += ' ORDER BY COALESCE(po.purchase_date,po.created_at) DESC'
      return { success: true, data: db.prepare(sql).all(...params) }
  })

  // Get single PO with items
  safeHandleModule(ipcMain, 'purchases:get', 'purchase_orders', (_e, id: string) => {
    const db = getDb()
      const { mainBranchId } = requireMainBranchProcurement()
      const po = db.prepare(`
        SELECT po.*, s.name as supplier_name, b.name as branch_name
        FROM purchase_orders po
        LEFT JOIN suppliers s ON s.id = po.supplier_id
        LEFT JOIN branches b  ON b.id  = po.branch_id
        WHERE po.id=? AND po.branch_id=?`).get(id, mainBranchId)
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
      const attachments = db.prepare(`SELECT pa.id,pa.original_name,pa.mime_type,pa.file_size,pa.uploaded_at,pa.uploaded_by,u.name uploaded_by_name
        FROM purchase_attachments pa LEFT JOIN users u ON u.id=pa.uploaded_by WHERE pa.purchase_id=? AND pa.is_active=1 ORDER BY pa.uploaded_at DESC`).all(id)
      return { success: true, data: { ...po as object, items, attachments } }
  })

  // Create PO (starts as DRAFT)
  safeHandleModule(ipcMain, 'purchases:create', 'purchase_orders', async (_e, payload) => {
    const db = getDb()
      const { user, mainBranchId } = requireMainBranchProcurement()
      const supermarket=usesSupermarketStock(store.get('app_settings') as Record<string,unknown>)
      if (payload.purchase_type === 'direct' && !supermarket) throw new Error('Direct stock purchase requires the supermarket module')
      if (supermarket) {
        const purchaseId=String(payload.entry_id || crypto.randomUUID())
        const billsToken=payload.attachment_token ? String(payload.attachment_token) : undefined
        const purchase=db.transaction(()=>{
          const row=createStockPurchase(db,{
            id:purchaseId,poNumber:getNextPONumber(mainBranchId),branchId:mainBranchId,userId:String(user.id),
            supplierId:String(payload.supplier_id||''),purchaseType:payload.purchase_type==='direct'?'direct':'order',
            purchaseDate:String(payload.purchase_date||new Date().toISOString().slice(0,10)),invoiceNumber:payload.supplier_invoice_number,
            expectedDate:payload.expected_date,notes:payload.notes,
            items:(payload.items||[]).map((item:Record<string,unknown>)=>({product_id:String(item.product_id||''),quantity:Number(item.quantity),unit_cost:Number(item.unit_cost),selling_price:item.selling_price==null||item.selling_price===''?null:Number(item.selling_price)})),
          },id=>persistStagedBills(db,id,billsToken,String(user.id)))
          logAudit(db,{userId:String(user.id),branchId:mainBranchId,action:row.status==='RECEIVED'?'DIRECT_STOCK_RECEIVED':'PO_CREATE',tableName:'purchase_orders',recordId:purchaseId,newValues:row})
          return row
        })()
        completeStagedBills(billsToken)
        await enqueuSync('purchase_orders',purchaseId,'INSERT',purchase)
        const items=db.prepare('SELECT * FROM purchase_items WHERE po_id=?').all(purchaseId) as Record<string,unknown>[]
        for(const item of items) {
          await enqueuSync('purchase_items',String(item.id),'INSERT',item)
          if(purchase.status==='RECEIVED') await syncStockRow(db,String(item.product_id),mainBranchId)
        }
        if(purchase.status==='RECEIVED') await publishProductPrices(items.map(item=>String(item.product_id)))
        for(const batch of db.prepare('SELECT * FROM product_batches WHERE po_id=?').all(purchaseId) as Record<string,unknown>[]) await enqueuSync('product_batches',String(batch.id),'INSERT',batch)
        for(const movement of db.prepare('SELECT * FROM stock_movements WHERE reference_order_id=?').all(purchaseId) as Record<string,unknown>[]) await enqueuSync('stock_movements',String(movement.id),'INSERT',movement)
        let notification=null
        if(purchase.purchase_type==='order' && (payload.open_whatsapp===true || payload.send_email===true)) {
          try { notification=await sendSupplierOrderNotification(purchaseId,{openWhatsApp:payload.open_whatsapp===true,sendEmail:payload.send_email===true}) }
          catch (error) { console.warn('[PO Notification Warning]',error) }
        }
        return {success:true,data:{id:purchaseId,po_number:purchase.po_number,notification}}
      }
      if (!payload.supplier_id)       throw new Error('Supplier is required')
      if (!payload.items?.length)     throw new Error('At least one item is required')

      // Supplier purchases always enter the main branch. Sub branches obtain
      // that stock through the branch transfer workflow.
      const branchId = mainBranchId
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
      const { user, mainBranchId } = requireMainBranchProcurement()
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')

      if (String(po.branch_id) !== mainBranchId) throw new Error('Only main-branch purchase orders can be managed here')

      const allowed = PO_TRANSITIONS[String(po.status)]
      if (!allowed?.includes(status)) {
        throw new Error(`Cannot move PO from '${po.status}' to '${status}'`)
      }

      // Receiving a PO adds stock only to the main branch.
      const now = new Date().toISOString()
      const patch: Record<string, unknown> = { status }

      // When marking RECEIVED or PARTIAL, update received quantities on items and adjust stock
      const receivedItemIds: string[] = []
      const receivedProductIds: string[] = []
      const movementRecords: Record<string, unknown>[] = []
      const batchRecords: Record<string, unknown>[] = []
      if(usesSupermarketStock(store.get('app_settings') as Record<string,unknown>) && ['RECEIVED','PARTIAL'].includes(status) && (!Array.isArray(payload.items)||!payload.items.some((item:Record<string,unknown>)=>Number(item.received_qty)>0))) throw new Error('Select received stock and upload a supplier bill before confirming receipt.')
      if ((status === 'RECEIVED' || status === 'PARTIAL') && payload.items) {
        db.transaction(() => {
          let allFullyReceived = true

          for (const item of payload.items as Record<string, unknown>[]) {
            const poItem = db.prepare('SELECT * FROM purchase_items WHERE id=? AND po_id=?')
              .get(String(item.id), id) as Record<string, unknown> | undefined
            if (!poItem) continue

            const newReceived = Number(item.received_qty) || 0
            const previouslyReceived = Number(poItem.received_qty || 0)
            // The UI sends the quantity it observed before this receipt. A
            // stale retry must not receive the same goods twice.
            if (item.already_received !== undefined && Number(item.already_received) !== previouslyReceived) {
              throw new Error('This purchase order was already updated. Refresh it before receiving more stock.')
            }
            const totalReceived = previouslyReceived + newReceived
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
              movementRecords.push(insertStockMovement(db, {
                product_id: productId,
                from_branch_id: null,
                to_branch_id: branchId,
                quantity: newReceived,
                movement_type: 'RECEIVE',
                reference_order_id: id,
                notes: `Supplier receipt ${po.po_number || id} / item ${poItem.id}`,
                created_by: (user?.id as string) || null,
              }))
              // Every supermarket supplier receipt is an immutable cost layer.
              // Partial receipts intentionally create separate batches because
              // they may arrive on different dates or with different expiry lots.
              const settings = (store.get('app_settings') as Record<string, unknown>) || {}
              const product = db.prepare('SELECT track_batches, selling_price FROM products WHERE id=?')
                .get(productId) as { track_batches?: number; selling_price?: number } | undefined
              if (usesSupermarketStock(settings)) {
                applyReceiptProductPrices(db,productId,Number(poItem.unit_cost),item.selling_price !== undefined ? (item.selling_price === '' || item.selling_price == null ? null : Number(item.selling_price)) : poItem.selling_price == null ? null : Number(poItem.selling_price))
                if (item.purchase_date && !/^\d{4}-\d{2}-\d{2}$/.test(String(item.purchase_date))) throw new Error('Invalid purchase date')
                if (!po.purchase_date && !patch.purchase_date) patch.purchase_date = String(item.purchase_date || now).slice(0,10)
                batchRecords.push(createReceiptBatch(db, {
                  productId,
                  branchId,
                  purchaseId: id,
                  purchaseItemId: String(poItem.id),
                  quantity: newReceived,
                  unitCost: Number(poItem.unit_cost || 0),
                  sellingPrice: item.selling_price !== undefined ? (item.selling_price === '' || item.selling_price == null ? null : Number(item.selling_price)) : poItem.selling_price == null ? null : Number(poItem.selling_price),
                  batchNumber: String(item.batch_number || poItem.batch_number || '').trim() || null,
                  expiryDate: String(item.expiry_date || poItem.expiry_date || '').trim() || null,
                  purchaseDate: String(item.purchase_date || po.purchase_date || now).slice(0, 10),
                  createdBy: (user?.id as string) || null,
                }))
              }
              receivedProductIds.push(productId)
            }

            if (totalReceived < Number(poItem.quantity)) allFullyReceived = false
          }

          persistStagedBills(db,id,payload.attachment_token ? String(payload.attachment_token) : undefined,String(user.id))
          if(usesSupermarketStock(store.get('app_settings') as Record<string,unknown>)) requireSavedPurchaseBill(db,id)
          // Auto-promote PARTIAL to RECEIVED if everything is now received
          if (status === 'PARTIAL' && allFullyReceived) patch.status = 'RECEIVED'
          if (status === 'RECEIVED') patch.received_at = now

          db.prepare(`UPDATE purchase_orders SET status=?, purchase_date=COALESCE(purchase_date,?), received_at=COALESCE(?,received_at), updated_at=datetime('now') WHERE id=?`)
            .run(patch.status, patch.purchase_date || null, patch.status === 'RECEIVED' ? now : null, id)

          logAudit(db, {
            userId: user?.id as string, branchId: po.branch_id as string,
            action: `PO_${status}`, tableName: 'purchase_orders', recordId: id,
            newValues: { from: po.status, to: patch.status },
          })
        })()
        completeStagedBills(payload.attachment_token ? String(payload.attachment_token) : undefined)
        for (const itemId of receivedItemIds) {
          const row = db.prepare('SELECT * FROM purchase_items WHERE id=?').get(itemId)
          await enqueuSync('purchase_items', itemId, 'UPDATE', row as Record<string, unknown>)
        }
        if(usesSupermarketStock(store.get('app_settings') as Record<string,unknown>) && receivedProductIds.length) await publishProductPrices(receivedProductIds)
        for (const productId of receivedProductIds) {
          await syncStockRow(db, productId, String(po.branch_id))
        }
        for (const movement of movementRecords) {
          await enqueuSync('stock_movements', String(movement.id), 'INSERT', movement)
        }
        for (const batch of batchRecords) {
          await enqueuSync('product_batches', String(batch.id), 'INSERT', batch)
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
      const { user, mainBranchId } = requireMainBranchProcurement()
      const po = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown> | undefined
      if (!po) throw new Error('Purchase order not found')
      if (String(po.branch_id) !== mainBranchId) throw new Error('Only main-branch purchase orders can be managed here')
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
    const { mainBranchId } = requireMainBranchProcurement()
    const po = getDb().prepare('SELECT branch_id FROM purchase_orders WHERE id=?').get(id) as { branch_id?: string } | undefined
    if (!po || String(po.branch_id) !== mainBranchId) throw new Error('Main-branch purchase order not found')
    const notification = await sendSupplierOrderNotification(id, {
      openWhatsApp: options.openWhatsApp !== false,
      sendEmail: options.sendEmail !== false,
    })
    return { success: true, data: notification }
  })

  // Bulk Import Purchase Orders from Excel (supports Grocery Store Tracker & Food City & Standard POs)
  safeHandleModule(ipcMain, 'purchases:importExcel', 'purchase_orders', async (_e, options?: { branchId?: string; defaultSupplierId?: string; markAsReceived?: boolean }) => {
    requireMainBranchProcurement()
    if(usesSupermarketStock(store.get('app_settings') as Record<string,unknown>) && options?.markAsReceived !== false) throw new Error('Import as draft orders, then upload a supplier bill before receiving stock.')
    return await importPOsFromExcel(options)
  })

  // Download Purchase Order Import Template
  safeHandleModule(ipcMain, 'purchases:downloadTemplate', 'purchase_orders', async () => {
    return await downloadPOTemplate()
  })

  safeHandleModule(ipcMain, 'purchases:updateInvoice', 'purchase_orders', async (_e, id: string, payload: Record<string, unknown>) => {
    const db = getDb()
    const { user, mainBranchId } = requireMainBranchProcurement()
    const po = db.prepare('SELECT * FROM purchase_orders WHERE id=? AND branch_id=?').get(id, mainBranchId) as Record<string, unknown> | undefined
    if (!po) throw new Error('Purchase order not found')
    const invoiceNumber = String(payload.supplier_invoice_number || '').trim() || null
    const paid = Math.round(Math.max(0, Number(payload.paid_amount || 0)) * 100) / 100
    const total = Number(po.total_amount || po.total || 0)
    if (paid > total) throw new Error('Paid amount cannot exceed the purchase total')
    const outstanding = Math.round(Math.max(0, total - paid) * 100) / 100
    const status = outstanding <= 0 ? 'paid' : paid > 0 ? 'partial' : 'unpaid'
    const oldOutstanding = Number(po.outstanding_amount || 0)
    try {
      db.transaction(() => {
        db.prepare(`UPDATE purchase_orders SET supplier_invoice_number=?, purchase_date=?, invoice_date=?,
          payment_status=?, paid_amount=?, outstanding_amount=?, updated_at=datetime('now') WHERE id=?`)
          .run(invoiceNumber, payload.purchase_date || null, payload.invoice_date || null, status, paid, outstanding, id)
        db.prepare('UPDATE suppliers SET due_balance=MAX(0,due_balance+?), updated_at=datetime(\'now\') WHERE id=?')
          .run(outstanding - oldOutstanding, po.supplier_id)
        logAudit(db, { userId: user.id as string, branchId: mainBranchId, action: 'PURCHASE_INVOICE_UPDATE', tableName: 'purchase_orders', recordId: id, oldValues: po, newValues: { invoiceNumber, paid, outstanding, status } })
      })()
    } catch (error) {
      if (/UNIQUE constraint/i.test(String(error))) throw new Error('This supplier invoice number is already registered')
      throw error
    }
    const updated = db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(id) as Record<string, unknown>
    await enqueuSync('purchase_orders', id, 'UPDATE', updated)
    await enqueuSync('suppliers', String(po.supplier_id), 'UPDATE', db.prepare('SELECT * FROM suppliers WHERE id=?').get(po.supplier_id) as Record<string, unknown>)
    return { success: true, data: updated }
  })

  safeHandleModule(ipcMain, 'purchases:addAttachments', 'purchase_orders', async (_e, id: string) => {
    const db = getDb()
    const { user, mainBranchId } = requireMainBranchProcurement()
    if (!db.prepare('SELECT 1 FROM purchase_orders WHERE id=? AND branch_id=?').get(id, mainBranchId)) throw new Error('Purchase order not found')
    const selected = await dialog.showOpenDialog({ title: 'Attach supplier invoice', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Invoice documents', extensions: ['pdf','jpg','jpeg','png'] }] })
    if (selected.canceled) return { success: false, error: 'Cancelled' }
    const dir = getWorkspaceDataPath('purchase-invoices')
    fs.mkdirSync(dir, { recursive: true })
    const allowed: Record<string,string> = { '.pdf':'application/pdf','.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png' }
    const rows: Record<string, unknown>[] = []
    db.transaction(() => {
      for (const source of selected.filePaths) {
        const ext = path.extname(source).toLowerCase()
        if (!allowed[ext]) throw new Error(`Unsupported invoice file: ${path.basename(source)}`)
        const stat = fs.statSync(source)
        if (stat.size > 15 * 1024 * 1024) throw new Error(`${path.basename(source)} exceeds the 15 MB limit`)
        const stored = `${crypto.randomUUID()}${ext}`
        fs.copyFileSync(source, path.join(dir, stored))
        const row = { id: crypto.randomUUID(), purchase_id: id, original_name: path.basename(source), stored_name: stored, relative_path: `purchase-invoices/${stored}`, mime_type: allowed[ext], file_size: stat.size, uploaded_by: user.id || null }
        db.prepare(`INSERT INTO purchase_attachments (id,purchase_id,original_name,stored_name,relative_path,mime_type,file_size,uploaded_by)
          VALUES (@id,@purchase_id,@original_name,@stored_name,@relative_path,@mime_type,@file_size,@uploaded_by)`).run(row)
        rows.push(row)
      }
      logAudit(db, { userId: user.id as string, branchId: mainBranchId, action: 'PURCHASE_ATTACHMENTS_ADD', tableName: 'purchase_orders', recordId: id, newValues: { files: rows.map(row => row.original_name) } })
    })()
    return { success: true, data: rows }
  })

  safeHandleModule(ipcMain, 'purchases:openAttachment', 'purchase_orders', async (_e, attachmentId: string) => {
    requireMainBranchProcurement()
    const row = getDb().prepare('SELECT relative_path FROM purchase_attachments WHERE id=? AND is_active=1').get(attachmentId) as { relative_path: string } | undefined
    if (!row) throw new Error('Attachment not found')
    const file = getWorkspaceDataPath(...row.relative_path.split('/'))
    if (!fs.existsSync(file)) throw new Error('Attachment file is missing on this device')
    const error = await shell.openPath(file)
    if (error) throw new Error(error)
    return { success: true }
  })

  safeHandleModule(ipcMain, 'purchases:removeAttachment', 'purchase_orders', async (_e, attachmentId: string, reason: string) => {
    const db = getDb(); const { user, mainBranchId } = requireMainBranchProcurement()
    if (!String(reason || '').trim()) throw new Error('A correction reason is required')
    const row = db.prepare(`SELECT pa.*,po.branch_id FROM purchase_attachments pa JOIN purchase_orders po ON po.id=pa.purchase_id WHERE pa.id=? AND pa.is_active=1`).get(attachmentId) as Record<string, unknown> | undefined
    if (!row || row.branch_id !== mainBranchId) throw new Error('Attachment not found')
    if(usesSupermarketStock(store.get('app_settings') as Record<string,unknown>)) { const active=db.prepare('SELECT COUNT(*) n FROM purchase_attachments WHERE purchase_id=? AND is_active=1').get(row.purchase_id) as {n:number}; if(active.n<=1) throw new Error('Upload a replacement supplier bill before removing the last bill.') }
    db.transaction(() => {
      db.prepare(`UPDATE purchase_attachments SET is_active=0,deleted_by=?,deleted_at=datetime('now'),delete_reason=?,updated_at=datetime('now') WHERE id=?`).run(user.id || null, reason.trim(), attachmentId)
      logAudit(db, { userId: user.id as string, branchId: mainBranchId, action: 'PURCHASE_ATTACHMENT_CORRECTED', tableName: 'purchase_attachments', recordId: attachmentId, oldValues: row, newValues: { reason: reason.trim() } })
    })()
    return { success: true }
  })
}
