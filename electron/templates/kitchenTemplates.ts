// Kitchen order ticket — deliberately separate from the invoice/receipt
// templates in ipc/printer.ts: no prices, larger font for kitchen-floor
// readability, and only the fields kitchen staff need (item, qty, notes).

export interface KitchenTicketItem {
  product_name: string
  sku?: string
  quantity: number
  notes?: string
}

export interface KitchenTicketPayload {
  invoice_number?: string
  invoice_date?: string
  cashier_name?: string
  customer_name?: string
  notes?: string
  items: KitchenTicketItem[]
}

function esc(s: string | undefined | null): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildKitchenTicketHtml(payload: KitchenTicketPayload, settings: Record<string, unknown>): string {
  const company = esc(String(settings.company_name || 'Nature Plantation'))
  const time = payload.invoice_date || new Date().toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

  return `<html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; font-family: 'Courier New', monospace; }
    body { width: 100%; padding: 6mm 4mm; }
    .center { text-align:center; }
    .title { font-size: 20px; font-weight:bold; }
    .meta { font-size: 13px; margin-top: 4px; }
    .hr { border-top: 1px dashed #000; margin: 6px 0; }
    .item { font-size: 18px; font-weight:bold; margin: 6px 0 2px; }
    .item-notes { font-size: 13px; margin-left: 4mm; margin-bottom: 4px; }
    .footer-notes { font-size: 13px; margin-top: 8px; font-style: italic; }
  </style></head>
  <body>
    <div class="center">
      <div class="title">KITCHEN ORDER</div>
      <div class="meta">${company}</div>
      <div class="meta">${esc(payload.invoice_number ? `#${payload.invoice_number}` : '')} ${esc(time)}</div>
      ${payload.customer_name && payload.customer_name !== 'Walk-in' ? `<div class="meta">Customer: ${esc(payload.customer_name)}</div>` : ''}
      ${payload.cashier_name ? `<div class="meta">Cashier: ${esc(payload.cashier_name)}</div>` : ''}
    </div>
    <div class="hr"></div>
    ${payload.items.map(item => `
      <div class="item">${item.quantity} x ${esc(item.product_name)}</div>
      ${item.notes ? `<div class="item-notes">Note: ${esc(item.notes)}</div>` : ''}
    `).join('')}
    <div class="hr"></div>
    ${payload.notes ? `<div class="footer-notes">${esc(payload.notes)}</div>` : ''}
  </body></html>`
}
