import type { IpcMain } from 'electron'
import { BrowserWindow, shell, app, dialog } from 'electron'
import Store from 'electron-store'
import path from 'path'
import fs from 'fs'
import net from 'net'
import { safeHandle } from './ipcHandler'
import { getDb } from '../database'
import { logAudit } from '../services/auditLog'
import {
  listSystemPrinters, printHtml, printHtmlForModule, resolveEscPosTarget, resolvePrinterForModule,
  getCurrentBranchId, getCurrentDeviceId,
  listPrinterConfigs, upsertPrinterConfig, deletePrinterConfig, getPrinterConfigById,
  type AssignedModule, type ConnectionType,
} from '../services/printerService'
import { buildKitchenTicketHtml, type KitchenTicketPayload } from '../templates/kitchenTemplates'
import { buildLabelHtml, type LabelPayload } from '../templates/labelTemplates'
import {
  type InvoicePayload, type CustomLayout,
  normalizeInvoiceDesign, selectedPaperType, resolveInvoiceHtml, buildCustomLayoutHtml,
  buildPreprintedInvoiceHtml, LAYOUT, buildEmailBody,
} from '../templates/invoiceTemplates'
import { buildDeliveryNoteHtml, buildTransferNoteHtml } from '../templates/deliveryNoteTemplates'
import { buildInstallmentCardHtml } from '../templates/installmentTemplates'
import { buildCouponHtml, buildSmartBuyVoucherGridHtml } from '../templates/couponTemplates'
import { buildReceiptText } from '../templates/receiptTemplates'

const store = new Store()

export function registerPrinterHandlers(ipcMain: IpcMain) {
  safeHandle(ipcMain, 'printer:printReceipt', async (_e, payload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const lines = buildReceiptText(payload, settings)
    console.log('[PRINTER - text]', lines)
    return { success: true, data: { receipt_text: lines } }
  })

  safeHandle(ipcMain, 'printer:printInvoice', async (_e, payload: InvoicePayload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const design = normalizeInvoiceDesign(payload.invoice_design || settings.invoice_active_design || 'thermal')
    const html = await resolveInvoiceHtml(payload, settings, design)
    const branchId = getCurrentBranchId()
    if (branchId) {
      await printHtmlForModule(html, 'invoice', { design, paperType: selectedPaperType(settings, design), branchId, deviceId: getCurrentDeviceId() })
    } else {
      await printHtml(html, design, selectedPaperType(settings, design))
    }
    return { success: true }
  })

  // Kitchen order ticket — resolves the 'kitchen' purpose assignment the same
  // way printInvoice resolves 'invoice': windows-driver printers go through
  // the hidden-BrowserWindow HTML path (silent + deviceName), network
  // ESC/POS printers get a raw ticket over TCP. Falls back to the OS default
  // printer (dialog) if nothing is assigned yet, same as every other purpose.
  safeHandle(ipcMain, 'printer:printKitchenTicket', async (_e, payload: KitchenTicketPayload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const branchId = getCurrentBranchId()
    const deviceId = getCurrentDeviceId()
    const row = branchId ? resolvePrinterForModule('kitchen', { branchId, deviceId }) : null

    if (row && row.connection_type === 'network_escpos' && row.ip_address) {
      const buffer = buildKitchenTicketEscPos(payload, settings)
      return sendRawToPrinter(row.ip_address, row.port || 9100, buffer)
    }

    const html = buildKitchenTicketHtml(payload, settings)
    if (row && row.connection_type === 'windows_driver' && row.printer_name) {
      await printHtml(html, 'thermal', row.paper_size || '80mm', { deviceName: row.printer_name, silent: true, copies: row.copies })
    } else {
      await printHtml(html, 'thermal', '80mm')
    }
    return { success: true }
  })

  // Barcode/product label — always routed through the Windows-driver print
  // path (webContents.print), since label printers are essentially never
  // driverless raw-ESC/POS-over-9100 devices in practice.
  safeHandle(ipcMain, 'printer:printLabel', async (_e, payload: LabelPayload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const html = buildLabelHtml(payload, settings)
    const branchId = getCurrentBranchId()
    const row = branchId ? resolvePrinterForModule('label', { branchId, deviceId: getCurrentDeviceId() }) : null
    if (row && row.connection_type === 'windows_driver' && row.printer_name) {
      await printHtml(html, 'label', row.paper_size || 'default', { deviceName: row.printer_name, silent: true, copies: row.copies })
    } else {
      await printHtml(html, 'label', 'default')
    }
    return { success: true }
  })

  // Renders the exact same HTML that printer:printInvoice would send to the
  // printer, but returns it as a string instead of printing it — the designer
  // page (src/pages/admin/InvoiceDesignerPage.tsx) shows this in an
  // <iframe srcDoc>. Same function, same settings lookup, same output either
  // way, so the live preview can never drift from what actually prints.
  // `draftLayout` (optional) lets the Advanced Layout Designer preview
  // unsaved edits live, as-you-type — it renders through the exact same
  // buildCustomLayoutHtml() used for real printing, just fed draft data
  // instead of the saved settings blob. Once saved, printing and preview
  // read the identical persisted layout, so there's no drift either way.
  safeHandle(ipcMain, 'printer:renderInvoiceHtml', async (_e, payload: InvoicePayload, draftLayout?: CustomLayout) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    if (draftLayout) {
      const html = await buildCustomLayoutHtml(payload, settings, draftLayout, { includeBackground: true })
      return { success: true, html }
    }
    const design = normalizeInvoiceDesign(payload.invoice_design || settings.invoice_active_design || 'thermal')
    const html = await resolveInvoiceHtml(payload, settings, design)
    return { success: true, html }
  })

  // Raw ESC/POS bill — sent directly to a network thermal printer over TCP
  // (port 9100, the standard "raw print" port), bypassing the OS print
  // spooler entirely. Requires Thermal Printer IP/Port to be set in Settings.
  safeHandle(ipcMain, 'printer:sendEscPos', async (_e, payload: InvoicePayload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const legacyHost = String(settings.thermal_printer_ip || '').trim()
    const legacyPort = Number(settings.thermal_printer_port) || 9100
    const branchId = getCurrentBranchId()
    const target = branchId
      ? resolveEscPosTarget('receipt', { branchId, deviceId: getCurrentDeviceId() }, legacyHost ? { host: legacyHost, port: legacyPort } : undefined)
      : (legacyHost ? { host: legacyHost, port: legacyPort, copies: 1 } : null)
    if (!target) return { success: false, error: 'Thermal printer IP address is not configured (Settings → Printers)' }
    const buffer = buildEscPos(payload, settings)
    return sendRawToPrinter(target.host, target.port, buffer)
  })

  // Same as above but with built-in sample data, for testing the network
  // connection and receipt formatting without needing a real sale.
  safeHandle(ipcMain, 'printer:sendEscPosTest', async () => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const legacyHost = String(settings.thermal_printer_ip || '').trim()
    const legacyPort = Number(settings.thermal_printer_port) || 9100
    const branchId = getCurrentBranchId()
    const target = branchId
      ? resolveEscPosTarget('receipt', { branchId, deviceId: getCurrentDeviceId() }, legacyHost ? { host: legacyHost, port: legacyPort } : undefined)
      : (legacyHost ? { host: legacyHost, port: legacyPort, copies: 1 } : null)
    if (!target) return { success: false, error: 'Thermal printer IP address is not configured (Settings → Printers)' }
    const samplePayload: InvoicePayload = {
      invoice_number: 'SAMPLE-0001',
      invoice_date: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      cashier_name: 'Test Cashier',
      customer_name: 'Sample Customer',
      items: [
        { product_name: 'Sample Product A', sku: 'SKU-0001', quantity: 2, unit_price: 1500, line_total: 3000 },
        { product_name: 'Sample Product B', sku: 'SKU-0002', quantity: 1, unit_price: 750, line_total: 750 },
      ],
      subtotal: 3750, discount_amount: 0, tax_amount: 0, total_amount: 3750,
      paid_amount: 3750, change_amount: 0, payment_method: 'cash',
    }
    const buffer = buildEscPos(samplePayload, settings)
    return sendRawToPrinter(target.host, target.port, buffer)
  })

  // Prints a sample invoice through the pre-printed-mode renderer regardless
  // of the toggle, plus a small crosshair at the calibration origin, so the
  // company can measure the offset against their pre-printed stationery and
  // correct invoice_dot_preprinted_offset_x/_y in Settings.
  safeHandle(ipcMain, 'printer:printCalibrationSheet', async () => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const offsetX = Number(settings.invoice_dot_preprinted_offset_x) || 0
    const offsetY = Number(settings.invoice_dot_preprinted_offset_y) || 0
    const samplePayload: InvoicePayload = {
      invoice_number: 'SAMPLE-0001',
      invoice_date: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      cashier_name: 'Test Cashier',
      customer_name: 'Sample Customer',
      customer_address: 'Sample Address Line 1, Sample Town',
      items: [
        { product_name: 'Sample Product A', sku: 'SKU-0001', quantity: 2, unit_price: 1500, line_total: 3000 },
        { product_name: 'Sample Product B', sku: 'SKU-0002', quantity: 1, unit_price: 750, line_total: 750 },
      ],
      subtotal: 3750, discount_amount: 0, tax_amount: 0, total_amount: 3750,
      paid_amount: 3750, change_amount: 0, payment_method: 'cash',
    }
    // Prefer a saved Advanced Layout Designer layout for the dot-matrix
    // profile if one exists and is enabled; otherwise fall back to the
    // built-in pre-printed-mode LAYOUT constant, exactly as before.
    const customLayoutRaw = settings['invoice_dot_custom_layout_json'] as string | undefined
    let html: string
    if (customLayoutRaw) {
      try {
        const layout = JSON.parse(customLayoutRaw) as CustomLayout
        if (layout.enabled) {
          const crossX = layout.calibration.offsetX
          const crossY = layout.calibration.offsetY
          const crosshair = `<div style="position:absolute;left:${crossX}mm;top:${crossY - 3}mm;width:0;height:6mm;border-left:0.3mm solid #999"></div>
            <div style="position:absolute;left:${crossX - 3}mm;top:${crossY}mm;width:6mm;height:0;border-top:0.3mm solid #999"></div>`
          html = await buildCustomLayoutHtml(samplePayload, settings, layout, { includeBackground: true, extraHtml: crosshair })
          await printHtml(html, 'dot', 'dot_matrix')
          return { success: true }
        }
      } catch { /* fall through to the built-in layout below on malformed JSON */ }
    }
    const crossX = LAYOUT.globalOffset.x + offsetX
    const crossY = LAYOUT.globalOffset.y + offsetY
    const crosshair = `<div style="position:absolute;left:${crossX}mm;top:${crossY - 3}mm;width:0;height:6mm;border-left:0.3mm solid #999"></div>
      <div style="position:absolute;left:${crossX - 3}mm;top:${crossY}mm;width:6mm;height:0;border-top:0.3mm solid #999"></div>`
    html = buildPreprintedInvoiceHtml(samplePayload, settings, offsetX, offsetY, crosshair)
    await printHtml(html, 'dot', 'dot_matrix')
    return { success: true }
  })

  // Save the same letterhead invoice/quotation document (logo, company
  // name, items, totals, footer) as a PDF file instead of sending it to a
  // printer — mirrors reports:exportPdf's exact save-dialog + hidden-window
  // + printToPDF pattern, just fed buildInvoiceHtml's richer document layout.
  safeHandle(ipcMain, 'printer:exportInvoicePdf', async (_e, payload: InvoicePayload) => {
    let tmpPath: string | undefined
    let pdfWin: BrowserWindow | undefined
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No window' }

      const docWord = payload.bill_type === 'QUOTATION' ? 'Quotation' : 'Invoice'
      const saveResult = await dialog.showSaveDialog(win, {
        title: `Save ${docWord} PDF`,
        defaultPath: `${docWord}-${payload.invoice_number}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const settings = store.get('app_settings') as Record<string, unknown> || {}
      const design = normalizeInvoiceDesign(payload.invoice_design || settings.invoice_active_design || 'thermal')
      const html = await resolveInvoiceHtml(payload, settings, design)
      tmpPath = path.join(app.getPath('temp'), `${docWord.toLowerCase()}-${Date.now()}.html`)
      fs.writeFileSync(tmpPath, html, 'utf-8')

      pdfWin = new BrowserWindow({
        width: 900,
        height: 1200,
        show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })
      const loadedPdfWin = pdfWin
      await loadedPdfWin.loadFile(tmpPath)
      // Exact page size for the resolved design (matches printer:printInvoice's
      // sizing exactly) instead of always forcing A4 — a dot-matrix/B5/A5
      // custom layout now exports at its own true dimensions, no scaling.
      const paperType = selectedPaperType(settings, design)
      const pdfPageSize = paperType === 'dot_matrix' ? { width: 241000, height: 279000 }
        : paperType === 'B5' ? { width: 176000, height: 250000 }
        : paperType === 'A5' ? 'A5' as const
        : 'A4' as const
      const pdfMargins = paperType === 'dot_matrix' || paperType === 'B5'
        ? { top: 0, bottom: 0, left: 0, right: 0 }
        : { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 }
      const pdfBuffer = await loadedPdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: pdfPageSize,
        margins: pdfMargins,
      })

      fs.writeFileSync(saveResult.filePath, pdfBuffer)
      return { success: true, filePath: saveResult.filePath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    } finally {
      if (pdfWin) pdfWin.close()
      if (tmpPath) { try { fs.unlinkSync(tmpPath) } catch { /* best effort */ } }
    }
  })

  safeHandle(ipcMain, 'printer:printTransfer', async (_e, payload: Record<string, unknown>) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const html = await buildTransferNoteHtml(payload, settings)
    await printHtml(html, 'a4', 'A4')
    return { success: true }
  })

  // Branch-transfer delivery note. Previously built in the renderer and sent
  // to a popup via window.open() — Electron's main-window setWindowOpenHandler
  // denies every window.open() call, so that popup was always null and the
  // print button always failed with "Popup blocked". Building + printing it
  // here (same hidden-BrowserWindow pattern as every other print job) fixes
  // that, and lets "Download PDF" actually save a file instead of just
  // re-opening the print dialog.
  safeHandle(ipcMain, 'printer:printDeliveryNote', async (_e, payload: Record<string, unknown>) => {
    await printHtml(buildDeliveryNoteHtml(payload), 'a4', 'A4')
    return { success: true }
  })

  safeHandle(ipcMain, 'printer:exportDeliveryNotePdf', async (_e, payload: Record<string, unknown>) => {
    let tmpPath: string | undefined
    let pdfWin: BrowserWindow | undefined
    try {
      const win = BrowserWindow.getFocusedWindow()
      if (!win) return { success: false, error: 'No window' }

      const transferNumber = String(payload.transfer_number || payload.id || 'delivery-note')
      const saveResult = await dialog.showSaveDialog(win, {
        title: 'Save Delivery Note PDF',
        defaultPath: `DeliveryNote-${transferNumber}.pdf`,
        filters: [{ name: 'PDF Document', extensions: ['pdf'] }],
      })
      if (saveResult.canceled || !saveResult.filePath) return { success: false, cancelled: true }

      const html = buildDeliveryNoteHtml(payload)
      tmpPath = path.join(app.getPath('temp'), `delivery-note-${Date.now()}.html`)
      fs.writeFileSync(tmpPath, html, 'utf-8')

      pdfWin = new BrowserWindow({
        width: 900, height: 1200, show: false,
        webPreferences: { contextIsolation: true, nodeIntegration: false },
      })
      const loadedPdfWin = pdfWin
      await loadedPdfWin.loadFile(tmpPath)
      const pdfBuffer = await loadedPdfWin.webContents.printToPDF({
        printBackground: true,
        pageSize: 'A4',
        margins: { top: 0.3, bottom: 0.3, left: 0.3, right: 0.3 },
      })

      fs.writeFileSync(saveResult.filePath, pdfBuffer)
      return { success: true, filePath: saveResult.filePath }
    } catch (err) {
      return { success: false, error: (err as Error).message }
    } finally {
      if (pdfWin) pdfWin.close()
      if (tmpPath) { try { fs.unlinkSync(tmpPath) } catch { /* best effort */ } }
    }
  })

  safeHandle(ipcMain, 'printer:printInstallmentCard', async (_e, payload: Record<string, unknown>) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const html = await buildInstallmentCardHtml(payload, settings)
    await printHtml(html, 'a4', 'A4')
    return { success: true }
  })

  safeHandle(ipcMain, 'printer:printCoupon', async (_e, payload: Record<string, unknown>) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const html = await buildCouponHtml(payload, settings)
    await printHtml(html, 'a4', 'A4')
    return { success: true }
  })

  // SmartBuy / Chit Fund voucher — 1-4 vouchers laid out 4-up on a single A4
  // sheet (spec §31-33). Re-fetches the coupon rows fresh from the DB by id
  // (never trusts client-supplied voucher data for what gets printed) and
  // ALWAYS reprints the same existing coupons row — no id/code/balance is
  // ever created or mutated here, so calling this again for the same
  // voucher(s) is a safe, unlimited reprint. Every call is audited.
  safeHandle(ipcMain, 'printer:printSmartBuyVouchers', async (_e, couponIds: string[]) => {
    // Unlike printer:printCoupon (which just renders whatever payload the
    // renderer already fetched through a permission-gated read), this reads
    // full voucher rows straight from the DB by id — so it needs its own
    // server-side gate, matching coupons:get/coupons:list's 'coupons'/'all'
    // requirement, rather than relying on the menu being hidden client-side.
    const user = store.get('auth_user') as Record<string, unknown> | undefined
    const perms = ((user?.role as Record<string, unknown> | undefined)?.permissions
      || user?.permissions || {}) as Record<string, unknown>
    if (!perms.all && !perms.coupons && !perms.chits) {
      return { success: false, error: 'You do not have permission to print SmartBuy vouchers' }
    }

    const ids = Array.from(new Set((couponIds || []).filter(Boolean))).slice(0, 4)
    if (ids.length === 0) return { success: false, error: 'No voucher selected to print' }

    const db = getDb()
    const placeholders = ids.map(() => '?').join(',')
    const coupons = db.prepare(`
      SELECT cp.*, cu.name as customer_name
      FROM coupons cp
      LEFT JOIN customers cu ON cu.id = cp.customer_id
      WHERE cp.id IN (${placeholders}) AND cp.source_type = 'smartbuy_redemption'
    `).all(...ids) as Record<string, unknown>[]
    if (coupons.length === 0) return { success: false, error: 'Voucher(s) not found' }

    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const html = await buildSmartBuyVoucherGridHtml(coupons, settings)
    await printHtml(html, 'a4', 'A4')

    for (const c of coupons) {
      logAudit(db, {
        userId: (user?.id as string) || null, branchId: (user?.branch_id as string) || null,
        action: 'REPRINT_SMARTBUY_VOUCHER', tableName: 'coupons', recordId: String(c.id),
        newValues: { code: c.code },
      })
    }
    return { success: true }
  })

  safeHandle(ipcMain, 'printer:emailInvoice', async (_e, payload: InvoicePayload) => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const companyName = (settings.company_name as string) || 'Nature Plantation'
    const toEmail = payload.customer_email || ''
    const subject = `Invoice ${payload.invoice_number} - ${companyName}`
    const body = buildEmailBody(payload, settings)
    const mailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
    await shell.openExternal(mailtoUrl)
    return { success: true }
  })

  safeHandle(ipcMain, 'printer:test', async () => {
    return { success: true, data: 'Test print queued' }
  })

  safeHandle(ipcMain, 'printer:listDevices', async () => {
    return { success: true, data: await listSystemPrinters() }
  })

  safeHandle(ipcMain, 'printer:listSystemPrinters', async () => {
    return { success: true, data: await listSystemPrinters() }
  })

  safeHandle(ipcMain, 'printer:listPrinterConfigs', async (_e, branchId?: string) => {
    const bId = branchId || getCurrentBranchId()
    if (!bId) return { success: true, data: [] }
    return { success: true, data: listPrinterConfigs(bId) }
  })

  safeHandle(ipcMain, 'printer:savePrinterConfig', async (_e, payload: Record<string, unknown>) => {
    const user = store.get('auth_user') as Record<string, unknown> | undefined
    const branchId = String(payload.branchId || getCurrentBranchId() || '')
    if (!branchId) return { success: false, error: 'No branch context — please log in again' }
    if (!payload.printerName) return { success: false, error: 'Printer name is required' }
    if (!payload.assignedModule) return { success: false, error: 'A purpose (receipt/invoice/label/kitchen) is required' }

    const row = upsertPrinterConfig({
      id: payload.id as string | undefined,
      branchId,
      deviceId: payload.deviceId as string | undefined,
      printerName: String(payload.printerName),
      printerType: String(payload.printerType || 'thermal'),
      connectionType: (payload.connectionType as ConnectionType) || 'windows_driver',
      ipAddress: (payload.ipAddress as string) || null,
      port: payload.port != null ? Number(payload.port) : null,
      paperSize: (payload.paperSize as string) || null,
      assignedModule: payload.assignedModule as AssignedModule,
      copies: payload.copies != null ? Number(payload.copies) : undefined,
      createdBy: (user?.id as string) || null,
    })

    try {
      logAudit(getDb(), {
        userId: (user?.id as string) || null, branchId,
        action: 'PRINTER_CONFIG_UPDATE', tableName: 'printers', recordId: row.id, newValues: row,
      })
    } catch {
      // Config must still save if audit logging is unavailable.
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('printer:configUpdated', { reason: 'save', id: row.id }) } catch { /* ignore */ }
    }
    return { success: true, data: row }
  })

  safeHandle(ipcMain, 'printer:deletePrinterConfig', async (_e, id: string) => {
    const user = store.get('auth_user') as Record<string, unknown> | undefined
    deletePrinterConfig(id)
    try {
      logAudit(getDb(), {
        userId: (user?.id as string) || null, branchId: (user?.branch_id as string) || null,
        action: 'PRINTER_CONFIG_UPDATE', tableName: 'printers', recordId: id, newValues: { deleted: true },
      })
    } catch {
      // Config must still delete if audit logging is unavailable.
    }
    for (const win of BrowserWindow.getAllWindows()) {
      try { win.webContents.send('printer:configUpdated', { reason: 'delete', id }) } catch { /* ignore */ }
    }
    return { success: true }
  })

  // Sends a tiny sample job through a saved assignment row, so an admin can
  // confirm a purpose is wired to the right physical printer without doing
  // a real sale/order first.
  safeHandle(ipcMain, 'printer:testPrinterConfig', async (_e, id: string) => {
    const row = getPrinterConfigById(id)
    if (!row) return { success: false, error: 'Printer assignment not found' }

    if (row.connection_type === 'windows_driver') {
      const html = `<html><body style="font-family:monospace;padding:8px;">
        <p>TEST PRINT</p><p>${row.assigned_module.toUpperCase()}</p><p>${row.printer_name}</p>
        <p>${new Date().toLocaleString()}</p></body></html>`
      await printHtml(html, 'thermal', row.paper_size || '80mm', {
        deviceName: row.printer_name, silent: true, copies: 1,
      })
      return { success: true }
    }

    if (!row.ip_address) return { success: false, error: 'No IP address saved for this printer' }
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const samplePayload: InvoicePayload = {
      invoice_number: 'TEST-0001',
      invoice_date: new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      cashier_name: 'Test',
      customer_name: `${row.assigned_module.toUpperCase()} test`,
      items: [{ product_name: 'Test Item', sku: 'TEST', quantity: 1, unit_price: 0, line_total: 0 }],
      subtotal: 0, discount_amount: 0, tax_amount: 0, total_amount: 0,
      paid_amount: 0, change_amount: 0, payment_method: 'cash',
    }
    const buffer = buildEscPos(samplePayload, settings)
    return sendRawToPrinter(row.ip_address, row.port || 9100, buffer)
  })
}

// ─── ESC/POS raw thermal printing ──────────────────────────────────────────
// Thermal printers speak a line-based command protocol, not the X/Y-mm model
// the HTML/PDF renderers above use — there's no meaningful way to project a
// mm-positioned layout onto a 42-character-wide receipt, so this walks the
// same logical sections (header → meta → items → totals → footer) as the
// thermal HTML template and emits raw ESC/POS bytes instead. Delivered via a
// raw TCP socket to the printer's configured IP:port (standard "raw print"
// port 9100 on nearly all network thermal printers) — no native/serial
// dependency needed.
const ESC = 0x1B
const GS = 0x1D
function escInit() { return Buffer.from([ESC, 0x40]) }
function escAlign(n: 0 | 1 | 2) { return Buffer.from([ESC, 0x61, n]) }
function escBold(on: boolean) { return Buffer.from([ESC, 0x45, on ? 1 : 0]) }
function escFontSize(w: number, h: number) {
  const n = ((Math.max(0, Math.min(7, w))) << 4) | Math.max(0, Math.min(7, h))
  return Buffer.from([GS, 0x21, n])
}
function escFeed(lines = 1) { return Buffer.from(new Array(lines).fill(0x0A)) }
function escCut() { return Buffer.from([GS, 0x56, 0x00]) }
// ESC/POS printers generally only render the default codepage's ASCII/Latin
// range reliably without a codepage-switch command — strip anything outside
// it so unsupported characters don't come out as garbage instead of failing loudly.
function escSafe(s: string): string { return s.replace(/[^\x20-\x7E]/g, '') }
function escText(s: string): Buffer { return Buffer.from(escSafe(s), 'ascii') }
function padLine(left: string, right: string, width = 42): string {
  const l = left.length > width ? left.slice(0, width) : left
  const space = Math.max(1, width - l.length - right.length)
  return l + ' '.repeat(space) + right
}

function buildEscPos(payload: InvoicePayload, settings: Record<string, unknown>): Buffer {
  const W = 42
  const currency = String(settings.currency_symbol || 'Rs.')
  const fmt = (n: number) => `${currency}${Number(n || 0).toFixed(2)}`
  const companyName = escSafe(String(settings.company_name || 'Nature Plantation'))
  const parts: Buffer[] = [escInit(), escAlign(1), escBold(true), escFontSize(1, 1), escText(companyName + '\n'), escFontSize(0, 0), escBold(false)]
  if (settings.company_address) parts.push(escText(String(settings.company_address) + '\n'))
  if (settings.company_phone) parts.push(escText(String(settings.company_phone) + '\n'))
  parts.push(escText('-'.repeat(W) + '\n'), escAlign(0))
  parts.push(escText(`Invoice: ${payload.invoice_number}\n`))
  parts.push(escText(`Date: ${payload.invoice_date || ''}\n`))
  if (payload.cashier_name) parts.push(escText(`Cashier: ${payload.cashier_name}\n`))
  if (payload.customer_name && payload.customer_name !== 'Walk-in') parts.push(escText(`Customer: ${payload.customer_name}\n`))
  parts.push(escText('-'.repeat(W) + '\n'))
  for (const item of payload.items) {
    parts.push(escText(item.product_name.slice(0, W) + '\n'))
    parts.push(escText(padLine(`  ${item.quantity} x ${fmt(item.unit_price)}`, fmt(item.line_total), W) + '\n'))
  }
  parts.push(escText('-'.repeat(W) + '\n'))
  parts.push(escText(padLine('Subtotal', fmt(payload.subtotal), W) + '\n'))
  if (payload.discount_amount > 0) parts.push(escText(padLine('Discount', '-' + fmt(payload.discount_amount), W) + '\n'))
  if (payload.tax_amount > 0) parts.push(escText(padLine('Tax', fmt(payload.tax_amount), W) + '\n'))
  parts.push(escBold(true), escText(padLine('TOTAL', fmt(payload.total_amount), W) + '\n'), escBold(false))
  parts.push(escText('-'.repeat(W) + '\n'), escAlign(1))
  parts.push(escText(String(settings.invoice_thermal_footer_message || 'Thank you for shopping with us!') + '\n'))
  parts.push(escFeed(3), escCut())
  return Buffer.concat(parts)
}

// Kitchen ticket over raw ESC/POS — no prices, bigger font for kitchen-floor
// readability, reuses the same byte-command helpers as buildEscPos above.
function buildKitchenTicketEscPos(payload: KitchenTicketPayload, settings: Record<string, unknown>): Buffer {
  const W = 42
  const parts: Buffer[] = [escInit(), escAlign(1), escBold(true), escFontSize(1, 1), escText('KITCHEN ORDER\n'), escFontSize(0, 0), escBold(false)]
  if (payload.invoice_number) parts.push(escText(`#${payload.invoice_number}\n`))
  parts.push(escText(String(payload.invoice_date || new Date().toLocaleString()) + '\n'))
  if (payload.customer_name && payload.customer_name !== 'Walk-in') parts.push(escText(`Customer: ${payload.customer_name}\n`))
  parts.push(escText('-'.repeat(W) + '\n'), escAlign(0))
  for (const item of payload.items) {
    parts.push(escBold(true), escFontSize(0, 1), escText(`${item.quantity} x ${item.product_name}\n`), escFontSize(0, 0), escBold(false))
    if (item.notes) parts.push(escText(`  Note: ${item.notes}\n`))
  }
  parts.push(escText('-'.repeat(W) + '\n'))
  if (payload.notes) parts.push(escText(payload.notes + '\n'))
  parts.push(escFeed(3), escCut())
  return Buffer.concat(parts)
}

function sendRawToPrinter(host: string, port: number, buffer: Buffer): Promise<{ success: boolean; error?: string }> {
  return new Promise(resolve => {
    const socket = new net.Socket()
    const timer = setTimeout(() => { socket.destroy(); resolve({ success: false, error: 'Connection to printer timed out' }) }, 5000)
    socket.once('error', (err) => { clearTimeout(timer); resolve({ success: false, error: err.message }) })
    socket.connect(port, host, () => {
      socket.write(buffer, () => {
        clearTimeout(timer)
        socket.end()
        resolve({ success: true })
      })
    })
  })
}

