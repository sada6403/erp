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

// SmartBuy / Chit Fund voucher — physically A6 (105mm x 148mm), printed four
// to an A4 sheet for cut-apart distribution (spec §31-33): no printer in this
// app is configured for a raw A6 paper size, so instead of plumbing a new
// physical page size through printerService.ts, this renders the whole A4
// sheet itself with mm-based CSS and lets printHtml(html,'a4','A4') print it
// as-is — the existing, already-supported A4 path. Deliberately visually
// distinct from buildCouponHtml's normal gift-voucher card (spec §3/§18: a
// SmartBuy voucher must never look like an ordinary POS coupon) — amber/gold
// brand panel instead of green, explicit "SMARTBUY / CHIT FUND VOUCHER"
// label, and the Scheme/Member/Agent fields a normal coupon doesn't have.
// Accepts 1-4 coupons; unused cells render as a blank cut-guide only — never
// fabricate a placeholder voucher. Reprinting simply calls this again with
// the same coupon row(s): no new id/code/QR/balance is ever generated here.
export async function buildSmartBuyVoucherGridHtml(coupons: Record<string, unknown>[], settings: Record<string, unknown>): Promise<string> {
  const company = esc((settings.company_name as string) || 'Nature Plantation')
  const cur = String(settings.currency_symbol || 'Rs.')
  const money = (n: unknown) => `${cur}${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const logoUrl = String(settings.company_logo_url || settings.brand_logo_url || '')
  const cloudUrl = String(settings.cloud_api_url || '').trim().replace(/\/+$/, '')

  const cells = await Promise.all(coupons.slice(0, 4).map(async c => {
    const code = String(c.code || '')
    const qrPayload = cloudUrl ? `${cloudUrl}/coupon/${encodeURIComponent(code)}` : code
    let qrSvg = ''
    // Higher error correction (Q, ~25% recoverable) than the normal coupon
    // card's 'M' — this is a higher-stakes financial document and the A6 cut
    // sheet is more likely to get folded/creased/handled roughly than a
    // full-page gift card. margin:2 keeps a proper quiet zone around the
    // code so a scanner/camera can actually lock onto it.
    try { qrSvg = await QRCode.toString(qrPayload, { type: 'svg', margin: 2, errorCorrectionLevel: 'Q' }) } catch { /* ignore */ }
    const issuedOn = c.created_at ? String(c.created_at).slice(0, 10) : new Date().toISOString().slice(0, 10)
    const scheme = [c.smartbuy_scheme_name, c.smartbuy_scheme_number ? `(${c.smartbuy_scheme_number})` : ''].filter(Boolean).join(' ')
    return `
      <div class="voucher">
        <div class="brand">
          <div class="logo">${logoUrl
            ? `<img src="${esc(logoUrl)}" onerror="this.parentNode.innerHTML='<div class=&quot;ph&quot;>${esc(company.charAt(0))}</div>'"/>`
            : `<div class="ph">${esc(company.charAt(0))}</div>`}</div>
          <div class="co">${company}</div>
          <div class="kind">SmartBuy<br/>Chit Fund Voucher</div>
        </div>
        <div class="body">
          <div class="fields">
            <div><b>Customer</b> <span>${esc(String(c.customer_name || '—'))}</span></div>
            <div><b>Scheme</b> <span>${esc(scheme || '—')}</span></div>
            <div><b>Member ID</b> <span>${esc(String(c.smartbuy_member_id || '—'))}</span></div>
            <div><b>Agent</b> <span>${esc(String(c.agent_name || '—'))} ${c.agent_code ? `(${esc(String(c.agent_code))})` : ''}</span></div>
            <div><b>Voucher No</b> <span>${esc(code)}</span></div>
            <div><b>Issue Date</b> <span>${esc(issuedOn)}</span></div>
          </div>
          <div class="valuerow">
            <div class="value">
              <div class="l">Value</div>
              <div class="v">${money(c.initial_value)}</div>
            </div>
          </div>
          ${qrSvg ? `<div class="qrbox"><div class="qr">${qrSvg}</div><span class="scanme">SCAN AT POS TO REDEEM</span></div>` : ''}
          <div class="terms">Redeemable at any POS counter. Non-transferable. This voucher's Agent cannot be changed except by authorized Super Admin action. Subject to company SmartBuy terms &amp; conditions.</div>
        </div>
      </div>`
  }))
  while (cells.length < 4) cells.push('<div class="voucher blank"></div>')

  return `<!doctype html><html><head><meta charset="utf-8"><style>
    @page { size: A4; margin: 0 }
    *{box-sizing:border-box}
    html,body{margin:0;padding:0}
    body{font-family:Arial,Helvetica,sans-serif;color:#1a1a1a}
    .sheet{width:210mm;height:297mm;display:grid;grid-template-columns:105mm 105mm;grid-template-rows:148.5mm 148.5mm}
    .voucher{width:105mm;height:148.5mm;padding:4mm;border:1px dashed #9ca3af;display:flex;flex-direction:column;overflow:hidden}
    .voucher.blank{border-style:dashed;border-color:#d1d5db}
    .brand{display:flex;align-items:center;gap:6px;border-radius:6px;padding:6px 8px;color:#fff;
      background:linear-gradient(135deg,#b45309 0%,#92400e 55%,#78350f 100%)}
    .logo{width:26px;height:26px;border-radius:6px;background:#fff;flex-shrink:0;display:flex;align-items:center;justify-content:center;overflow:hidden}
    .logo img{width:100%;height:100%;object-fit:contain}
    .logo .ph{font-size:13px;font-weight:900;color:#92400e}
    .co{font-size:11px;font-weight:800;flex:1}
    .kind{font-size:8px;font-weight:800;letter-spacing:.5px;text-align:right;line-height:1.2;text-transform:uppercase}
    .body{flex:1;display:flex;flex-direction:column;margin-top:6px}
    .fields{font-size:8.5px;line-height:1.7}
    .fields b{display:inline-block;min-width:52px;color:#78350f;font-weight:700}
    .valuerow{display:flex;justify-content:center;align-items:center;margin-top:5px;
      background:#fffbeb;border:1px dashed #d97706;border-radius:6px;padding:6px 8px}
    .value{text-align:center}
    .value .l{font-size:7px;letter-spacing:1px;text-transform:uppercase;color:#92400e}
    .value .v{font-size:19px;font-weight:900;color:#78350f}
    /* mm units (not px) so the physical QR size is DPI-independent —
       30mm is comfortably scannable by both a phone camera and a
       handheld POS barcode/QR scanner from a printed A6 card. */
    .qrbox{text-align:center;margin-top:6px}
    .qr{width:30mm;height:30mm;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:4px;padding:2mm}
    .qr svg{width:100%;height:100%;display:block}
    .scanme{display:block;font-size:7px;font-weight:800;letter-spacing:.5px;margin-top:3px;color:#78350f}
    .terms{margin-top:auto;font-size:5.5px;color:#6b7280;line-height:1.4;padding-top:4px}
  </style></head><body>
    <div class="sheet">${cells.join('')}</div>
  </body></html>`
}
