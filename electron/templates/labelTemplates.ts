// Product/barcode label — small-format template, separate from receipts and
// invoices since it only ever needs a scannable code + product name + price.

import { buildBarcodeSvg } from './barcodeTemplates'

export interface LabelPayload {
  product_name: string
  sku?: string
  barcode?: string
  price?: number
  currency_symbol?: string
}

function esc(s: string | undefined | null): string {
  if (!s) return ''
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export function buildLabelHtml(payload: LabelPayload, settings: Record<string, unknown>): string {
  const code = payload.barcode || payload.sku || ''
  const svg = code ? buildBarcodeSvg(code, 32) : ''
  const currency = payload.currency_symbol || String(settings.currency_symbol || 'Rs.')
  const price = payload.price != null ? `${currency}${Number(payload.price).toFixed(2)}` : ''

  return `<html><head><style>
    * { margin:0; padding:0; box-sizing:border-box; font-family: Arial, sans-serif; }
    body { width: 100%; height: 100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding: 2mm; text-align:center; }
    .name { font-size: 11px; font-weight:bold; line-height:1.1; max-width: 100%; overflow:hidden; }
    .barcode { width: 90%; margin: 1mm 0; }
    .code { font-size: 9px; letter-spacing: 1px; }
    .price { font-size: 14px; font-weight:bold; margin-top: 1mm; }
  </style></head>
  <body>
    <div class="name">${esc(payload.product_name)}</div>
    ${svg ? `<div class="barcode">${svg}</div><div class="code">${esc(code)}</div>` : ''}
    ${price ? `<div class="price">${esc(price)}</div>` : ''}
  </body></html>`
}
