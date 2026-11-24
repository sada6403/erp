export interface PurchaseQuotationItem {
  product_name: string
  sku?: string
  barcode?: string
  unit?: string
  current_stock?: number
  min_stock_level?: number
  quantity: number
  unit_cost: number
  selling_price?: number | string
  line_total: number
  is_low_stock?: boolean
  is_out_of_stock?: boolean
}

export interface PurchaseQuotationPayload {
  document_title?: string
  document_number: string
  date: string
  expected_date?: string
  company_name?: string
  company_address?: string
  company_phone?: string
  company_email?: string
  supplier: {
    name: string
    business_name?: string
    phone?: string
    mobile_number?: string
    email?: string
    address?: string
    city?: string
  }
  items: PurchaseQuotationItem[]
  total_amount: number
  notes?: string
  created_by_name?: string
}

function esc(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

export function buildPurchaseQuotationHtml(p: PurchaseQuotationPayload): string {
  const company = esc(p.company_name || 'Nature Plantation - Supermarket')
  const title = esc(p.document_title || 'SUPPLIER PURCHASE QUOTATION / கொள்முதல் கோரிக்கை')
  const docNum = esc(p.document_number || 'DRAFT-QUO')
  const dateStr = esc(p.date || new Date().toISOString().slice(0, 10))
  const expectedStr = p.expected_date ? esc(p.expected_date) : 'Immediate / Standard'

  const suppName = esc(p.supplier.business_name || p.supplier.name || 'Supplier')
  const suppPhone = esc(p.supplier.mobile_number || p.supplier.phone || '—')
  const suppEmail = esc(p.supplier.email || '—')
  const suppAddr = esc([p.supplier.address, p.supplier.city].filter(Boolean).join(', ') || '—')

  const totalQty = p.items.reduce((sum, item) => sum + Number(item.quantity || 0), 0)
  const lowStockCount = p.items.filter(i => i.is_low_stock || i.is_out_of_stock || (i.current_stock !== undefined && i.min_stock_level !== undefined && i.current_stock <= i.min_stock_level)).length

  const rows = p.items.map((item, idx) => {
    const isOut = item.is_out_of_stock || (item.current_stock !== undefined && item.current_stock <= 0)
    const isLow = !isOut && (item.is_low_stock || (item.current_stock !== undefined && item.min_stock_level !== undefined && item.current_stock <= item.min_stock_level))

    let stockBadge = ''
    if (item.current_stock !== undefined) {
      if (isOut) {
        stockBadge = `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:10px;">OUT OF STOCK (0)</span>`
      } else if (isLow) {
        stockBadge = `<span style="display:inline-block;padding:2px 6px;border-radius:4px;background:#fef3c7;color:#92400e;font-weight:700;font-size:10px;">LOW (${item.current_stock} / Min: ${item.min_stock_level ?? 5})</span>`
      } else {
        stockBadge = `<span style="color:#059669;font-weight:600;font-size:11px;">${item.current_stock} ${esc(item.unit || 'pcs')}</span>`
      }
    } else {
      stockBadge = `<span style="color:#6b7280;font-size:11px;">—</span>`
    }

    return `
      <tr>
        <td style="text-align:center;color:#6b7280;">${idx + 1}</td>
        <td>
          <div style="font-weight:600;color:#111827;">${esc(item.product_name)}</div>
          <div style="font-size:10px;color:#6b7280;margin-top:2px;">
            ${item.sku ? `SKU: ${esc(item.sku)}` : ''}
            ${item.barcode ? ` · Barcode: ${esc(item.barcode)}` : ''}
            ${item.unit ? ` · Unit: ${esc(item.unit)}` : ''}
          </div>
        </td>
        <td style="text-align:center;">${stockBadge}</td>
        <td style="text-align:right;font-weight:700;font-size:13px;color:#0f172a;">${Number(item.quantity).toLocaleString()}</td>
        <td style="text-align:right;color:#374151;">Rs.${Number(item.unit_cost || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
        <td style="text-align:right;font-weight:700;color:#047857;">Rs.${Number(item.line_total || (item.quantity * item.unit_cost) || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
      </tr>
    `
  }).join('')

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Purchase Quotation ${docNum}</title>
  <style>
    @page { size: A4 portrait; margin: 12mm 15mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      color: #0f172a;
      background: #ffffff;
      margin: 0;
      padding: 0;
      font-size: 11px;
      line-height: 1.4;
    }
    .print-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: #0f172a;
      color: #ffffff;
      padding: 10px 16px;
      margin-bottom: 12px;
      border-radius: 6px;
    }
    .print-actions button {
      background: #3b82f6;
      color: white;
      border: none;
      padding: 6px 14px;
      border-radius: 4px;
      font-weight: 600;
      font-size: 12px;
      cursor: pointer;
    }
    @media print {
      .print-actions { display: none !important; }
      body { margin: 0; padding: 0; }
    }
    .header {
      display: flex;
      justify-content: space-between;
      border-bottom: 2px solid #0f172a;
      padding-bottom: 10px;
      margin-bottom: 14px;
    }
    .company-title {
      font-size: 20px;
      font-weight: 800;
      color: #0f172a;
      letter-spacing: -0.02em;
      margin: 0 0 4px 0;
    }
    .company-sub {
      color: #475569;
      font-size: 11px;
    }
    .doc-badge {
      text-align: right;
    }
    .doc-type {
      font-size: 14px;
      font-weight: 800;
      color: #0369a1;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .doc-number {
      font-size: 16px;
      font-weight: 800;
      color: #0f172a;
      font-family: monospace;
      margin-top: 3px;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1.2fr 1fr;
      gap: 14px;
      margin-bottom: 14px;
    }
    .box {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 10px 12px;
      background: #f8fafc;
    }
    .box-title {
      font-size: 10px;
      text-transform: uppercase;
      font-weight: 800;
      color: #64748b;
      margin-bottom: 6px;
      letter-spacing: 0.05em;
      border-bottom: 1px solid #e2e8f0;
      padding-bottom: 4px;
    }
    .box-row {
      display: flex;
      justify-content: space-between;
      margin-bottom: 3px;
    }
    .box-label {
      color: #64748b;
      font-size: 10.5px;
    }
    .box-val {
      font-weight: 600;
      color: #1e293b;
      text-align: right;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      font-size: 11px;
    }
    th {
      background: #0f172a;
      color: #ffffff;
      padding: 7px 8px;
      font-weight: 700;
      text-transform: uppercase;
      font-size: 10px;
      letter-spacing: 0.03em;
      border: 1px solid #0f172a;
    }
    td {
      padding: 6px 8px;
      border: 1px solid #cbd5e1;
      vertical-align: middle;
    }
    tr:nth-child(even) {
      background: #f8fafc;
    }
    .totals-area {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-top: 12px;
      gap: 16px;
    }
    .summary-box {
      width: 280px;
      border: 1.5px solid #0f172a;
      border-radius: 6px;
      padding: 8px 12px;
      background: #f8fafc;
    }
    .summary-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
      font-size: 11px;
    }
    .summary-total {
      border-top: 2px solid #0f172a;
      margin-top: 4px;
      padding-top: 6px;
      font-size: 14px;
      font-weight: 900;
      color: #047857;
    }
    .notes-box {
      flex: 1;
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 12px;
      background: #ffffff;
      min-height: 60px;
    }
    .sign-section {
      display: grid;
      grid-template-columns: 1fr 1fr 1fr;
      gap: 20px;
      margin-top: 36px;
      padding-top: 10px;
    }
    .sign-line {
      border-top: 1px dotted #475569;
      text-align: center;
      padding-top: 6px;
      font-size: 10px;
      color: #475569;
      font-weight: 600;
    }
    .footer {
      margin-top: 20px;
      padding-top: 8px;
      border-top: 1px solid #e2e8f0;
      font-size: 9px;
      color: #94a3b8;
      display: flex;
      justify-content: space-between;
    }
  </style>
</head>
<body>
  <div class="print-actions">
    <div><strong>Purchase Quotation / Order Sheet</strong> &mdash; ${docNum}</div>
    <div style="display:flex;gap:8px;">
      <button onclick="window.print()">🖨️ Print / Save as PDF</button>
      <button style="background:#475569;" onclick="window.close()">Close</button>
    </div>
  </div>

  <div class="header">
    <div>
      <h1 class="company-title">${company}</h1>
      <div class="company-sub">
        ${p.company_address ? `${esc(p.company_address)} · ` : ''}
        ${p.company_phone ? `Phone: ${esc(p.company_phone)} · ` : ''}
        ${p.company_email ? `Email: ${esc(p.company_email)}` : 'Enterprise Supermarket & POS ERP'}
      </div>
    </div>
    <div class="doc-badge">
      <div class="doc-type">${title}</div>
      <div class="doc-number">${docNum}</div>
      <div style="font-size:10px;color:#64748b;margin-top:2px;">Date: ${dateStr}</div>
    </div>
  </div>

  <div class="info-grid">
    <div class="box">
      <div class="box-title">SUPPLIER INFORMATION (சப்ளையர் விபரம்)</div>
      <div class="box-row"><span class="box-label">Supplier Name:</span><span class="box-val">${suppName}</span></div>
      <div class="box-row"><span class="box-label">Mobile / Phone:</span><span class="box-val">${suppPhone}</span></div>
      <div class="box-row"><span class="box-label">Email:</span><span class="box-val">${suppEmail}</span></div>
      <div class="box-row"><span class="box-label">Address:</span><span class="box-val">${suppAddr}</span></div>
    </div>

    <div class="box">
      <div class="box-title">QUOTATION & ORDER DETAILS</div>
      <div class="box-row"><span class="box-label">Quotation / PO #:</span><span class="box-val">${docNum}</span></div>
      <div class="box-row"><span class="box-label">Quotation Date:</span><span class="box-val">${dateStr}</span></div>
      <div class="box-row"><span class="box-label">Expected Delivery:</span><span class="box-val">${expectedStr}</span></div>
      ${lowStockCount > 0 ? `<div class="box-row"><span class="box-label">Low Stock Replenishment:</span><span class="box-val" style="color:#b91c1c;">${lowStockCount} items auto-analyzed</span></div>` : ''}
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th style="width:30px;">#</th>
        <th>Product & Specification (பொருள்)</th>
        <th style="width:130px;text-align:center;">Current Stock (தற்போதைய இருப்பு)</th>
        <th style="width:75px;text-align:right;">Order Qty</th>
        <th style="width:95px;text-align:right;">Unit Cost</th>
        <th style="width:105px;text-align:right;">Total Amount</th>
      </tr>
    </thead>
    <tbody>
      ${rows}
    </tbody>
  </table>

  <div class="totals-area">
    <div class="notes-box">
      <div style="font-weight:700;font-size:10px;color:#64748b;margin-bottom:4px;text-transform:uppercase;">Instructions / Notes (குறிப்புகள்):</div>
      <div style="font-size:10.5px;color:#334155;">
        ${p.notes ? esc(p.notes) : 'Please confirm supply schedule and send invoice copy upon dispatch. Stock should match indicated batch specifications.'}
      </div>
    </div>

    <div class="summary-box">
      <div class="summary-row">
        <span>Total Product Items:</span>
        <span style="font-weight:700;">${p.items.length}</span>
      </div>
      <div class="summary-row">
        <span>Total Units:</span>
        <span style="font-weight:700;">${totalQty.toLocaleString()}</span>
      </div>
      <div class="summary-row summary-total">
        <span>Quotation Total:</span>
        <span>Rs.${p.total_amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
      </div>
    </div>
  </div>

  <div class="sign-section">
    <div>
      <div style="height:35px;"></div>
      <div class="sign-line">Prepared By (கொள்முதல் அதிகாரி)<br/><span style="font-size:9px;color:#94a3b8;">${esc(p.created_by_name || 'Procurement Team')}</span></div>
    </div>
    <div>
      <div style="height:35px;"></div>
      <div class="sign-line">Authorized By (கிளை மேலாளர் / இயக்குநர்)<br/><span style="font-size:9px;color:#94a3b8;">Store Manager / Director</span></div>
    </div>
    <div>
      <div style="height:35px;"></div>
      <div class="sign-line">Supplier Acceptance (சப்ளையர் ஒப்புதல்)<br/><span style="font-size:9px;color:#94a3b8;">Signature & Date</span></div>
    </div>
  </div>

  <div class="footer">
    <span>${company} &bull; Generated from POS ERP</span>
    <span>Printed on: ${new Date().toLocaleString()}</span>
  </div>
</body>
</html>`
}

export function printPurchaseQuotation(payload: PurchaseQuotationPayload): void {
  const html = buildPurchaseQuotationHtml(payload)

  // Try creating an iframe for clean print dialog
  try {
    const iframe = document.createElement('iframe')
    iframe.style.position = 'fixed'
    iframe.style.right = '0'
    iframe.style.bottom = '0'
    iframe.style.width = '0'
    iframe.style.height = '0'
    iframe.style.border = '0'
    document.body.appendChild(iframe)

    const doc = iframe.contentWindow?.document
    if (doc) {
      doc.open()
      doc.write(html)
      doc.close()
      iframe.contentWindow?.focus()
      setTimeout(() => {
        try {
          iframe.contentWindow?.print()
        } catch (e) {
          console.warn('Iframe print error, falling back to window.open', e)
          openPrintWindow(html)
        }
        setTimeout(() => {
          try { iframe.remove() } catch { /* ignore */ }
        }, 3000)
      }, 400)
      return
    }
  } catch (err) {
    console.warn('Iframe print failed', err)
  }

  openPrintWindow(html)
}

function openPrintWindow(html: string) {
  const win = window.open('', '_blank', 'width=880,height=960,top=50,left=100')
  if (win) {
    win.document.open()
    win.document.write(html)
    win.document.close()
    win.focus()
  }
}

