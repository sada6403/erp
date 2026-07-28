// Gift coupon card template — relocated byte-for-byte out of ipc/printer.ts
// (Phase 8 of the PrinterService refactor).

import QRCode from 'qrcode'
import { esc } from './htmlUtils'

// Gift coupon card — premium design matching the shop's printed vouchers:
// company logo, green gradient panel, script "Gift Voucher" title, company
// details footer. The QR encodes a LINK to the public coupon-status page
// (live balance / expiry when scanned with a phone); the POS scanner path
// extracts the CPN- code from the URL automatically. Falls back to encoding
// the bare code when no cloud URL is configured.
export async function buildCouponHtml(c: Record<string, unknown>, settings: Record<string, unknown>): Promise<string> {
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
