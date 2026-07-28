// Branch-transfer delivery note / stock-transfer note templates — relocated
// byte-for-byte out of ipc/printer.ts (Phase 8 of the PrinterService refactor).

import QRCode from 'qrcode'
import { esc } from './htmlUtils'
import { buildBarcodeSvg } from './barcodeTemplates'

// Branch-transfer delivery note / issue note — same layout as the renderer's
// preview iframe in StockTransfersPage.tsx, rebuilt here so it can actually
// be printed/exported (see printer:printDeliveryNote in ipc/printer.ts for why).
export function buildDeliveryNoteHtml(t: Record<string, unknown>): string {
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
export async function buildTransferNoteHtml(t: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
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
