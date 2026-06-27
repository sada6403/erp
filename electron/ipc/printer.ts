import type { IpcMain, WebContentsPrintOptions } from 'electron'
import { BrowserWindow, shell, app } from 'electron'
import Store from 'electron-store'
import path from 'path'
import fs from 'fs'

const store = new Store()

interface PaymentLine {
  method: string
  amount: number
  reference?: string
}

interface InvoicePayload {
  invoice_number: string
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
  ipcMain.handle('printer:printReceipt', async (_e, payload) => {
    try {
      const settings = store.get('app_settings') as Record<string, unknown> || {}
      const lines = buildReceiptText(payload, settings)
      console.log('[PRINTER - text]', lines)
      return { success: true, data: { receipt_text: lines } }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('printer:printInvoice', async (_e, payload: InvoicePayload) => {
    try {
      const settings = store.get('app_settings') as Record<string, unknown> || {}
      const html = buildInvoiceHtml(payload, settings)
      const design = normalizeInvoiceDesign(payload.invoice_design || settings.invoice_active_design || 'thermal')
      await printHtml(html, design, selectedPaperType(settings, design))
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('printer:emailInvoice', async (_e, payload: InvoicePayload) => {
    try {
      const settings = store.get('app_settings') as Record<string, unknown> || {}
      const companyName = (settings.company_name as string) || 'Nature Plantation'
      const toEmail = payload.customer_email || ''
      const subject = `Invoice ${payload.invoice_number} - ${companyName}`
      const body = buildEmailBody(payload, settings)
      const mailtoUrl = `mailto:${encodeURIComponent(toEmail)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
      await shell.openExternal(mailtoUrl)
      return { success: true }
    } catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('printer:test', async () => {
    try { return { success: true, data: 'Test print queued' } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })

  ipcMain.handle('printer:listDevices', async () => {
    try { return { success: true, data: [] } }
    catch (err: unknown) { return { success: false, error: (err as Error).message } }
  })
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
  return scoped === 'A5' ? 'A5' : 'A4'
}

function buildInvoiceHtml(payload: InvoicePayload, settings: Record<string, unknown>): string {
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
  const pageWidth = dotMatrix ? '920px' : paperType === '80mm' ? '302px' : paperType === '58mm' ? '220px' : paperType === 'A5' ? '559px' : '794px'
  const pageMinHeight = paperType === '80mm' || paperType === '58mm' || dotMatrix ? 'auto' : paperType === 'A5' ? '780px' : '1100px'
  const pagePadding = dotMatrix ? '24px 36px' : paperType === '80mm' || paperType === '58mm' ? '14px' : '48px'
  const compact = paperType === '80mm' || paperType === '58mm'
  const printPageSize = dotMatrix ? '241mm 279mm' : paperType === '58mm' ? '58mm 297mm' : paperType === '80mm' ? '80mm 297mm' : paperType === 'A5' ? 'A5' : 'A4'

  const paymentMethodLabel: Record<string, string> = {
    cash: 'Cash',
    card: 'Card',
    bank_transfer: 'Bank Transfer',
    installment: 'Installment',
    gift_voucher: 'Gift Voucher',
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
          ? `<div class="prow pref"><span class="pl">${payment.method === 'gift_voucher' ? 'Voucher No.' : 'Reference'}</span><span class="pv">${esc(payment.reference)}</span></div>`
          : ''}`).join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Invoice ${esc(payload.invoice_number)}</title>
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
.barcode{height:34px;margin:8px auto;background:repeating-linear-gradient(90deg,#111 0 2px,transparent 2px 4px,#111 4px 5px,transparent 5px 8px);max-width:230px}
.qr{width:54px;height:54px;margin:8px auto;background:
  linear-gradient(90deg,#111 50%,transparent 0) 0 0/8px 8px,
  linear-gradient(#111 50%,transparent 0) 0 0/8px 8px;
  border:6px solid #111}
.sig{width:190px;margin:24px auto 0;border-top:1px solid #6b7280;padding-top:5px;font-size:10px;color:#4b5563}
${compact ? `
.hdr{display:block;text-align:center;margin-bottom:10px}.brand{justify-content:center;gap:8px}.inv-right{text-align:center;margin-top:6px}
.logo{width:42px;height:42px;border-radius:9px}.co-name{font-size:17px}.co-sub{font-size:8px}.inv-word{font-size:18px;letter-spacing:1px;color:#111}.inv-num{font-size:10px}
.gbar{height:2px;margin:10px 0}.two{display:block;margin-bottom:12px}.meta-box{min-width:0;margin-top:8px;padding:8px;border-radius:6px}
.info-box h4{font-size:8px}.info-box p,.mrow,.mv{font-size:9px}.ml{font-size:7px}
table{margin-bottom:12px}th,td{padding:5px 3px;font-size:8px}.pname{font-size:9px}.psku{font-size:7px}
.bottom{display:block;margin-bottom:12px}.pay-box{padding:9px;margin-bottom:8px;border-radius:6px}.pay-box h4{font-size:8px}.badge{font-size:8px;padding:3px 8px}.prow{font-size:9px;padding:3px 0}.tot-box{width:100%}
.trow{font-size:10px;padding:5px 0}.trow.grand{padding:9px 10px;border-radius:6px}.trow.grand .tl,.trow.grand .tv{font-size:13px}.note{padding:7px 9px;margin-bottom:12px}.note p,.foot .contact{font-size:8px}.foot{padding-top:10px}.foot .ty{font-size:12px}
.barcode{height:24px;max-width:180px}.qr{width:42px;height:42px;border-width:4px}
` : ''}
${dotMatrix ? `
body{font-family:'Courier New',monospace}.page{font-family:'Courier New',monospace}
.hdr{border-bottom:1px dashed #111;padding-bottom:10px;margin-bottom:14px}.logo,.gbar{display:none}
.co-name{font-size:20px;color:#111;letter-spacing:0}.co-sub,.inv-num{color:#111}.inv-word{font-size:24px;color:#111;letter-spacing:2px}
.two{gap:24px;margin-bottom:18px}.meta-box,.pay-box{border:1px dashed #111;background:#fff;border-radius:0}.info-box h4{border-bottom:1px dashed #111;color:#111}
thead tr{background:#fff;border-top:1px dashed #111;border-bottom:1px dashed #111}th{color:#111;padding:6px 8px}td{padding:6px 8px}
tbody tr,tbody tr:nth-child(even){background:#fff;border-bottom:1px dashed #d1d5db}.trow.grand{background:#fff;border:1px dashed #111;border-radius:0}.trow.grand .tl,.trow.grand .tv{color:#111}
.note{background:#fff;border:1px dashed #111;border-radius:0}.foot{border-top:1px dashed #111}
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
        <div class="co-sub">Official Tax Invoice</div>
        ${headerMessage ? `<div class="co-sub">${esc(headerMessage)}</div>` : ''}
      </div>
    </div>
    <div class="inv-right">
      <div class="inv-word">Invoice</div>
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

  <div class="foot">
    ${showBarcode ? `<div class="barcode"></div><div style="font-size:10px;font-family:monospace">${esc(payload.invoice_number)}</div>` : ''}
    ${showQr ? `<div class="qr"></div>` : ''}
    ${showSignature ? `<div class="sig">Authorized Signature</div>` : ''}
    <div class="ty">${esc(footerMessage)}</div>
    ${contactLine ? `<div class="contact">${contactLine}</div>` : ''}
  </div>

</div>
</body>
</html>`
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
