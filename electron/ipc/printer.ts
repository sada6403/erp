import type { IpcMain, WebContentsPrintOptions } from 'electron'
import { BrowserWindow, shell, app, dialog } from 'electron'
import Store from 'electron-store'
import path from 'path'
import fs from 'fs'
import net from 'net'
import QRCode from 'qrcode'
import { safeHandle } from './ipcHandler'

const store = new Store()

// ─── Code 39 barcode → monochrome SVG (real, scannable) ──────────────────────
const CODE39: Record<string, string> = {
  '0':'000110100','1':'100100001','2':'001100001','3':'101100000','4':'000110001',
  '5':'100110000','6':'001110000','7':'000100101','8':'100100100','9':'001100100',
  'A':'100001001','B':'001001001','C':'101001000','D':'000011001','E':'100011000',
  'F':'001011000','G':'000001101','H':'100001100','I':'001001100','J':'000011100',
  'K':'100000011','L':'001000011','M':'101000010','N':'000010011','O':'100010010',
  'P':'001010010','Q':'000000111','R':'100000110','S':'001000110','T':'000010110',
  'U':'110000001','V':'011000001','W':'111000000','X':'010010001','Y':'110010000',
  'Z':'011010000','-':'010000101','.':'110000100',' ':'011000100','$':'010101000',
  '/':'010100010','+':'010001010','%':'000101010','*':'010010100',
}
function buildBarcodeSvg(raw: string, height = 44): string {
  const text = String(raw || '').toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-')
  const data = `*${text}*`
  const NARROW = 2, WIDE = 5, GAP = NARROW
  let x = 0
  const rects: string[] = []
  for (const ch of data) {
    const pat = CODE39[ch] || CODE39['-']
    for (let i = 0; i < 9; i++) {
      const w = pat[i] === '1' ? WIDE : NARROW
      if (i % 2 === 0) rects.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`) // even = bar
      x += w
    }
    x += GAP
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${x} ${height}" preserveAspectRatio="none" fill="#000">${rects.join('')}</svg>`
}

interface PaymentLine {
  method: string
  amount: number
  reference?: string
}

interface InvoicePayload {
  invoice_number: string
  bill_type?: string
  invoice_design?: string
  invoice_date?: string
  cashier_name?: string
  customer_name?: string
  customer_phone?: string
  customer_email?: string
  customer_address?: string
  items: {
    product_name: string
    sku?: string
    quantity: number
    unit_price: number
    discount_amount?: number
    line_total: number
  }[]
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  change_amount: number
  payment_method: string
  payment_reference?: string
  payments?: PaymentLine[]
}

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
    await printHtml(html, design, selectedPaperType(settings, design))
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
    const host = String(settings.thermal_printer_ip || '').trim()
    const port = Number(settings.thermal_printer_port) || 9100
    if (!host) return { success: false, error: 'Thermal printer IP address is not configured (Settings → Printers)' }
    const buffer = buildEscPos(payload, settings)
    return sendRawToPrinter(host, port, buffer)
  })

  // Same as above but with built-in sample data, for testing the network
  // connection and receipt formatting without needing a real sale.
  safeHandle(ipcMain, 'printer:sendEscPosTest', async () => {
    const settings = store.get('app_settings') as Record<string, unknown> || {}
    const host = String(settings.thermal_printer_ip || '').trim()
    const port = Number(settings.thermal_printer_port) || 9100
    if (!host) return { success: false, error: 'Thermal printer IP address is not configured (Settings → Printers)' }
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
    return sendRawToPrinter(host, port, buffer)
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
    return { success: true, data: [] }
  })
}

// Branch-transfer delivery note / issue note — same layout as the renderer's
// preview iframe in StockTransfersPage.tsx, rebuilt here so it can actually
// be printed/exported (see printer:printDeliveryNote above for why).
function buildDeliveryNoteHtml(t: Record<string, unknown>): string {
  const v = (k: string) => esc(String(t[k] ?? ''))
  const fmtDate = (s: unknown) => s ? new Date(String(s)).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—'
  const transferNumber = esc(String(t.transfer_number || ''))
  const qty = Number(t.quantity || 0)
  return `<!doctype html><html><head><meta charset="utf-8"><title>Delivery Note ${transferNumber}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    html, body { background:#ffffff; }
    body { font-family: Arial, sans-serif; color:#111827; font-size:12px; }
    .top { display:flex; justify-content:space-between; gap:16px; border-bottom:2px solid #111827; padding-bottom:10px; }
    h1 { margin:0; font-size:20px; letter-spacing:.04em; }
    h2 { margin:2px 0 0; font-size:13px; font-weight:600; color:#475569; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin:14px 0; }
    .box { border:1px solid #111827; padding:8px; min-height:34px; }
    .label { font-size:10px; text-transform:uppercase; color:#64748b; display:block; margin-bottom:2px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th,td { border:1px solid #111827; padding:6px; vertical-align:top; }
    th { background:#f1f5f9; font-size:11px; text-transform:uppercase; }
    .num { text-align:right; }
    .remarks { min-height:52px; }
    .sign { display:grid; grid-template-columns:1fr 1fr 1fr; gap:18px; margin-top:34px; }
    .line { border-top:1px dotted #111827; padding-top:6px; min-height:44px; }
    .footer { margin-top:18px; font-size:10px; color:#64748b; display:flex; justify-content:space-between; }
  </style></head><body>
    <div class="top"><div><h1>DELIVERY NOTE / ISSUE NOTE</h1><h2>Branch Stock Transfer</h2></div><div style="text-align:right"><strong>${transferNumber}</strong><br/>${esc(new Date().toLocaleString())}</div></div>
    <div class="meta">
      <div class="box"><span class="label">Issuing Store Name</span>${v('from_branch_name')}</div>
      <div class="box"><span class="label">Receiving Store Name</span>${v('to_branch_name')}</div>
      <div class="box"><span class="label">Driver Name / Phone</span>${v('driver_name')}${t.driver_phone ? ` / ${v('driver_phone')}` : ''}</div>
      <div class="box"><span class="label">Vehicle No</span>${v('vehicle_number')}</div>
      <div class="box"><span class="label">Issuing Officer</span>${v('issuing_officer_name') || v('initiated_by_name')}</div>
      <div class="box"><span class="label">Dispatch Date</span>${esc(fmtDate(t.dispatch_at) !== '—' ? fmtDate(t.dispatch_at) : fmtDate(t.initiated_at))}</div>
    </div>
    <table>
      <thead><tr><th>No</th><th>Product / SKU</th><th>Description</th><th>Qty</th><th>Unit</th><th>No. of Packages</th><th>Serial / Batch</th></tr></thead>
      <tbody><tr><td>1</td><td>${v('product_name')}<br/><small>${v('sku')}${t.barcode ? ` / ${v('barcode')}` : ''}</small></td><td>${v('item_description')}</td><td class="num">${qty}</td><td>${v('unit') || 'Nos'}</td><td class="num">${Number(t.package_count || 0) || ''}</td><td>${v('serial_batch_no')}</td></tr></tbody>
      <tfoot><tr><th colspan="3" class="num">Total Quantity</th><th class="num">${qty}</th><th colspan="3"></th></tr></tfoot>
    </table>
    <div class="box remarks" style="margin-top:12px"><span class="label">Remarks</span>${v('notes')}</div>
    <div class="sign">
      <div class="line"><strong>Name & Signature of Issuing Officer</strong><br/>Designation:<br/>Date:</div>
      <div class="line"><strong>Name & Signature of Driver / Officer Taking Over</strong><br/>Designation:<br/>Date:</div>
      <div class="line"><strong>Name & Signature of Receiving Officer</strong><br/>Designation:<br/>Date:</div>
    </div>
    <div class="footer"><span>Printed copy must be signed manually and retained by both branches.</span><span>Print count: ${Number(t.print_count || 0) + 1}</span></div>
  </body></html>`
}

// A4 stock-transfer note / gate pass — the printable hard copy carrying the
// tracking number. Meant to travel with the goods and be signed at each handover.
async function buildTransferNoteHtml(t: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
  const company = esc((settings.company_name as string) || 'Nature Plantation')
  const v = (k: string) => esc(String(t[k] ?? ''))
  const raw = (k: string) => String(t[k] ?? '')
  const fmtDate = (s: unknown) => s ? esc(new Date(String(s)).toLocaleString()) : '—'
  const tracking = esc(String(t.transfer_number || t.id || ''))
  const qty = esc(String(t.quantity ?? ''))
  const status = esc(String(t.status ?? '').replace(/_/g, ' ').toUpperCase())

  // Real QR carrying the full transfer detail — scan it to verify authenticity.
  const qrText = [
    `${(settings.company_name as string) || 'Nature Plantation'} — STOCK TRANSFER`,
    `Tracking: ${raw('transfer_number') || raw('id')}`,
    `Status: ${String(t.status ?? '').replace(/_/g, ' ')}`,
    `Product: ${raw('product_name')} (${raw('sku')})`,
    `Qty: ${raw('quantity')} units`,
    `From: ${raw('from_branch_name')}  ->  To: ${raw('to_branch_name')}`,
    `Requested by: ${raw('initiated_by_name')}`,
    t.approved_by_name ? `Approved by: ${raw('approved_by_name')}` : '',
    t.driver_name ? `Driver: ${raw('driver_name')} ${raw('vehicle_number')}` : '',
    t.received_by_name ? `Received by: ${raw('received_by_name')}` : '',
  ].filter(Boolean).join('\n')
  let qrSvg = ''
  try { qrSvg = await QRCode.toString(qrText, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } catch { /* ignore */ }
  const barcodeSvg = buildBarcodeSvg(String(t.transfer_number || t.id || ''), 40)
  return `<!doctype html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; }
    body { font-family: Arial, Helvetica, sans-serif; color: #111; margin: 24px; }
    .head { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:3px solid #111; padding-bottom:10px; }
    .company { font-size:20px; font-weight:800; }
    .title { font-size:15px; font-weight:700; letter-spacing:2px; color:#444; }
    .track { text-align:right; }
    .track .num { font-family:'Courier New',monospace; font-size:22px; font-weight:800; letter-spacing:2px; }
    .track .lbl { font-size:10px; color:#666; text-transform:uppercase; letter-spacing:1px; }
    .status { display:inline-block; margin-top:6px; padding:3px 10px; border:1px solid #111; border-radius:4px; font-size:11px; font-weight:700; }
    table { width:100%; border-collapse:collapse; margin-top:18px; }
    td { padding:8px 10px; border:1px solid #bbb; font-size:13px; vertical-align:top; }
    td.k { background:#f3f3f3; font-weight:700; width:170px; color:#333; }
    .prod { font-size:16px; font-weight:800; }
    .signs { display:flex; gap:20px; margin-top:44px; }
    .sign { flex:1; text-align:center; }
    .sign .line { border-top:1px solid #111; margin-top:40px; padding-top:6px; font-size:11px; color:#444; }
    .foot { margin-top:26px; font-size:10px; color:#888; text-align:center; }
    .head { gap:20px; }
    .qr { width:112px; height:112px; flex-shrink:0; }
    .qr svg { width:100%; height:100%; display:block; }
    .barcode { margin-top:12px; max-width:250px; line-height:0; }
    .barcode svg { width:100%; height:38px; display:block; }
  </style></head><body>
    <div class="head">
      <div>
        <div class="company">${company}</div><div class="title">STOCK TRANSFER NOTE</div>
        ${barcodeSvg ? `<div class="barcode">${barcodeSvg}</div>` : ''}
      </div>
      <div class="track"><div class="lbl">Tracking No.</div><div class="num">${tracking}</div>
        <div class="status">${status}</div></div>
      ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
    </div>
    <table>
      <tr><td class="k">Product</td><td class="prod">${v('product_name')} <span style="font-weight:400;color:#666">(${v('sku')})</span></td></tr>
      <tr><td class="k">Quantity</td><td><b>${qty}</b> units</td></tr>
      <tr><td class="k">From Branch</td><td>${v('from_branch_name')}</td></tr>
      <tr><td class="k">To Branch</td><td>${v('to_branch_name')}</td></tr>
      <tr><td class="k">Requested By</td><td>${v('initiated_by_name')} &nbsp;·&nbsp; ${fmtDate(t.initiated_at)}</td></tr>
      <tr><td class="k">Approved By</td><td>${v('approved_by_name') || '—'}</td></tr>
      <tr><td class="k">Driver / Vehicle</td><td>${v('driver_name') || '—'} ${t.driver_phone ? '· ' + v('driver_phone') : ''} ${t.vehicle_number ? '· ' + v('vehicle_number') : ''}</td></tr>
      <tr><td class="k">Dispatched At</td><td>${fmtDate(t.dispatch_at)}</td></tr>
      <tr><td class="k">Expected Delivery</td><td>${fmtDate(t.expected_delivery_at)}</td></tr>
    </table>
    <div class="signs">
      <div class="sign"><div class="line">Released By (Source)</div></div>
      <div class="sign"><div class="line">Driver / Carrier</div></div>
      <div class="sign"><div class="line">Received By (Destination)</div></div>
    </div>
    <div class="foot">Keep this note with the goods. Present the tracking number <b>${tracking}</b> at the destination to confirm receipt.</div>
  </body></html>`
}

// Installment payment card / passbook — a membership-style hard copy the customer
// keeps. Every payment: tick the row, write the amount, sign. QR verifies the plan.
async function buildInstallmentCardHtml(t: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
  const company = esc((settings.company_name as string) || 'Nature Plantation')
  const cur = String(settings.currency_symbol || 'Rs.')
  const money = (n: unknown) => `${cur}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const v = (k: string) => esc(String(t[k] ?? ''))
  const contract = esc(String(t.contract_number || ''))
  const schedule = Array.isArray(t.schedule) ? t.schedule as Record<string, unknown>[] : []

  const qrText = [
    `${(settings.company_name as string) || 'Nature Plantation'} — INSTALLMENT CARD`,
    `Contract: ${String(t.contract_number || '')}`,
    `Customer: ${String(t.customer_name || '')} ${String(t.customer_phone || '')}`,
    `Cash: ${money(t.cash_price)}  Down: ${money(t.down_payment)}`,
    `Total payable: ${money(t.total_payable)}`,
    `Monthly: ${money(t.monthly_amount)} x ${String(t.months || '')}`,
    `Start: ${String(t.start_date || '')}`,
  ].join('\n')
  let qrSvg = ''
  try { qrSvg = await QRCode.toString(qrText, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } catch { /* ignore */ }

  const rows = schedule.map((s, i) => `
    <tr>
      <td class="c">${esc(String(s.no ?? i + 1))}</td>
      <td>${esc(String(s.due_date || ''))}</td>
      <td class="amt">${money(s.amount)}</td>
      <td class="tick"></td>
      <td></td>
      <td></td>
    </tr>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:22px}
    .card{border:2px solid #111;border-radius:10px;padding:0;overflow:hidden}
    .top{display:flex;justify-content:space-between;align-items:center;background:#111;color:#fff;padding:12px 18px}
    .top .co{font-size:19px;font-weight:800}
    .top .ti{font-size:11px;letter-spacing:2px;text-transform:uppercase;opacity:.85}
    .qr{width:96px;height:96px;background:#fff;padding:5px;border-radius:6px}
    .qr svg{width:100%;height:100%;display:block}
    .info{display:flex;justify-content:space-between;gap:24px;padding:14px 18px;border-bottom:1px solid #ccc}
    .info .col{font-size:12px;line-height:1.9}
    .info b{display:inline-block;min-width:110px;color:#444}
    table{width:100%;border-collapse:collapse}
    th,td{border:1px solid #bbb;padding:8px 8px;font-size:12px;text-align:left}
    th{background:#f0f0f0;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    td.c,th.c{text-align:center;width:36px}
    td.amt{font-weight:700}
    td.tick{width:52px}
    th.pay{width:120px}th.sign{width:150px}
    .foot{padding:12px 18px;font-size:10px;color:#666}
  </style></head><body>
    <div class="card">
      <div class="top">
        <div><div class="co">${company}</div><div class="ti">Installment Payment Card</div></div>
        ${qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
      </div>
      <div class="info">
        <div class="col">
          <div><b>Contract No</b> ${contract}</div>
          <div><b>Customer</b> ${v('customer_name')}</div>
          <div><b>Phone</b> ${v('customer_phone') || '—'}</div>
          <div><b>Start Date</b> ${v('start_date')}</div>
        </div>
        <div class="col">
          <div><b>Cash Price</b> ${money(t.cash_price)}</div>
          <div><b>Down Payment</b> ${money(t.down_payment)}</div>
          <div><b>Total Payable</b> ${money(t.total_payable)}</div>
          <div><b>Monthly × ${v('months')}</b> ${money(t.monthly_amount)}</div>
        </div>
      </div>
      <table>
        <thead><tr>
          <th class="c">#</th><th>Due Date</th><th>Amount Due</th>
          <th class="c">Paid ✓</th><th class="pay">Amount Paid</th><th class="sign">Signature</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="foot">Keep this card safe and bring it on each payment. Present the QR to verify your plan. Payments are only valid when signed &amp; receipted by ${company}.</div>
    </div>
  </body></html>`
}

// Gift coupon card — premium design matching the shop's printed vouchers:
// company logo, green gradient panel, script "Gift Voucher" title, company
// details footer. The QR encodes a LINK to the public coupon-status page
// (live balance / expiry when scanned with a phone); the POS scanner path
// extracts the CPN- code from the URL automatically. Falls back to encoding
// the bare code when no cloud URL is configured.
async function buildCouponHtml(c: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
  const company = esc((settings.company_name as string) || 'Nature Plantation')
  const cur = String(settings.currency_symbol || 'Rs.')
  const money = (n: unknown) => `${cur}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const code = String(c.code || '')
  const logoUrl = String(settings.company_logo_url || settings.brand_logo_url || '')
  const address = String(settings.company_address || '')
  const phone   = String(settings.company_phone || '')
  const email   = String(settings.company_email || '')
  const website = String(settings.company_website || '')

  const cloudUrl = String(settings.cloud_api_url || '').trim().replace(/\/+$/, '')
  const qrPayload = cloudUrl ? `${cloudUrl}/coupon/${encodeURIComponent(code)}` : code
  let qrSvg = ''
  try { qrSvg = await QRCode.toString(qrPayload, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } catch { /* ignore */ }

  const validUntil = c.valid_until ? String(c.valid_until).slice(0, 10) : 'No expiry'
  const issuedOn   = c.created_at ? String(c.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10)

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}
    body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;margin:24px;background:#fff}
    .sheet{max-width:760px;margin:auto}
    .card{display:flex;border-radius:16px;overflow:hidden;border:1px solid #d1d5db;
      box-shadow:0 2px 10px rgba(0,0,0,.12);background:#fff;min-height:340px}
    /* Left green brand panel */
    .brand{width:215px;flex-shrink:0;position:relative;color:#fff;padding:20px 16px;
      background:linear-gradient(155deg,#65a30d 0%,#15803d 55%,#14532d 100%)}
    .brand .ribbon{position:absolute;top:0;right:-14px;width:28px;height:100%;
      background:linear-gradient(180deg,#dc2626,#991b1b);box-shadow:0 0 6px rgba(0,0,0,.25)}
    .brand .bow{position:absolute;top:18px;right:-34px;width:68px;height:34px;border-radius:50% 50% 50% 50%/60% 60% 40% 40%;
      background:radial-gradient(circle at 30% 30%,#ef4444,#991b1b);box-shadow:0 2px 5px rgba(0,0,0,.3)}
    .logo{width:64px;height:64px;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:12px}
    .logo img{width:100%;height:100%;object-fit:contain}
    .logo .ph{font-size:26px;font-weight:900;color:#15803d}
    .brand .co{font-size:17px;font-weight:800;line-height:1.25;text-shadow:0 1px 2px rgba(0,0,0,.3)}
    .brand .tag{font-size:9px;letter-spacing:2px;text-transform:uppercase;opacity:.9;margin-top:4px}
    .brand .amountbig{margin-top:26px}
    .brand .amountbig .l{font-size:9px;letter-spacing:2px;text-transform:uppercase;opacity:.85}
    .brand .amountbig .v{font-size:26px;font-weight:900;text-shadow:0 1px 3px rgba(0,0,0,.35)}
    /* Right content */
    .main{flex:1;display:flex;flex-direction:column;padding:18px 24px 12px 34px;position:relative}
    .titlerow{display:flex;justify-content:space-between;align-items:flex-start}
    .gift{font-size:44px;font-weight:900;line-height:.9;
      background:linear-gradient(120deg,#16a34a,#65a30d);-webkit-background-clip:text;background-clip:text;color:transparent}
    .voucher{font-family:'Segoe Script','Brush Script MT',cursive;font-size:30px;color:#b45309;margin-left:44px;margin-top:-8px}
    .goldline{height:2px;width:150px;background:linear-gradient(90deg,#c9a227,#f3e8b0,#c9a227);border-radius:2px;margin-top:4px}
    .qrbox{text-align:center}
    .qr{width:104px;height:104px;border:1px solid #e5e7eb;border-radius:8px;padding:5px;background:#fff}
    .qr svg{width:100%;height:100%;display:block}
    .scanme{display:inline-block;background:#111;color:#fff;font-size:9px;letter-spacing:1px;padding:2.5px 12px;border-radius:4px;margin-top:3px}
    .fields{margin-top:12px;font-size:13px;line-height:2.05}
    .fields b{display:inline-block;min-width:118px;color:#374151;font-weight:600}
    .fields .dots{border-bottom:1.5px dotted #9ca3af;padding:0 8px 1px;font-weight:700}
    .codebar{margin-top:10px;background:#f3faf3;border:1.5px dashed #16a34a;border-radius:8px;
      text-align:center;padding:7px;font-family:'Courier New',monospace;font-size:19px;font-weight:800;letter-spacing:2px;color:#14532d}
    .signrow{display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;font-size:10px;color:#4b5563}
    .signrow .sig{border-top:1px dotted #6b7280;padding-top:3px;width:200px;text-align:center}
    .signrow .valid{font-style:italic}
    .foot{border-top:1px solid #e5e7eb;margin-top:10px;padding-top:7px;display:flex;justify-content:space-between;gap:14px;align-items:flex-end}
    .foot .cdet{font-size:8.5px;color:#b91c1c;line-height:1.55}
    .foot .web{font-size:12px;font-weight:800;color:#15803d}
    .terms{max-width:760px;margin:8px auto 0;font-size:8.5px;color:#6b7280;text-align:center}
  </style></head><body>
    <div class="sheet">
      <div class="card">
        <div class="brand">
          <div class="logo">${logoUrl
            ? `<img src="${esc(logoUrl)}" onerror="this.parentNode.innerHTML='<div class=&quot;ph&quot;>${esc(company.charAt(0))}</div>'"/>`
            : `<div class="ph">${esc(company.charAt(0))}</div>`}</div>
          <div class="co">${company}</div>
          <div class="tag">Gift Coupon</div>
          <div class="amountbig">
            <div class="l">Gift Value</div>
            <div class="v">${money(c.initial_value)}</div>
          </div>
          <div class="ribbon"></div>
          <div class="bow"></div>
        </div>
        <div class="main">
          <div class="titlerow">
            <div>
              <div class="gift">Gift</div>
              <div class="voucher">Voucher</div>
              <div class="goldline"></div>
            </div>
            <div class="qrbox">
              ${qrSvg ? `<div class="qr">${qrSvg}</div><span class="scanme">SCAN ME!</span>` : ''}
            </div>
          </div>
          <div class="fields">
            <div><b>Issued To</b> <span class="dots">${esc(String(c.customer_name || 'Bearer'))}</span></div>
            <div><b>Gift Amount</b> <span class="dots">${money(c.initial_value)}</span>
                 &nbsp;&nbsp;<b style="min-width:60px">Balance</b> <span class="dots">${money(c.balance)}</span></div>
            <div><b>Date</b> <span class="dots">${esc(issuedOn)}</span>
                 &nbsp;&nbsp;<b style="min-width:60px">Branch</b> <span class="dots">${esc(String(c.branch_name || '—'))}</span></div>
          </div>
          <div class="codebar">${esc(code)}</div>
          <div class="signrow">
            <div class="sig">Authorized By &amp; Official Stamp</div>
            <div class="valid">Valid until <b>${esc(validUntil)}</b></div>
          </div>
          <div class="foot">
            <div class="cdet">
              ${address ? `${esc(address)}<br/>` : ''}
              ${[email, phone ? `Phone No - ${phone}` : ''].filter(Boolean).map(esc).join(' &nbsp;·&nbsp; ')}
            </div>
            ${website ? `<div class="web">${esc(website)}</div>` : ''}
          </div>
        </div>
      </div>
      <div class="terms">Present this card or scan the QR at any ${company} counter to check the live balance. The balance can be used across multiple purchases until exhausted or expired. Not exchangeable for cash.</div>
    </div>
  </body></html>`
}

async function printHtml(html: string, design: 'dot' | 'thermal' | 'a4' = 'thermal', paperType = '80mm'): Promise<void> {
  const tmpPath = path.join(app.getPath('temp'), `invoice-${Date.now()}.html`)
  fs.writeFileSync(tmpPath, html, 'utf-8')
  const windowSize = design === 'thermal'
    ? { width: paperType === '58mm' ? 320 : 420, height: 900 }
    : design === 'dot'
      ? { width: 1000, height: 720 }
      : { width: 860, height: 1200 }

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: windowSize.width, height: windowSize.height,
      show: false,
      webPreferences: { contextIsolation: true, nodeIntegration: false }
    })

    win.loadFile(tmpPath)

    win.webContents.on('did-finish-load', () => {
      win.webContents.print(printOptionsForDesign(design, paperType), (success, errorType) => {
        win.close()
        try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
        if (success) resolve()
        else reject(new Error(errorType || 'Print cancelled'))
      })
    })

    win.on('closed', () => {
      try { fs.unlinkSync(tmpPath) } catch { /* ignore */ }
      resolve()
    })
  })
}

function printOptionsForDesign(design: 'dot' | 'thermal' | 'a4', paperType = '80mm'): WebContentsPrintOptions {
  if (design === 'thermal') {
    return {
      silent: false,
      printBackground: true,
      landscape: false,
      margins: { marginType: 'none' },
      pageSize: { width: paperType === '58mm' ? 58000 : 80000, height: 297000 },
      scaleFactor: 100,
    }
  }
  if (design === 'dot') {
    return {
      silent: false,
      printBackground: true,
      landscape: false,
      margins: { marginType: 'none' },
      pageSize: { width: 241000, height: 279000 },
      scaleFactor: 100,
    }
  }
  if (paperType === 'B5') {
    return {
      silent: false,
      printBackground: true,
      landscape: false,
      margins: { marginType: 'none' },
      // Electron's named pageSize enum has no 'B5' entry — use the ISO B5
      // dimensions (176mm x 250mm) in microns instead.
      pageSize: { width: 176000, height: 250000 },
      scaleFactor: 100,
    }
  }
  return {
    silent: false,
    printBackground: true,
    landscape: false,
    margins: { marginType: 'none' },
    pageSize: paperType === 'A5' ? 'A5' : 'A4',
    scaleFactor: 100,
  }
}

function esc(s: string | undefined | null): string {
  if (!s) return ''
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function settingBool(settings: Record<string, unknown>, key: string, fallback: boolean): boolean {
  const value = settings[key]
  return value === undefined ? fallback : Boolean(value)
}

function invoiceSetting(settings: Record<string, unknown>, design: string, field: string, fallback: unknown): unknown {
  const scoped = settings[`invoice_${design}_${field}`]
  if (scoped !== undefined && scoped !== null && scoped !== '') return scoped
  const legacy = settings[`invoice_${field}`]
  if (legacy !== undefined && legacy !== null && legacy !== '') return legacy
  return fallback
}

function invoiceBool(settings: Record<string, unknown>, design: string, field: string, fallback: boolean): boolean {
  const scopedKey = `invoice_${design}_${field}`
  if (settings[scopedKey] !== undefined) return Boolean(settings[scopedKey])
  return settingBool(settings, `invoice_${field}`, fallback)
}

function normalizeInvoiceDesign(value: unknown): 'dot' | 'thermal' | 'a4' {
  const design = String(value || '').toLowerCase()
  if (design === 'dot' || design === 'dot_matrix' || design.includes('dot')) return 'dot'
  if (design === 'a4' || design.includes('a4')) return 'a4'
  return 'thermal'
}

function selectedPaperType(settings: Record<string, unknown>, design: 'dot' | 'thermal' | 'a4'): string {
  const scoped = String(settings[`invoice_${design}_paper_type`] || '')
  if (design === 'dot') return 'dot_matrix'
  if (design === 'thermal') return scoped === '58mm' ? '58mm' : '80mm'
  return scoped === 'A5' ? 'A5' : scoped === 'B5' ? 'B5' : 'A4'
}

async function buildInvoiceHtml(payload: InvoicePayload, settings: Record<string, unknown>): Promise<string> {
  const companyName    = (settings.company_name    as string) || 'Nature Plantation'
  const companyAddress = (settings.company_address as string) || ''
  const companyPhone   = (settings.company_phone   as string) || ''
  const companyEmail   = (settings.company_email   as string) || ''
  const companyWebsite = (settings.company_website as string) || ''
  const companyTin     = (settings.company_tin     as string) || ''
  const invoiceNote    = (settings.invoice_note    as string) || 'Goods once sold will not be taken back or exchanged.'
  const currency       = (settings.currency_symbol as string) || 'Rs.'
  const taxLabel       = (settings.tax_label       as string) || 'VAT'
  const branchName     = (settings.branch_name     as string) || ''
  const isQuotation    = payload.bill_type === 'QUOTATION'
  const docWord        = isQuotation ? 'Quotation' : 'Invoice'
  const docSubtitle    = isQuotation ? 'Price Quotation' : 'Official Tax Invoice'
  const activeDesign   = normalizeInvoiceDesign(payload.invoice_design || settings.invoice_active_design || 'thermal')
  const paperType      = selectedPaperType(settings, activeDesign)
  const logoUrl        = String(invoiceSetting(settings, activeDesign, 'logo_url', ''))
  const headerMessage  = String(invoiceSetting(settings, activeDesign, 'header_message', ''))
  const footerMessage  = String(invoiceSetting(settings, activeDesign, 'footer_message', `Thank you for choosing ${companyName}!`))
  const invoiceTerms   = String(invoiceSetting(settings, activeDesign, 'terms', invoiceNote))
  const showLogo       = invoiceBool(settings, activeDesign, 'show_logo', true)
  const showCompany    = invoiceBool(settings, activeDesign, 'show_company', true)
  const showBranch     = invoiceBool(settings, activeDesign, 'show_branch', true)
  const showAddress    = invoiceBool(settings, activeDesign, 'show_address', true)
  const showPhone      = invoiceBool(settings, activeDesign, 'show_phone', true)
  const showTaxNo      = invoiceBool(settings, activeDesign, 'show_tax_no', true)
  const showBarcode    = invoiceBool(settings, activeDesign, 'show_barcode', true)
  const showQr         = invoiceBool(settings, activeDesign, 'show_qr', true)
  const showSignature  = invoiceBool(settings, activeDesign, 'show_signature', false)
  const showSkuColumn  = invoiceBool(settings, activeDesign, 'show_sku_column', true)
  const showDiscountColumn = invoiceBool(settings, activeDesign, 'show_discount_column', true)

  const invoiceDate = payload.invoice_date || new Date().toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  })

  const fmt = (n: number) =>
    `${esc(currency)}${Number(n).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const itemRows = payload.items.map(item => `
    <tr>
      <td>
        <div class="pname">${esc(item.product_name)}</div>
        ${showSkuColumn && item.sku ? `<div class="psku">${esc(item.sku)}</div>` : ''}
      </td>
      <td class="tr">${item.quantity}</td>
      <td class="tr">${fmt(item.unit_price)}</td>
      ${showDiscountColumn ? `<td class="tr">${item.discount_amount ? fmt(item.discount_amount) : '-'}</td>` : ''}
      <td class="tr">${fmt(item.line_total)}</td>
    </tr>`).join('')

  const customerHtml = (payload.customer_name && payload.customer_name !== 'Walk-in') ? `
    <div class="info-box" style="margin-top:18px">
      <h4>Bill To</h4>
      <p class="iname">${esc(payload.customer_name)}</p>
      ${payload.customer_phone   ? `<p>${esc(payload.customer_phone)}</p>`   : ''}
      ${payload.customer_email   ? `<p>${esc(payload.customer_email)}</p>`   : ''}
      ${payload.customer_address ? `<p>${esc(payload.customer_address)}</p>` : ''}
    </div>` : ''

  const contactLine = [companyPhone, companyEmail, companyWebsite].filter(Boolean).map(esc).join(' &nbsp;|&nbsp; ')
  const dotMatrix = paperType === 'dot_matrix'
  const pageWidth = dotMatrix ? '920px' : paperType === '80mm' ? '302px' : paperType === '58mm' ? '220px' : paperType === 'A5' ? '559px' : paperType === 'B5' ? '665px' : '794px'
  const pageMinHeight = paperType === '80mm' || paperType === '58mm' || dotMatrix ? 'auto' : paperType === 'A5' ? '780px' : paperType === 'B5' ? '945px' : '1100px'
  const pagePadding = dotMatrix ? '24px 36px' : paperType === '80mm' || paperType === '58mm' ? '6px 10px' : '48px'
  const compact = paperType === '80mm' || paperType === '58mm'
  const thermal = activeDesign === 'thermal'
  const printPageSize = dotMatrix ? '241mm 279mm' : paperType === '58mm' ? '58mm 297mm' : paperType === '80mm' ? '80mm 297mm' : paperType === 'A5' ? 'A5' : paperType === 'B5' ? 'B5' : 'A4'

  // Real barcode (Code39 of the invoice no) + real QR encoding the full bill (scannable)
  const barcodeSvg = showBarcode ? buildBarcodeSvg(String(payload.invoice_number || '')) : ''
  const money = (n: unknown) => `${currency}${Number(n || 0).toFixed(2)}`
  const payLabelForQr = String(payload.payment_method || '').replace(/_/g, ' ')
  const qrText = [
    companyName,
    `Invoice: ${payload.invoice_number}`,
    `Date: ${invoiceDate}`,
    payload.cashier_name ? `Cashier: ${payload.cashier_name}` : '',
    branchName ? `Branch: ${branchName}` : '',
    payload.customer_name && payload.customer_name !== 'Walk-in' ? `Customer: ${payload.customer_name}` : '',
    `Total: ${money(payload.total_amount)}`,
    `Paid: ${money(payload.paid_amount)}${payLabelForQr ? ' (' + payLabelForQr + ')' : ''}`,
    '--- Items ---',
    ...payload.items.slice(0, 20).map(i => `${i.product_name} x${i.quantity} = ${money(i.line_total)}`),
    payload.items.length > 20 ? `...+${payload.items.length - 20} more` : '',
  ].filter(Boolean).join('\n')
  let qrSvg = ''
  if (showQr) {
    try { qrSvg = await QRCode.toString(qrText, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' }) } catch { /* ignore */ }
  }

  const paymentMethodLabel: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank Transfer',
    installment: 'Installment',
    gift_voucher: 'Gift Voucher',
    coupon: 'Coupon',
    split: 'Split Payment'
  }
  const payments = (payload.payments || []).filter(p => Number(p.amount) > 0)
  const paymentRows = payments.length > 0
    ? payments
    : [{ method: payload.payment_method, amount: payload.paid_amount, reference: payload.payment_reference }]
  const pmLabel = paymentRows.length > 1
    ? 'Split Payment'
    : (paymentMethodLabel[payload.payment_method] || payload.payment_method)
  const paymentRowsHtml = paymentRows.map(payment => `
        <div class="prow">
          <span class="pl">${esc(paymentMethodLabel[payment.method] || payment.method)}</span>
          <span class="pv">${fmt(payment.amount)}</span>
        </div>
        ${payment.reference
          ? `<div class="prow pref"><span class="pl">${payment.method === 'gift_voucher' ? 'Voucher No.' : payment.method === 'coupon' ? 'Coupon No.' : 'Reference'}</span><span class="pv">${esc(payment.reference)}</span></div>`
          : ''}`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>${docWord} ${esc(payload.invoice_number)}</title>
<style>
@page{size:${printPageSize};margin:0}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:${pageWidth};margin:0;background:#fff}
body{font-family:'Segoe UI',Arial,sans-serif;color:#1a1a1a}
.page{width:${pageWidth};min-height:${pageMinHeight};padding:${pagePadding};background:#fff}

/* Header */
.hdr{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:28px}
.brand{display:flex;align-items:center;gap:14px}
.logo{width:62px;height:62px;background:linear-gradient(135deg,#15803d,#166534);border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0}
.co-name{font-size:26px;font-weight:800;color:#15803d;letter-spacing:-0.5px;line-height:1.1}
.co-sub{font-size:10px;color:#9ca3af;margin-top:4px;letter-spacing:1px;text-transform:uppercase}
.inv-right{text-align:right}
.inv-word{font-size:34px;font-weight:900;color:#e5e7eb;letter-spacing:5px;text-transform:uppercase;line-height:1}
.inv-num{font-size:14px;color:#15803d;font-weight:700;margin-top:6px;font-family:monospace;letter-spacing:0.5px}

/* Green bar */
.gbar{height:4px;background:linear-gradient(90deg,#15803d 0%,#4ade80 60%,#bbf7d0 100%);border-radius:4px;margin:22px 0}

/* Two col */
.two{display:flex;justify-content:space-between;gap:32px;margin-bottom:32px}
.left-col{flex:1}
.info-box h4{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#9ca3af;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6}
.iname{font-weight:700;font-size:15px;color:#111;margin-bottom:3px}
.info-box p{font-size:12px;color:#4b5563;line-height:1.7}

.meta-box{background:#f9fafb;border-radius:10px;padding:16px 20px;border:1px solid #e5e7eb;min-width:230px}
.mrow{display:flex;justify-content:space-between;align-items:center;padding:6px 0}
.mrow:not(:last-child){border-bottom:1px solid #f3f4f6}
.ml{font-size:10px;color:#9ca3af;text-transform:uppercase;letter-spacing:0.8px;font-weight:600}
.mv{font-size:12px;font-weight:600;color:#111}

/* Table */
table{width:100%;border-collapse:collapse;margin-bottom:24px}
thead tr{background:#15803d}
th{padding:10px 14px;font-size:10px;font-weight:700;color:#fff;text-transform:uppercase;letter-spacing:0.8px}
th:first-child{border-radius:6px 0 0 0;text-align:left}
th:last-child{border-radius:0 6px 0 0;text-align:right}
th:nth-child(2),th:nth-child(3){text-align:right}
tbody tr{border-bottom:1px solid #f3f4f6}
tbody tr:nth-child(even){background:#fafafa}
td{padding:11px 14px;font-size:12px;color:#374151}
.tr{text-align:right}
.pname{font-weight:600;color:#111;font-size:13px}
.psku{font-size:10px;color:#9ca3af;margin-top:2px;font-family:monospace}

/* Bottom: payment + totals */
.bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;margin-bottom:24px}
.pay-box{flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px}
.pay-box h4{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#15803d;margin-bottom:12px}
.badge{display:inline-block;background:#15803d;color:#fff;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px}
.prow{display:flex;justify-content:space-between;font-size:12px;padding:5px 0}
.pref{padding-top:0;font-size:11px}
.pl{color:#6b7280}
.pv{font-weight:600;color:#111}
.pv.green{color:#15803d}

.tot-box{width:256px}
.trow{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #f3f4f6}
.tl{color:#6b7280}
.tv{font-weight:500;color:#111}
.trow.disc .tv{color:#dc2626}
.trow.grand{background:#15803d;margin:10px -14px 0;padding:14px 14px;border-radius:10px;border:none}
.trow.grand .tl,.trow.grand .tv{color:#fff;font-size:16px;font-weight:800}

/* Note */
.note{background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:24px}
.note p{font-size:11px;color:#78716c;font-style:italic}

/* Footer */
.foot{border-top:2px solid #e5e7eb;padding-top:20px;text-align:center}
.foot .ty{font-size:17px;font-weight:700;color:#15803d;margin-bottom:4px}
.foot .contact{font-size:11px;color:#9ca3af;margin-top:10px}
.barcode{margin:12px auto 2px;max-width:250px;line-height:0}
.barcode svg{width:100%;height:46px;display:block}
.bc-num{font-size:10px;font-family:monospace;letter-spacing:2px;margin-bottom:8px;color:#111}
.qr{width:120px;height:120px;margin:12px auto;line-height:0}
.qr svg{width:100%;height:100%;display:block}
.sig{width:190px;margin:24px auto 0;border-top:1px solid #6b7280;padding-top:5px;font-size:10px;color:#4b5563}
${compact ? `
.hdr{display:block;text-align:center;margin-bottom:6px}.brand{justify-content:center;gap:8px}.inv-right{text-align:center;margin-top:4px}
.logo{width:42px;height:42px;border-radius:9px}.co-name{font-size:18px}.co-sub{font-size:9px}.inv-word{font-size:18px;letter-spacing:1px;color:#111}.inv-num{font-size:10px}
.gbar{height:2px;margin:6px 0}.two{display:block;margin-bottom:8px}.meta-box{min-width:0;margin-top:6px;padding:6px;border-radius:6px}
.info-box h4{font-size:9px}.info-box p{font-size:10px;line-height:1.3}.mrow{padding:2px 0}.mv{font-size:10px}.ml{font-size:8px}
table{margin-bottom:8px}th,td{padding:4px 3px;font-size:9px}.pname{font-size:10px}.psku{font-size:8px}
.bottom{display:block;margin-bottom:8px}.pay-box{padding:8px;margin-bottom:6px;border-radius:6px}.pay-box h4{font-size:9px}.badge{font-size:9px;padding:3px 8px}.prow{font-size:10px;padding:2px 0}.tot-box{width:100%}
.trow{font-size:11px;padding:4px 0}.trow.grand{padding:8px 10px;border-radius:6px}.trow.grand .tl,.trow.grand .tv{font-size:14px}.note{padding:6px 8px;margin-bottom:8px}.note p,.foot .contact{font-size:9px}.foot{padding-top:8px}.foot .ty{font-size:13px}
.barcode{margin:6px auto 2px;max-width:130px}.barcode svg{height:28px}.bc-num{font-size:9px;margin-bottom:4px}.qr{width:72px;height:72px;margin:6px auto}
` : ''}
${dotMatrix ? `
/* Dot-matrix: dense, fully-ruled letterhead form — logo shown, solid rules
   throughout (not dashed), matching a professional pre-printed continuous
   stationery layout rather than the softer branded designs above. */
body{font-family:'Courier New',monospace}.page{font-family:'Courier New',monospace}
.hdr{border-bottom:2px solid #111;padding-bottom:10px;margin-bottom:10px}
.gbar{display:none}
.logo{border-radius:0;background:#111}
.co-name{font-size:22px;color:#111;letter-spacing:0;font-weight:800}.co-sub,.inv-num{color:#111}.inv-word{font-size:24px;color:#111;letter-spacing:2px}
.reg-no{font-size:10px;color:#111;margin-top:2px}
.two{gap:24px;margin-bottom:14px}
.meta-box,.pay-box,.info-box{border:1px solid #111;background:#fff;border-radius:0;padding:10px}
.info-box h4{border-bottom:1px solid #111;color:#111;padding-bottom:4px;margin-bottom:6px}
.mrow:not(:last-child){border-bottom:1px solid #d1d5db}
table{border:1px solid #111}
thead tr{background:#e5e7eb;border-top:1px solid #111;border-bottom:1px solid #111}
th,td{border:1px solid #111;color:#111}
th:first-child,th:last-child{border-radius:0}
tbody tr,tbody tr:nth-child(even){background:#fff}
.trow.grand{background:#fff;border:2px solid #111;border-radius:0;margin:10px 0 0}.trow.grand .tl,.trow.grand .tv{color:#111}
.note{background:#fff;border:1px solid #111;border-radius:0}
.foot{border-top:2px solid #111}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:18px 0 8px}
.sign .line{border-top:1px solid #111;padding-top:5px;font-size:10px;color:#111;text-align:left}
` : ''}
${thermal ? `
/* Thermal: clean black & white, no logo, no colour */
.logo{display:none}
.brand{gap:0}
.co-name,.inv-word,.inv-num,.foot .ty,.pay-box h4,.pv.green,.badge{color:#000!important}
.co-sub{color:#555}
.gbar{display:none}
/* borderless, professional receipt — separator lines instead of boxes */
.two{border-top:1px solid #000;padding-top:8px}
.meta-box{background:#fff!important;border:none!important;border-radius:0!important;padding:0!important;min-width:0!important}
.info-box h4{border-bottom:1px solid #000!important;color:#000!important}
.pay-box{background:#fff!important;border:none!important;border-radius:0!important;padding:8px 0 0!important;margin-top:6px!important;border-top:1px dashed #000!important}
.pay-box h4{border-bottom:1px solid #000!important;padding-bottom:3px;display:inline-block}
thead tr{background:#fff!important;border-top:1px solid #000;border-bottom:1px solid #000}
th{color:#000!important}
tbody tr:nth-child(even){background:#fff!important}
.badge{background:#000!important;color:#fff!important}
.trow.grand{background:#fff!important;border:none;border-top:1.5px solid #000;border-bottom:1.5px solid #000;border-radius:0;margin:8px 0 0}
.trow.grand .tl,.trow.grand .tv{color:#000!important}
.note{background:#fff!important;border:none!important;border-top:1px dashed #000!important;border-radius:0!important;padding:8px 0 0!important;margin-top:8px;text-align:center}
.note p{font-style:italic}
.foot{border-top:1px solid #000!important}
` : ''}

@media print{
  html,body{-webkit-print-color-adjust:exact!important;print-color-adjust:exact!important}
  .page{padding:${pagePadding}}
}
</style>
</head>
<body class="design-${activeDesign}">
<div class="page design-${activeDesign}">

  <div class="hdr">
    <div class="brand">
      ${showLogo ? `<div class="logo">
        ${logoUrl ? `<img src="${esc(logoUrl)}" style="width:100%;height:100%;object-fit:cover;border-radius:14px" />` : `
        <svg width="34" height="34" viewBox="0 0 24 24" fill="white">
          <path d="M17 8C8 10 5.9 16.17 3.82 21.34L5.71 22l1-2.3A4.49 4.49 0 008 20C19 20 22 3 22 3c-1 2-8 5.5-10 7.5C11 8.5 17 8 17 8z"/>
          <path d="M9.5 9.5C9 12 9 14 9 14s2-1 3.5-2.5" stroke="white" stroke-width="0.5" fill="none"/>
        </svg>
        `}
      </div>` : ''}
      <div>
        ${showCompany ? `<div class="co-name">${esc(companyName)}</div>` : ''}
        <div class="co-sub">${esc(docSubtitle)}</div>
        ${headerMessage ? `<div class="co-sub">${esc(headerMessage)}</div>` : ''}
        ${dotMatrix && showTaxNo && companyTin ? `<div class="reg-no">Reg No: ${esc(companyTin)}</div>` : ''}
      </div>
    </div>
    <div class="inv-right">
      <div class="inv-word">${docWord}</div>
      <div class="inv-num"># ${esc(payload.invoice_number)}</div>
    </div>
  </div>

  <div class="gbar"></div>

  <div class="two">
    <div class="left-col">
      <div class="info-box">
        <h4>From</h4>
        ${showCompany ? `<p class="iname">${esc(companyName)}</p>` : ''}
        ${showAddress && companyAddress ? `<p>${esc(companyAddress)}</p>` : ''}
        ${showPhone && companyPhone   ? `<p>${esc(companyPhone)}</p>`   : ''}
        ${companyEmail   ? `<p>${esc(companyEmail)}</p>`   : ''}
        ${showTaxNo && companyTin ? `<p>TIN / Reg: ${esc(companyTin)}</p>` : ''}
      </div>
      ${customerHtml}
    </div>
    <div>
      <div class="meta-box">
        <div class="mrow"><span class="ml">Invoice No.</span><span class="mv">${esc(payload.invoice_number)}</span></div>
        <div class="mrow"><span class="ml">Date</span><span class="mv">${esc(invoiceDate)}</span></div>
        <div class="mrow"><span class="ml">Cashier</span><span class="mv">${esc(payload.cashier_name || '')}</span></div>
        ${showBranch && branchName ? `<div class="mrow"><span class="ml">Branch</span><span class="mv">${esc(branchName)}</span></div>` : ''}
      </div>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="text-align:left;width:44%">Product / Description</th>
        <th style="text-align:right;width:10%">Qty</th>
        <th style="text-align:right;width:22%">Unit Price</th>
        ${showDiscountColumn ? `<th style="text-align:right;width:12%">Disc</th>` : ''}
        <th style="text-align:right;width:24%">Amount</th>
      </tr>
    </thead>
    <tbody>${itemRows}</tbody>
  </table>

  <div class="bottom">
    <div class="pay-box">
      <h4>Payment Details</h4>
      <div class="badge">${esc(pmLabel)}</div>
      ${paymentRowsHtml}
      <div class="prow"><span class="pl">Amount Paid</span><span class="pv">${fmt(payload.paid_amount)}</span></div>
      ${payload.change_amount > 0
        ? `<div class="prow"><span class="pl">Change Given</span><span class="pv green">${fmt(payload.change_amount)}</span></div>`
        : ''}
    </div>
    <div class="tot-box">
      <div class="trow"><span class="tl">Subtotal</span><span class="tv">${fmt(payload.subtotal)}</span></div>
      ${payload.discount_amount > 0
        ? `<div class="trow disc"><span class="tl">Discount</span><span class="tv">-${fmt(payload.discount_amount)}</span></div>`
        : ''}
      ${payload.tax_amount > 0
        ? `<div class="trow"><span class="tl">${esc(taxLabel)}</span><span class="tv">${fmt(payload.tax_amount)}</span></div>`
        : ''}
      <div class="trow grand"><span class="tl">Total</span><span class="tv">${fmt(payload.total_amount)}</span></div>
    </div>
  </div>

  ${invoiceTerms ? `<div class="note"><p>${esc(invoiceTerms)}</p></div>` : ''}

  ${dotMatrix ? `
  <div class="sign">
    <div class="line">Prepared By</div>
    <div class="line">Received By</div>
  </div>` : ''}

  <div class="foot">
    ${showBarcode && barcodeSvg ? `<div class="barcode">${barcodeSvg}</div><div class="bc-num">${esc(payload.invoice_number)}</div>` : ''}
    ${showQr && qrSvg ? `<div class="qr">${qrSvg}</div>` : ''}
    ${showSignature ? `<div class="sig">Authorized Signature</div>` : ''}
    <div class="ty">${esc(footerMessage)}</div>
    ${contactLine ? `<div class="contact">${contactLine}</div>` : ''}
  </div>

</div>
</body>
</html>`
}

// ─── Pre-printed dot-matrix stationery mode ───────────────────────────────
// The company has had the static parts of the invoice (logo, company name,
// field labels, table header/gridlines, footer text, signature boxes) COLOUR
// PRE-PRINTED onto continuous 241mm x 279mm (9.5"x11") dot-matrix stationery.
// This renderer prints ONLY the variable data at absolute mm coordinates so
// each value lands in the correct blank on that pre-printed sheet — no logo,
// borders, labels or gridlines of our own. Position every field from ONE
// LAYOUT object below so it can be fine-tuned after a real test print
// without touching the render logic; `globalOffset` nudges everything at
// once for quick calibration, per-field x/y for finer correction later.
type Align = 'left' | 'center' | 'right'
interface FieldPos { x: number; y: number; align?: Align }

const PREPRINTED_PAGE_MM = { width: 241, height: 279 }

const LAYOUT = {
  // mm — small nudge (a few mm) to correct printer-feed/margin drift only.
  // NOT the page size — leave at 0,0 unless a calibration print is
  // consistently off by the same amount in every field.
  globalOffset: { x: 0, y: 0 },

  // ---- INFO BOX (top) ---- re-measured directly from the reference template image
  date:         { x: 34,  y: 40 } as FieldPos,
  code:         { x: 34,  y: 45 } as FieldPos,
  name:         { x: 34,  y: 50 } as FieldPos,
  address:      { x: 34,  y: 55 } as FieldPos, // wraps, line step ~4mm
  invoiceNo:    { x: 114, y: 40 } as FieldPos,
  terms:        { x: 114, y: 45 } as FieldPos,
  currency:     { x: 114, y: 50 } as FieldPos,
  deliveryTo:   { x: 114, y: 55 } as FieldPos,
  custPoNo:     { x: 185, y: 40 } as FieldPos,
  copyNo:       { x: 185, y: 45 } as FieldPos,
  deliveryAddr: { x: 185, y: 50 } as FieldPos, // multi-line, line step ~4mm

  // ---- ITEMS TABLE ----
  itemsStartY: 80,   // mm — Y baseline of the FIRST product row (just below the blue table header)
  rowHeight:   7,    // mm between product rows
  col: {
    line: { x: 13,  align: 'center' as Align },
    desc: { x: 23,  align: 'left'   as Align },
    uom:  { x: 128, align: 'center' as Align },
    qty:  { x: 145, align: 'center' as Align },
    loc:  { x: 163, align: 'center' as Align },
    rate: { x: 202, align: 'right'  as Align },
    value:{ x: 234, align: 'right'  as Align },
  },

  // ---- TOTALS ----
  subTotal: { x: 234, y: 163, align: 'right' as Align },
  total:    { x: 234, y: 168, align: 'right' as Align },

  // ---- OPTIONAL ----
  enteredBy: { x: 8,   y: 213 } as FieldPos,
  dateIssue: { x: 193, y: 249 } as FieldPos,
}
// Re-measured from the actual reference template photo (percentage-of-page
// position × 241mm/279mm). Still expect a few mm of drift from printer feed
// tolerance — use "Print Calibration Sheet" (Settings → Invoice Designer →
// Dot Matrix) and globalOffset for that final, small correction only.

function posDiv(x: number, y: number, offsetX: number, offsetY: number, align: Align, content: string, extraCss = ''): string {
  const left = x + offsetX
  const top = y + offsetY
  const base = align === 'right'
    ? `right:calc(${PREPRINTED_PAGE_MM.width}mm - ${left}mm);text-align:right`
    : align === 'center'
      ? `left:${left}mm;text-align:center;transform:translateX(-50%)`
      : `left:${left}mm;text-align:left`
  return `<div style="position:absolute;top:${top}mm;${base};white-space:nowrap;${extraCss}">${content}</div>`
}

function buildPreprintedInvoiceHtml(payload: InvoicePayload, settings: Record<string, unknown>, offsetX: number, offsetY: number, extraHtml = ''): string {
  const L = LAYOUT
  const ox = offsetX + L.globalOffset.x
  const oy = offsetY + L.globalOffset.y
  const currency = String(settings.currency || 'LKR')
  const fmt = (n: number) => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const field = (pos: FieldPos, value: string, extraCss = '') =>
    value ? posDiv(pos.x, pos.y, ox, oy, pos.align || 'left', esc(value), extraCss) : ''

  const itemRows = payload.items.map((item, i) => {
    const y = L.itemsStartY + L.rowHeight * i
    const descHtml = `${esc(item.product_name)}${item.sku ? `<div style="font-size:8pt;margin-top:1mm">${esc(item.sku)}</div>` : ''}`
    return [
      posDiv(L.col.line.x, y, ox, oy, L.col.line.align, String(i + 1)),
      posDiv(L.col.desc.x, y, ox, oy, L.col.desc.align, descHtml, 'white-space:normal;max-width:100mm'),
      posDiv(L.col.uom.x, y, ox, oy, L.col.uom.align, 'Nos'),
      posDiv(L.col.qty.x, y, ox, oy, L.col.qty.align, String(item.quantity)),
      posDiv(L.col.rate.x, y, ox, oy, L.col.rate.align, fmt(item.unit_price)),
      posDiv(L.col.value.x, y, ox, oy, L.col.value.align, fmt(item.line_total)),
    ].join('')
  }).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(payload.invoice_number)}</title>
  <style>
    @page { size: ${PREPRINTED_PAGE_MM.width}mm ${PREPRINTED_PAGE_MM.height}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: transparent; }
    body { font-family: 'Courier New', monospace; font-size: 9pt; color: #000; }
    .page { position: relative; width: ${PREPRINTED_PAGE_MM.width}mm; height: ${PREPRINTED_PAGE_MM.height}mm; }
  </style></head><body>
    <div class="page">
      ${field(L.date, payload.invoice_date || '')}
      ${field(L.code, '')}
      ${field(L.name, payload.customer_name && payload.customer_name !== 'Walk-in' ? payload.customer_name : '')}
      ${field(L.address, payload.customer_address || '', 'white-space:normal;max-width:70mm;line-height:4mm')}
      ${field(L.invoiceNo, payload.invoice_number)}
      ${field(L.terms, String(payload.payment_method || '').replace(/_/g, ' ').toUpperCase())}
      ${field(L.currency, currency)}
      ${field(L.deliveryTo, payload.customer_name && payload.customer_name !== 'Walk-in' ? payload.customer_name : '')}
      ${field(L.custPoNo, '')}
      ${field(L.copyNo, '')}
      ${field(L.deliveryAddr, payload.customer_address || '', 'white-space:normal;max-width:70mm;line-height:4mm')}

      ${itemRows}

      ${field(L.subTotal, fmt(payload.subtotal))}
      ${field(L.total, fmt(payload.total_amount))}

      ${field(L.enteredBy, payload.cashier_name || '')}
      ${field(L.dateIssue, payload.invoice_date || '')}
      ${extraHtml}
    </div>
  </body></html>`
}

// ─── Advanced Layout Designer — fully custom, per-profile JSON layouts ────
// Every element the designer can place (bound text/label, line, image,
// barcode, QR), the item table's columns, and totals, are positioned in mm
// from ONE layout object saved per print profile. This is the SAME
// posDiv()-based absolute-positioning technique as buildPreprintedInvoiceHtml
// above, generalized so it isn't hardcoded to the dot-matrix pre-printed case.
export interface LayoutElement {
  id: string
  type: 'text' | 'line' | 'image' | 'barcode' | 'qr'
  bind?: string | null    // a token from resolveToken(), or null for static text
  staticText?: string     // static label text, or (for type:'image') a data: URL
  x: number
  y: number
  width?: number          // used by 'line' (length, mm) and 'image' (max width, mm)
  font?: string
  size?: number            // pt
  weight?: number
  color?: string
  align?: Align
  visible?: boolean
}
export interface LayoutColumn { field: string; header?: string; x: number; align?: Align }
export interface CustomLayout {
  enabled: boolean
  page: { w: number; h: number }
  prePrinted: boolean
  calibration: { offsetX: number; offsetY: number }
  backgroundDataUrl?: string
  elements: LayoutElement[]
  itemTable: { x: number; y: number; rowHeight: number; maxRows?: number; showHeader?: boolean; columns: LayoutColumn[] }
  totals: Record<'subtotal' | 'discount' | 'tax' | 'total', FieldPos | undefined>
}

function resolveToken(token: string, payload: InvoicePayload, settings: Record<string, unknown>): string {
  const currency = String(settings.currency || 'LKR')
  const fmt = (n: number) => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const custName = payload.customer_name && payload.customer_name !== 'Walk-in' ? payload.customer_name : ''
  switch (token) {
    case 'company.name': return String(settings.company_name || '')
    case 'company.address': return String(settings.company_address || '')
    case 'company.phone': return String(settings.company_phone || '')
    case 'company.email': return String(settings.company_email || '')
    case 'company.regNo': return String(settings.company_tin || '')
    case 'invoice.no': return payload.invoice_number || ''
    case 'invoice.date': return payload.invoice_date || ''
    case 'invoice.time': return payload.invoice_date || ''
    case 'invoice.terms': return String(payload.payment_method || '').replace(/_/g, ' ').toUpperCase()
    case 'invoice.currency': return currency
    case 'invoice.copyNo': return ''
    case 'invoice.poNo': return ''
    case 'branch.name': return String(settings.branch_name || '')
    case 'cashier.name': return payload.cashier_name || ''
    case 'customer.name': return custName
    case 'customer.address': return payload.customer_address || ''
    case 'customer.deliveryTo': return custName
    case 'subtotal': return fmt(payload.subtotal)
    case 'discount': return fmt(payload.discount_amount)
    case 'tax': return fmt(payload.tax_amount)
    case 'total': return fmt(payload.total_amount)
    case 'payment.method': return String(payload.payment_method || '')
    case 'payment.received': return fmt(payload.paid_amount)
    case 'payment.balance': return fmt(Math.max(0, (payload.total_amount || 0) - (payload.paid_amount || 0)))
    default: return ''
  }
}

function resolveItemToken(token: string, item: InvoicePayload['items'][number], index: number): string {
  const fmt = (n: number) => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  switch (token) {
    case 'item.line': return String(index + 1)
    case 'item.code': return item.sku || ''
    case 'item.desc': return item.product_name || ''
    case 'item.uom': return 'Nos'
    case 'item.qty': return String(item.quantity)
    case 'item.loc': return ''
    case 'item.price': return fmt(item.unit_price)
    case 'item.disc': return item.discount_amount ? fmt(item.discount_amount) : ''
    case 'item.amount': return fmt(item.line_total)
    default: return ''
  }
}

async function buildCustomLayoutHtml(
  payload: InvoicePayload, settings: Record<string, unknown>, layout: CustomLayout,
  opts: { includeBackground?: boolean; extraHtml?: string } = {}
): Promise<string> {
  const ox = layout.calibration.offsetX
  const oy = layout.calibration.offsetY
  const pw = layout.page.w
  const ph = layout.page.h

  const elementParts = await Promise.all(layout.elements.filter(e => e.visible !== false).map(async e => {
    const style = `font-family:'${e.font || 'Courier New'}',monospace;font-size:${e.size || 9}pt;font-weight:${e.weight || 400};color:${e.color || '#000'}`
    if (e.type === 'line') {
      return `<div style="position:absolute;left:${e.x + ox}mm;top:${e.y + oy}mm;width:${e.width || 20}mm;border-top:0.3mm solid ${e.color || '#000'}"></div>`
    }
    if (e.type === 'image') {
      if (!e.staticText) return ''
      return `<img src="${esc(e.staticText)}" style="position:absolute;left:${e.x + ox}mm;top:${e.y + oy}mm;max-width:${e.width || 40}mm;max-height:20mm" />`
    }
    if (e.type === 'barcode') {
      const svg = buildBarcodeSvg(payload.invoice_number)
      return `<div style="position:absolute;left:${e.x + ox}mm;top:${e.y + oy}mm;width:${e.width || 40}mm;line-height:0">${svg}</div>`
    }
    if (e.type === 'qr') {
      let qrSvg = ''
      try { qrSvg = await QRCode.toString(payload.invoice_number, { type: 'svg', margin: 0, errorCorrectionLevel: 'M' }) } catch { /* ignore */ }
      return `<div style="position:absolute;left:${e.x + ox}mm;top:${e.y + oy}mm;width:${e.width || 20}mm;line-height:0">${qrSvg}</div>`
    }
    const text = esc(e.bind ? resolveToken(e.bind, payload, settings) : (e.staticText || ''))
    if (!text) return ''
    return posDiv(e.x, e.y, ox, oy, e.align || 'left', text, style)
  }))

  const t = layout.itemTable
  const maxRows = t.maxRows || payload.items.length
  const itemRows = payload.items.slice(0, maxRows).map((item, i) => {
    const y = t.y + t.rowHeight * i
    return t.columns.map(col =>
      posDiv(col.x, y, ox, oy, col.align || 'left', esc(resolveItemToken(col.field, item, i)))
    ).join('')
  }).join('')
  const tableHeader = t.showHeader
    ? t.columns.map(col => posDiv(col.x, t.y - t.rowHeight, ox, oy, col.align || 'left', esc(col.header || ''), 'font-weight:700')).join('')
    : ''

  const totalsHtml = (['subtotal', 'discount', 'tax', 'total'] as const).map(key => {
    const pos = layout.totals[key]
    if (!pos) return ''
    const value = key === 'subtotal' ? payload.subtotal : key === 'discount' ? payload.discount_amount : key === 'tax' ? payload.tax_amount : payload.total_amount
    const fmt = Number(value || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    return posDiv(pos.x, pos.y, ox, oy, pos.align || 'right', fmt)
  }).join('')

  const backgroundHtml = opts.includeBackground && layout.backgroundDataUrl
    ? `<img src="${esc(layout.backgroundDataUrl)}" style="position:absolute;left:0;top:0;width:${pw}mm;height:${ph}mm;opacity:0.5;z-index:0" />`
    : ''

  return `<!doctype html><html><head><meta charset="utf-8"><title>Invoice ${esc(payload.invoice_number)}</title>
  <style>
    @page { size: ${pw}mm ${ph}mm; margin: 0; }
    * { box-sizing: border-box; }
    html, body { margin: 0; padding: 0; background: ${layout.prePrinted ? 'transparent' : '#fff'}; }
    body { font-family: 'Courier New', monospace; color: #000; }
    .page { position: relative; width: ${pw}mm; height: ${ph}mm; z-index: 1; }
  </style></head><body>
    ${backgroundHtml}
    <div class="page">
      ${elementParts.join('')}
      ${tableHeader}
      ${itemRows}
      ${totalsHtml}
      ${opts.extraHtml || ''}
    </div>
  </body></html>`
}

// Chooses which renderer to use for a print job: a saved custom layout for
// this profile (Part B/C — Advanced Layout Designer) if one exists and is
// enabled, else the existing pre-printed dot-matrix mode, else the built-in
// branded template. Used by both printer:printInvoice (actual print/PDF) and
// printer:renderInvoiceHtml (designer live preview) so they can never drift.
async function resolveInvoiceHtml(
  payload: InvoicePayload, settings: Record<string, unknown>, design: 'dot' | 'thermal' | 'a4',
  opts: { includeBackground?: boolean } = {}
): Promise<string> {
  const customLayoutRaw = settings[`invoice_${design}_custom_layout_json`] as string | undefined
  if (customLayoutRaw) {
    try {
      const layout = JSON.parse(customLayoutRaw) as CustomLayout
      if (layout.enabled) return buildCustomLayoutHtml(payload, settings, layout, opts)
    } catch { /* fall through to built-in templates on malformed JSON */ }
  }
  if (design === 'dot' && Boolean(settings.invoice_dot_preprinted_mode)) {
    return buildPreprintedInvoiceHtml(payload, settings,
      Number(settings.invoice_dot_preprinted_offset_x) || 0, Number(settings.invoice_dot_preprinted_offset_y) || 0)
  }
  return buildInvoiceHtml(payload, settings)
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

function buildEmailBody(payload: InvoicePayload, settings: Record<string, unknown>): string {
  const companyName = (settings.company_name as string) || 'Nature Plantation'
  const currency    = (settings.currency_symbol as string) || 'Rs.'
  const fmt = (n: number) => `${currency}${Number(n).toFixed(2)}`
  const paymentMethodLabel: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank Transfer',
    installment: 'Installment',
    gift_voucher: 'Gift Voucher',
    coupon: 'Coupon',
    split: 'Split Payment'
  }
  const payments = (payload.payments || []).filter(p => Number(p.amount) > 0)
  const paymentLines = payments.length > 0
    ? payments.flatMap(payment => [
        `${paymentMethodLabel[payment.method] || payment.method}: ${fmt(payment.amount)}`,
        ...(payment.reference ? [`  Ref: ${payment.reference}`] : []),
      ])
    : [
        `${paymentMethodLabel[payload.payment_method] || payload.payment_method}: ${fmt(payload.paid_amount)}`,
        ...(payload.payment_reference ? [`  Ref: ${payload.payment_reference}`] : []),
      ]

  const lines = [
    `Dear ${payload.customer_name || 'Customer'},`,
    '',
    `Please find your invoice details below.`,
    '',
    `Invoice No : ${payload.invoice_number}`,
    `Date       : ${payload.invoice_date || new Date().toLocaleString()}`,
    `Cashier    : ${payload.cashier_name || ''}`,
    '',
    '─────────────────────────────',
    'ITEMS',
    '─────────────────────────────',
    ...payload.items.map(i => `  ${i.product_name} x${i.quantity}    ${fmt(i.line_total)}`),
    '─────────────────────────────',
    `Subtotal   : ${fmt(payload.subtotal)}`,
    ...(payload.discount_amount > 0 ? [`Discount   : -${fmt(payload.discount_amount)}`] : []),
    ...(payload.tax_amount > 0      ? [`Tax        : ${fmt(payload.tax_amount)}`]        : []),
    `TOTAL      : ${fmt(payload.total_amount)}`,
    `Payment    : ${payments.length > 1 ? 'Split Payment' : (paymentMethodLabel[payload.payment_method] || payload.payment_method)}`,
    ...paymentLines,
    `Paid       : ${fmt(payload.paid_amount)}`,
    ...(payload.change_amount > 0   ? [`Change     : ${fmt(payload.change_amount)}`]     : []),
    '',
    `Thank you for shopping at ${companyName}!`,
  ]
  return lines.join('\n')
}

function buildReceiptText(payload: Record<string, unknown>, settings: Record<string, unknown>): string {
  const sep = '================================'
  const header   = (settings.company_name     as string) || (settings.receipt_header as string) || 'Nature Plantation'
  const footer   = (settings.receipt_footer   as string) || 'Thank you for your purchase!'
  const currency = (settings.currency_symbol  as string) || 'Rs.'

  const lines: string[] = [
    header, sep,
    `Invoice: ${payload.invoice_number}`,
    `Date: ${new Date().toLocaleString()}`,
    `Cashier: ${payload.cashier_name}`,
    sep, 'ITEMS:', sep
  ]

  for (const item of (payload.items || []) as Record<string, unknown>[]) {
    lines.push(`${item.product_name}`)
    lines.push(`  ${item.quantity} x ${currency}${Number(item.unit_price).toFixed(2)} = ${currency}${Number(item.line_total).toFixed(2)}`)
  }

  lines.push(sep)
  lines.push(`Subtotal:  ${currency}${Number(payload.subtotal).toFixed(2)}`)
  if (Number(payload.discount_amount) > 0) lines.push(`Discount:  -${currency}${Number(payload.discount_amount).toFixed(2)}`)
  if (Number(payload.tax_amount) > 0)      lines.push(`Tax:       ${currency}${Number(payload.tax_amount).toFixed(2)}`)
  lines.push(`TOTAL:     ${currency}${Number(payload.total_amount).toFixed(2)}`)
  lines.push(sep)
  lines.push(footer)
  lines.push('')

  return lines.join('\n')
}
