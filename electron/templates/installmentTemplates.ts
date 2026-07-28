// Installment payment card / passbook template — relocated byte-for-byte
// out of ipc/printer.ts (Phase 8 of the PrinterService refactor).

import QRCode from 'qrcode'
import { esc } from './htmlUtils'

// Installment payment card / passbook — a membership-style hard copy the customer
// keeps. Every payment: tick the row, write the amount, sign. QR verifies the plan.
export async function buildInstallmentCardHtml(t: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
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
