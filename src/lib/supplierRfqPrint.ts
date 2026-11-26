/** Supplier-facing Request for Quotation. Deliberately carries no costs, selling prices or margins. */
export interface SupplierRfqPayload {
  rfq_number: string
  date: string
  required_by?: string
  company: { name: string; address?: string; phone?: string; email?: string; branch?: string }
  supplier: { name: string; business_name?: string; phone?: string; mobile_number?: string; email?: string; address?: string }
  items: { name: string; code?: string; unit?: string; quantity: number; remarks?: string }[]
  requested_items?: { name: string; unit?: string; quantity: number; remarks?: string }[]
  delivery_requirements?: string
}

const esc = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]!))

export function buildSupplierRfqHtml(p: SupplierRfqPayload): string {
  const rows = [
    ...p.items.map(item => ({ ...item, isNew: false })),
    ...(p.requested_items || []).map(item => ({ ...item, code: 'NEW ITEM', isNew: true })),
  ]
  const body = rows.map((item, i) => `<tr>
    <td class="c">${i + 1}</td><td>${esc(item.name)}${item.isNew ? ' <em>(new item)</em>' : ''}</td><td>${esc(item.code)}</td>
    <td class="c">${esc(item.unit || '')}</td><td class="r"><strong>${esc(item.quantity)}</strong></td><td>${esc(item.remarks || '')}</td>
    <td class="blank"></td><td class="blank"></td><td class="blank"></td><td class="blank"></td></tr>`).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(p.rfq_number)}</title><style>
    @page { size: A4; margin: 14mm }
    body { font-family: Segoe UI, Arial, sans-serif; color: #111; font-size: 12px }
    h1 { font-size: 20px; margin: 0 0 4px } .muted { color: #555 }
    .head { display: flex; justify-content: space-between; gap: 24px; border-bottom: 2px solid #111; padding-bottom: 10px; margin-bottom: 12px }
    .box { border: 1px solid #999; padding: 8px 10px; border-radius: 4px; flex: 1 }
    .meta { display: flex; gap: 12px; margin-bottom: 12px }
    table { width: 100%; border-collapse: collapse } th, td { border: 1px solid #999; padding: 5px 6px; vertical-align: top }
    th { background: #f0f0f0; font-size: 11px; text-align: left } .c { text-align: center } .r { text-align: right }
    td.blank { width: 62px } .sign { display: flex; justify-content: space-between; margin-top: 40px } .sign div { border-top: 1px solid #111; width: 38%; padding-top: 4px; text-align: center }
  </style></head><body>
    <div class="head"><div><h1>${esc(p.company.name)}</h1><div class="muted">${[p.company.address, p.company.phone, p.company.email].filter(Boolean).map(esc).join(' · ')}</div>
      ${p.company.branch ? `<div class="muted">Deliver to: ${esc(p.company.branch)}</div>` : ''}</div>
      <div style="text-align:right"><h1>REQUEST FOR QUOTATION</h1><div><strong>${esc(p.rfq_number)}</strong></div><div>Date: ${esc(p.date)}</div>${p.required_by ? `<div>Required by: <strong>${esc(p.required_by)}</strong></div>` : ''}</div></div>
    <div class="meta"><div class="box"><strong>To supplier</strong><br>${esc(p.supplier.business_name || p.supplier.name)}${p.supplier.business_name ? `<br>${esc(p.supplier.name)}` : ''}
      ${[p.supplier.mobile_number || p.supplier.phone, p.supplier.email, p.supplier.address].filter(Boolean).map(v => `<br>${esc(v)}`).join('')}</div>
      <div class="box"><strong>Delivery requirements</strong><br>${esc(p.delivery_requirements || 'Please state your earliest delivery date.')}</div></div>
    <p>Please quote your best price for the items below. Fill in the unit price, discount and any free quantity for each line and return this form.</p>
    <table><thead><tr><th class="c">#</th><th>Product</th><th>Code</th><th class="c">Unit</th><th class="r">Qty</th><th>Remarks</th><th>Unit price</th><th>Discount</th><th>Free qty</th><th>Total</th></tr></thead><tbody>${body}</tbody></table>
    <p class="muted">Prices should include applicable taxes unless stated. Quantities are requests only and will be confirmed with a purchase order.</p>
    <div class="sign"><div>Requested by</div><div>Supplier signature &amp; date</div></div>
  </body></html>`
}

export function printSupplierRfq(payload: SupplierRfqPayload): void {
  const html = buildSupplierRfqHtml(payload)
  const iframe = document.createElement('iframe')
  Object.assign(iframe.style, { position: 'fixed', right: '0', bottom: '0', width: '0', height: '0', border: '0' })
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { iframe.remove(); return }
  doc.open(); doc.write(html); doc.close()
  iframe.contentWindow?.focus()
  // The Windows print dialog also offers "Microsoft Print to PDF" for a PDF copy.
  setTimeout(() => { try { iframe.contentWindow?.print() } finally { setTimeout(() => iframe.remove(), 3000) } }, 300)
}
