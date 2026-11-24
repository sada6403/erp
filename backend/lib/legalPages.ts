// Public privacy-policy and account-deletion pages for the Play listing. Filled from the company profile
// (POS Settings), so nothing company-specific is written in code and nothing needs a redeploy to change.
import type { CompanyProfileResponse } from '@/lib/app/contracts/company'

const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }
export const esc = (s: string): string => s.replace(/[&<>"']/g, (ch) => ENT[ch])

const CSS = `:root{--bg:#fbfbf6;--fg:#222a14;--muted:#5b6347;--accent:#5a6b2e;--line:#dfe3cf}
@media (prefers-color-scheme:dark){:root{--bg:#161a0e;--fg:#e9edd8;--muted:#a9b08f;--accent:#b7c97a;--line:#2c3320}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.65 system-ui,-apple-system,"Segoe UI",Roboto,"Noto Sans Tamil","Noto Sans Sinhala",sans-serif}
main{max-width:760px;margin:0 auto;padding:24px 16px 64px}h1{font-size:1.8rem;margin:.2em 0}h2{font-size:1.2rem;margin-top:2em;color:var(--accent)}
.muted{color:var(--muted);font-size:.9rem}table{border-collapse:collapse;width:100%;margin:1em 0;font-size:.95rem}
th,td{border:1px solid var(--line);padding:8px 10px;text-align:left;vertical-align:top}.box{border:1px solid var(--line);border-radius:12px;padding:14px 16px;margin:1em 0}a{color:var(--accent)}`

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>${CSS}</style></head><body><main>${body}</main></body></html>`
}

function updated(p: CompanyProfileResponse): string {
  const d = p.updated_at ? new Date(p.updated_at) : new Date()
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'Asia/Colombo' }).format(d)
}

/** "<legal name>, <address>"; whatever the company has not entered is left out. */
function operator(p: CompanyProfileResponse): string {
  return [p.legal_name, p.address].filter(Boolean).map((x) => esc(x as string)).join(', ')
}
function contact(p: CompanyProfileResponse): string {
  const parts: string[] = []
  if (p.support_email) parts.push(`<a href="mailto:${esc(p.support_email)}">${esc(p.support_email)}</a>`)
  if (p.support_phone) parts.push(esc(p.support_phone))
  if (p.website) parts.push(esc(p.website))
  return parts.join(' &middot; ')
}

export function privacyPolicyHtml(p: CompanyProfileResponse): string {
  const app = esc(p.name)
  const c = contact(p)
  return page(`Privacy Policy - ${p.name} app`, `
<h1>Privacy Policy</h1>
<p class="muted">${app} mobile app (Android) &middot; Last updated: ${updated(p)}</p>
<p>This policy explains what personal information the ${app} app ("the app") collects, why, who can see it, how long we keep it, and how you can delete it. The app is operated by <strong>${operator(p)}</strong> ("we", "us").${c ? ` Contact: ${c}.` : ''}${p.tin ? ` Registration no.: ${esc(p.tin)}.` : ''}</p>

<h2>1. Information we collect</h2>
<table>
<tr><th>What</th><th>Why</th></tr>
<tr><td><strong>Account details</strong>: name, mobile number, optional email, member number or agent code, language choice. Your password is stored only as a one-way hash.</td><td>To create your account, sign you in and show the right dashboard.</td></tr>
<tr><td><strong>Delivery details</strong>: addresses and recipient phone numbers you save.</td><td>To deliver your orders.</td></tr>
<tr><td><strong>Orders</strong>: items, prices, payment method, status and delivery confirmation code.</td><td>To process, deliver, and support your orders, and for our accounting.</td></tr>
<tr><td><strong>Smart Buy savings information</strong> (if you are a member): your scheme, contributions, draws and wallet balance, as recorded by our branches.</td><td>To show you your own statement.</td></tr>
<tr><td><strong>Field officers</strong>: assigned deliveries, members served, earnings records.</td><td>To run deliveries and pay commissions.</td></tr>
<tr><td><strong>Device information</strong>: a notification token, device model, Android version, app version.</td><td>To send order and account notifications and to make the app work on your phone.</td></tr>
<tr><td><strong>Wish list and cart</strong>.</td><td>To remember what you saved. The cart is stored on your phone until you order.</td></tr>
</table>
<p>The app does <strong>not</strong> collect your location, contacts, photos, microphone or camera data, and it contains no advertising or third-party analytics.</p>

<h2>2. How we use it</h2>
<p>To run the shop and Smart Buy services, deliver orders, send notifications about your orders and account, give customer support, prevent fraud and keep our accounts as the law requires. We do not sell your information and we do not use it for advertising.</p>

<h2>3. Who can see it</h2>
<ul>
<li><strong>Our staff</strong>, only as needed for their job (for example a branch sees the orders for its customers).</li>
<li><strong>Service providers</strong> that run the app on our behalf: our hosting server, and the push notification services of Expo and Google (Firebase Cloud Messaging), which receive your device's notification token and the notification text so they can deliver it.</li>
<li><strong>WhatsApp</strong>: our staff may send your first login details to you through WhatsApp. WhatsApp's own privacy policy applies to that message.</li>
<li>Authorities, when the law requires it.</li>
</ul>

<h2>4. Security</h2>
<p>Data travels over encrypted connections (HTTPS). Passwords are hashed. Sign-in tokens are kept in your phone's secure storage. No system is perfectly secure, but we limit access and keep the server up to date.</p>

<h2>5. How long we keep it</h2>
<p>We keep your account while you use the app. Order and accounting records are kept for as long as our legal, tax and accounting duties require, even after you delete your account (see section 6). Notification tokens are removed when you sign out or delete your account.</p>

<h2>6. Your choices: access, correction, deletion</h2>
<p>You can change your name, addresses, language and notification settings in the app. To <strong>delete your account</strong>, open <em>Settings &rarr; Delete account</em> in the app, or follow the steps at <a href="${esc(p.delete_account_url)}">${esc(p.delete_account_url)}</a>. When your account is deleted we remove your name, phone number, email and password, saved addresses, wish list, notifications and device tokens, and you can no longer sign in. Order, payment and Smart Buy records that we must keep for accounting stay in our books without your app login. You may also ask us to correct or delete your data, or tell us about a concern, by contacting us. You have rights under the Personal Data Protection Act, No. 9 of 2022 of Sri Lanka, where it applies.</p>

<h2>7. Children</h2>
<p>The app is not meant for children under 13, and we do not knowingly collect their information.</p>

<h2>8. Changes</h2>
<p>If we change this policy we will update the date above and, for important changes, tell you in the app.</p>

<h2>9. Contact</h2>
<p>${operator(p)}${c ? ` &middot; ${c}` : ''}</p>`)
}

export function accountDeletionHtml(p: CompanyProfileResponse): string {
  const app = esc(p.name)
  const box = [
    p.support_email ? `Email: <a href="mailto:${esc(p.support_email)}">${esc(p.support_email)}</a>` : '',
    p.support_phone ? `Phone / WhatsApp: ${esc(p.support_phone)}` : '',
    `Subject: <em>Delete my ${app} account</em>`,
    'Include: your name and the mobile number or member number on the account.',
  ].filter(Boolean).join('<br>')
  return page(`Delete your account - ${p.name} app`, `
<h1>Delete your ${app} account</h1>
<p class="muted">App: ${app} (Android) &middot; Operator: ${esc(p.legal_name)}</p>

<h2>Option 1: in the app (fastest)</h2>
<ol><li>Open the app and sign in.</li><li>Go to <strong>Settings &rarr; Delete account</strong>.</li><li>Read the warning, type your password and confirm.</li></ol>
<p>Your account is deleted immediately and you are signed out on all devices.</p>

<h2>Option 2: ask us</h2>
<p>If you cannot sign in or no longer have the app, send a request from the phone number registered with your account:</p>
<div class="box">${box}</div>
<p>We may ask a question to confirm it is really you. We complete verified requests within 7 days.</p>

<h2>What is deleted</h2>
<ul><li>Your name, mobile number, email address and password (the account becomes "Deleted user" and cannot be used to sign in)</li><li>Saved delivery addresses</li><li>Wish list</li><li>In-app notifications</li><li>Notification tokens for your devices</li></ul>

<h2>What we keep, and why</h2>
<p>Order, payment, delivery and Smart Buy savings records are part of our business accounts. We keep them for as long as accounting and tax rules require. After deletion they are no longer connected to a login, and the app cannot show them to anyone. They are not used for marketing.</p>

<h2>Deleting only some data</h2>
<p>To remove only certain data (for example a saved address), do it in the app under Settings, or contact us using the details above.</p>
<p class="muted">See also our <a href="${esc(p.privacy_url)}">Privacy Policy</a>.</p>`)
}
