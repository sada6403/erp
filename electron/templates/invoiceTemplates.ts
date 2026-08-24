// Invoice/quotation templates — relocated byte-for-byte out of ipc/printer.ts
// (Phase 8 of the PrinterService refactor). Behavior is unchanged: same
// inputs, same settings lookups, same HTML output. resolveInvoiceHtml() is
// still the single dispatcher used by both real printing and the
// InvoiceDesignerPage live preview, so preview can never drift from print.

import QRCode from 'qrcode'
import { esc } from './htmlUtils'
import { buildBarcodeSvg } from './barcodeTemplates'

export interface PaymentLine {
  method: string
  amount: number
  reference?: string
}

export interface InvoicePayload {
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

export function normalizeInvoiceDesign(value: unknown): 'dot' | 'thermal' | 'a4' | 'b5' {
  const design = String(value || '').toLowerCase()
  if (design === 'dot' || design === 'dot_matrix' || design.includes('dot')) return 'dot'
  if (design === 'b5' || design.includes('b5')) return 'b5'
  if (design === 'a4' || design.includes('a4')) return 'a4'
  return 'thermal'
}

export function selectedPaperType(settings: Record<string, unknown>, design: 'dot' | 'thermal' | 'a4' | 'b5'): string {
  const scoped = String(settings[`invoice_${design}_paper_type`] || '')
  if (design === 'dot') return 'dot_matrix'
  if (design === 'thermal') return scoped === '58mm' ? '58mm' : '80mm'
  if (design === 'b5') return 'B5'
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
.co-sub{font-size:10px;color:#4b5563;margin-top:4px;letter-spacing:1px;text-transform:uppercase}
.inv-right{text-align:right}
.inv-word{font-size:34px;font-weight:900;color:#e5e7eb;letter-spacing:5px;text-transform:uppercase;line-height:1}
.inv-num{font-size:14px;color:#15803d;font-weight:700;margin-top:6px;font-family:monospace;letter-spacing:0.5px}

/* Green bar */
.gbar{height:4px;background:linear-gradient(90deg,#15803d 0%,#4ade80 60%,#bbf7d0 100%);border-radius:4px;margin:22px 0}

/* Two col */
.two{display:flex;justify-content:space-between;gap:32px;margin-bottom:32px}
.left-col{flex:1}
.info-box h4{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#4b5563;margin-bottom:6px;padding-bottom:4px;border-bottom:1px solid #f3f4f6}
.iname{font-weight:700;font-size:15px;color:#111;margin-bottom:3px}
.info-box p{font-size:12px;color:#4b5563;line-height:1.7}

.meta-box{background:#f9fafb;border-radius:10px;padding:16px 20px;border:1px solid #e5e7eb;min-width:230px}
.mrow{display:flex;justify-content:space-between;align-items:center;padding:6px 0}
.mrow:not(:last-child){border-bottom:1px solid #f3f4f6}
.ml{font-size:10px;color:#4b5563;text-transform:uppercase;letter-spacing:0.8px;font-weight:600}
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
.psku{font-size:10px;color:#4b5563;margin-top:2px;font-family:monospace}

/* Bottom: payment + totals */
.bottom{display:flex;justify-content:space-between;align-items:flex-start;gap:32px;margin-bottom:24px}
.pay-box{flex:1;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px;padding:20px}
.pay-box h4{font-size:9px;font-weight:700;text-transform:uppercase;letter-spacing:1.5px;color:#15803d;margin-bottom:12px}
.badge{display:inline-block;background:#15803d;color:#fff;padding:5px 14px;border-radius:20px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.8px;margin-bottom:12px}
.prow{display:flex;justify-content:space-between;font-size:12px;padding:5px 0}
.pref{padding-top:0;font-size:11px}
.pl{color:#4b5563}
.pv{font-weight:600;color:#111}
.pv.green{color:#15803d}

.tot-box{width:256px}
.trow{display:flex;justify-content:space-between;padding:7px 0;font-size:13px;border-bottom:1px solid #f3f4f6}
.tl{color:#4b5563}
.tv{font-weight:500;color:#111}
.trow.disc .tv{color:#dc2626}
.trow.grand{background:#15803d;margin:10px -14px 0;padding:14px 14px;border-radius:10px;border:none}
.trow.grand .tl,.trow.grand .tv{color:#fff;font-size:16px;font-weight:800}

/* Note */
.note{background:#fffbeb;border-left:3px solid #f59e0b;padding:10px 14px;border-radius:0 6px 6px 0;margin-bottom:24px}
.note p{font-size:11px;color:#4b5563;font-style:italic}

/* Footer */
.foot{border-top:2px solid #e5e7eb;padding-top:20px;text-align:center}
.foot .ty{font-size:17px;font-weight:700;color:#15803d;margin-bottom:4px}
.foot .contact{font-size:11px;color:#4b5563;margin-top:10px}
.barcode{margin:12px auto 2px;max-width:250px;line-height:0}
.barcode svg{width:100%;height:46px;display:block}
.bc-num{font-size:10px;font-family:monospace;letter-spacing:2px;margin-bottom:8px;color:#111}
.qr{width:120px;height:120px;margin:12px auto;line-height:0}
.qr svg{width:100%;height:100%;display:block}
.sig{width:190px;margin:24px auto 0;border-top:1px solid #6b7280;padding-top:5px;font-size:10px;color:#4b5563}
${compact ? `
/* Thermal (58/80mm) legibility pass: the original 8-9px sizes were too
   small/thin for typical ~203dpi thermal print heads to render cleanly
   (reported as blurry). Nothing here drops below 10px, and line/table
   items — the text that matters most on a receipt — sit at 11-12px. */
.hdr{display:block;text-align:center;margin-bottom:6px}.brand{justify-content:center;gap:8px}.inv-right{text-align:center;margin-top:4px}
.logo{width:42px;height:42px;border-radius:9px}.co-name{font-size:19px}.co-sub{font-size:10px}.inv-word{font-size:19px;letter-spacing:1px;color:#111}.inv-num{font-size:11px}
.gbar{height:2px;margin:6px 0}.two{display:block;margin-bottom:8px}.meta-box{min-width:0;margin-top:6px;padding:6px;border-radius:6px}
.info-box h4{font-size:10px}.info-box p{font-size:11px;line-height:1.4}.mrow{padding:3px 0}.mv{font-size:11px}.ml{font-size:9px}
table{margin-bottom:8px}th,td{padding:5px 4px;font-size:11px}.pname{font-size:12px}.psku{font-size:10px}
.bottom{display:block;margin-bottom:8px}.pay-box{padding:8px;margin-bottom:6px;border-radius:6px}.pay-box h4{font-size:10px}.badge{font-size:10px;padding:3px 8px}.prow{font-size:11px;padding:3px 0}.tot-box{width:100%}
.trow{font-size:12px;padding:4px 0}.trow.grand{padding:8px 10px;border-radius:6px}.trow.grand .tl,.trow.grand .tv{font-size:15px}.note{padding:6px 8px;margin-bottom:8px}.note p,.foot .contact{font-size:10px}.foot{padding-top:8px}.foot .ty{font-size:14px}
.barcode{margin:6px auto 2px;max-width:130px}.barcode svg{height:28px}.bc-num{font-size:10px;margin-bottom:4px}.qr{width:72px;height:72px;margin:6px auto}
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
/* Thermal: clean black & white, no logo, no colour. Segoe UI's thin strokes
   wash out on thermal print heads at small sizes — Arial/Helvetica render
   with heavier, more uniform strokes and are standard system fonts (not a
   web font that could fail to embed in the print job). */
body,.page{font-family:'Arial','Helvetica Neue',sans-serif}
td,.psku,.mv,.trow,.ml{font-weight:500}
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

export const LAYOUT = {
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

export function buildPreprintedInvoiceHtml(payload: InvoicePayload, settings: Record<string, unknown>, offsetX: number, offsetY: number, extraHtml = ''): string {
  const L = LAYOUT
  const ox = offsetX + L.globalOffset.x
  const oy = offsetY + L.globalOffset.y
  const currency = String(settings.currency || 'LKR')
  const fmt = (n: number) => Number(n || 0).toLocaleString('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const field = (pos: FieldPos, value: string, extraCss = '') =>
    value ? posDiv(pos.x, pos.y, ox, oy, pos.align || 'left', esc(value), extraCss) : ''

  const itemRows = payload.items.map((item, i) => {
    const y = L.itemsStartY + L.rowHeight * i
    const descHtml = `${esc(item.product_name)}${item.sku ? `<div style="font-size:9pt;margin-top:1mm">${esc(item.sku)}</div>` : ''}`
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
    /* 9pt/8pt was too fine for a dot-matrix impact head to reproduce cleanly
       (reported as blurry) — bumped up a point and made semi-bold, which
       impact printers render as denser, more solid dots per character. */
    body { font-family: 'Courier New', monospace; font-size: 10pt; font-weight: 600; color: #000; }
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

export async function buildCustomLayoutHtml(
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
export async function resolveInvoiceHtml(
  payload: InvoicePayload, settings: Record<string, unknown>, design: 'dot' | 'thermal' | 'a4' | 'b5',
  opts: { includeBackground?: boolean } = {}
): Promise<string> {
  const customLayoutRaw = settings[`invoice_${design}_custom_layout_json`] as string | undefined
  if (customLayoutRaw) {
    try {
      const layout = JSON.parse(customLayoutRaw) as CustomLayout
      if (layout.enabled) {
        // A real print job (no explicit opts) bakes the uploaded background
        // image in unless the layout is marked prePrinted — i.e. a company
        // printing onto plain A4/B5 paper gets the image as part of the
        // output, while one with real pre-printed stationery still gets
        // data-only output, matching how dot-matrix pre-printed mode already
        // behaves. Callers that explicitly pass includeBackground (the
        // designer's live preview, always wants it on for calibration) are
        // unaffected either way.
        const effectiveOpts = { ...opts, includeBackground: opts.includeBackground ?? !layout.prePrinted }
        return buildCustomLayoutHtml(payload, settings, layout, effectiveOpts)
      }
    } catch { /* fall through to built-in templates on malformed JSON */ }
  }
  if (design === 'dot' && Boolean(settings.invoice_dot_preprinted_mode)) {
    return buildPreprintedInvoiceHtml(payload, settings,
      Number(settings.invoice_dot_preprinted_offset_x) || 0, Number(settings.invoice_dot_preprinted_offset_y) || 0)
  }
  return buildInvoiceHtml(payload, settings)
}

export function buildEmailBody(payload: InvoicePayload, settings: Record<string, unknown>): string {
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
