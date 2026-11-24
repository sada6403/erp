// Transactional email templates (en / ta / si). Pure: no imports, no I/O. Brand colour = app olive primary.
// Company name / logo / address / contact are passed in (from the POS company profile), never hard-coded.

export type EmailLang = 'en' | 'ta' | 'si'
export type EmailType =
  | 'welcome' | 'verify_email' | 'password_reset'
  | 'order_placed' | 'order_confirmed' | 'order_dispatched' | 'order_delivered' | 'order_cancelled'
  | 'slip_verified' | 'slip_rejected'
  | 'join_received' | 'join_approved' | 'join_rejected'
  | 'cash_receipt'

export const EMAIL_TYPES: EmailType[] = [
  'welcome', 'verify_email', 'password_reset', 'order_placed', 'order_confirmed', 'order_dispatched', 'order_delivered',
  'order_cancelled', 'slip_verified', 'slip_rejected', 'join_received', 'join_approved', 'join_rejected', 'cash_receipt',
]

export interface EmailCompany { name: string; logo_url?: string | null; address?: string | null; phone?: string | null; email?: string | null; website?: string | null }
export interface EmailItem { name: string; qty: number; total: number }
export interface EmailData {
  name?: string; order?: string; reason?: string; code?: string; amount?: number; receipt?: string; scheme?: string
  items?: EmailItem[]; delivery_fee?: number; total?: number
}
export interface RenderedEmail { subject: string; html: string; text: string }

export const BRAND_COLOR = '#5A6B2E'

type Copy = { subject: string; heading: string; body: string }
type Labels = { hello: string; items: string; qty: string; total: string; delivery: string; code: string; steps: string; contact: string; auto: string }

const STEPS: Record<EmailLang, string[]> = {
  en: ['Open the app and sign in with your mobile number.', 'Tap Smart Buy on the home screen.', 'See your scheme, payments and draws.'],
  ta: ['செயலியைத் திறந்து உங்கள் கைப்பேசி எண்ணுடன் உள்நுழையவும்.', 'முகப்புத் திரையில் Smart Buy ஐத் தட்டவும்.', 'உங்கள் திட்டம், கட்டணங்கள் மற்றும் குலுக்கல்களைப் பார்க்கவும்.'],
  si: ['යෙදුම විවෘත කර ඔබගේ ජංගම අංකයෙන් පුරනය වන්න.', 'මුල් තිරයේ Smart Buy ඔබන්න.', 'ඔබගේ යෝජනා ක්‍රමය, ගෙවීම් සහ දිනුම් ඇදීම් බලන්න.'],
}

const LABELS: Record<EmailLang, Labels> = {
  en: { hello: 'Hello {{name}},', items: 'Your items', qty: 'Qty', total: 'Total', delivery: 'Delivery', code: 'Your code', steps: 'How to get started', contact: 'Contact us', auto: 'This is an automated message. Please do not reply.' },
  ta: { hello: 'வணக்கம் {{name}},', items: 'உங்கள் பொருட்கள்', qty: 'எண்ணிக்கை', total: 'மொத்தம்', delivery: 'டெலிவரி', code: 'உங்கள் குறியீடு', steps: 'தொடங்குவது எப்படி', contact: 'எங்களைத் தொடர்பு கொள்ள', auto: 'இது தானியங்கி செய்தி. பதிலளிக்க வேண்டாம்.' },
  si: { hello: 'ආයුබෝවන් {{name}},', items: 'ඔබගේ භාණ්ඩ', qty: 'ප්‍රමාණය', total: 'මුළු මුදල', delivery: 'බෙදාහැරීම', code: 'ඔබගේ කේතය', steps: 'ආරම්භ කරන ආකාරය', contact: 'අප අමතන්න', auto: 'මෙය ස්වයංක්‍රීය පණිවිඩයකි. කරුණාකර පිළිතුරු නොදෙන්න.' },
}

const COPY: Record<EmailLang, Record<EmailType, Copy>> = {
  en: {
    welcome: { subject: 'Welcome to {{company}}', heading: 'Your account is ready', body: 'Thank you for joining {{company}}, {{name}}. You can now browse the shop, place orders and track them in the app.' },
    verify_email: { subject: '{{company}} verification code', heading: 'Verify your email', body: 'Use this code to verify your email address. It is valid for 15 minutes. If you did not ask for it, ignore this email.' },
    password_reset: { subject: '{{company}} password reset code', heading: 'Reset your password', body: 'Use this code to reset your password. It is valid for 15 minutes. If you did not ask for it, ignore this email.' },
    order_placed: { subject: 'We received your order {{order}}', heading: 'Order received', body: 'Thank you! Your order {{order}} has been received. We will confirm it shortly.' },
    order_confirmed: { subject: 'Order {{order}} confirmed', heading: 'Order confirmed', body: 'Your order {{order}} has been confirmed. We will let you know when it is on its way.' },
    order_dispatched: { subject: 'Order {{order}} is on its way', heading: 'Out for delivery', body: 'Your order {{order}} is on its way to you.' },
    order_delivered: { subject: 'Order {{order}} delivered', heading: 'Delivered', body: 'Your order {{order}} was delivered. Thank you for shopping with us!' },
    order_cancelled: { subject: 'Order {{order}} cancelled', heading: 'Order cancelled', body: 'Your order {{order}} was cancelled. If you have questions, please contact us.' },
    slip_verified: { subject: 'Payment received for order {{order}}', heading: 'Payment confirmed', body: 'We received your payment for order {{order}}. Thank you!' },
    slip_rejected: { subject: 'Payment slip not accepted for order {{order}}', heading: 'Payment slip not accepted', body: 'Your payment slip for order {{order}} was not accepted. Reason: {{reason}}. Please upload a new slip in the app.' },
    join_received: { subject: 'Smart Buy request received', heading: 'Smart Buy request received', body: 'We received your Smart Buy join request for {{scheme}}. Our team will review it and let you know.' },
    join_approved: { subject: 'Smart Buy request approved', heading: 'You are a Smart Buy member', body: 'Your Smart Buy join request for {{scheme}} was approved. To get started:' },
    join_rejected: { subject: 'Smart Buy request not approved', heading: 'Smart Buy request not approved', body: 'Your Smart Buy join request for {{scheme}} was not approved. Reason: {{reason}}.' },
    cash_receipt: { subject: 'Payment receipt {{receipt}}', heading: 'Payment receipt', body: 'Your agent received {{amount}} for {{scheme}}. Receipt {{receipt}}. It shows as pending until the branch verifies it.' },
  },
  ta: {
    welcome: { subject: '{{company}} இல் வரவேற்கிறோம்', heading: 'உங்கள் கணக்கு தயார்', body: '{{company}} இல் இணைந்ததற்கு நன்றி, {{name}}. இப்போது நீங்கள் செயலியில் பொருட்களைப் பார்த்து ஆர்டர் செய்து, அவற்றைக் கண்காணிக்கலாம்.' },
    verify_email: { subject: '{{company}} சரிபார்ப்புக் குறியீடு', heading: 'உங்கள் மின்னஞ்சலைச் சரிபார்க்கவும்', body: 'உங்கள் மின்னஞ்சல் முகவரியைச் சரிபார்க்க இந்தக் குறியீட்டைப் பயன்படுத்தவும். இது 15 நிமிடங்கள் செல்லுபடியாகும். நீங்கள் கேட்கவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.' },
    password_reset: { subject: '{{company}} கடவுச்சொல் மீட்பு குறியீடு', heading: 'கடவுச்சொல்லை மீட்டமைக்கவும்', body: 'உங்கள் கடவுச்சொல்லை மீட்டமைக்க இந்தக் குறியீட்டைப் பயன்படுத்தவும். இது 15 நிமிடங்கள் செல்லுபடியாகும். நீங்கள் கேட்கவில்லை என்றால் இந்த மின்னஞ்சலைப் புறக்கணிக்கவும்.' },
    order_placed: { subject: 'ஆர்டர் {{order}} பெறப்பட்டது', heading: 'ஆர்டர் பெறப்பட்டது', body: 'நன்றி! உங்கள் ஆர்டர் {{order}} பெறப்பட்டது. விரைவில் உறுதிப்படுத்துவோம்.' },
    order_confirmed: { subject: 'ஆர்டர் {{order}} உறுதிசெய்யப்பட்டது', heading: 'ஆர்டர் உறுதிசெய்யப்பட்டது', body: 'உங்கள் ஆர்டர் {{order}} உறுதிசெய்யப்பட்டது. அனுப்பியதும் தெரிவிப்போம்.' },
    order_dispatched: { subject: 'ஆர்டர் {{order}} அனுப்பப்பட்டது', heading: 'டெலிவரிக்குப் புறப்பட்டது', body: 'உங்கள் ஆர்டர் {{order}} டெலிவரிக்காக அனுப்பப்பட்டது.' },
    order_delivered: { subject: 'ஆர்டர் {{order}} டெலிவரி செய்யப்பட்டது', heading: 'டெலிவரி முடிந்தது', body: 'உங்கள் ஆர்டர் {{order}} டெலிவரி செய்யப்பட்டது. எங்களுடன் வாங்கியதற்கு நன்றி!' },
    order_cancelled: { subject: 'ஆர்டர் {{order}} ரத்து செய்யப்பட்டது', heading: 'ஆர்டர் ரத்து', body: 'உங்கள் ஆர்டர் {{order}} ரத்து செய்யப்பட்டது. கேள்விகள் இருந்தால் எங்களைத் தொடர்பு கொள்ளவும்.' },
    slip_verified: { subject: 'ஆர்டர் {{order}} க்கான கட்டணம் பெறப்பட்டது', heading: 'கட்டணம் உறுதிசெய்யப்பட்டது', body: 'ஆர்டர் {{order}} க்கான உங்கள் கட்டணத்தைப் பெற்றோம். நன்றி!' },
    slip_rejected: { subject: 'ஆர்டர் {{order}} கட்டணச் சீட்டு ஏற்கப்படவில்லை', heading: 'கட்டணச் சீட்டு ஏற்கப்படவில்லை', body: 'ஆர்டர் {{order}} க்கான உங்கள் கட்டணச் சீட்டு ஏற்கப்படவில்லை. காரணம்: {{reason}}. செயலியில் புதிய சீட்டைப் பதிவேற்றவும்.' },
    join_received: { subject: 'Smart Buy கோரிக்கை பெறப்பட்டது', heading: 'Smart Buy கோரிக்கை பெறப்பட்டது', body: '{{scheme}} திட்டத்தில் இணைவதற்கான உங்கள் Smart Buy கோரிக்கையைப் பெற்றோம். எங்கள் குழு பரிசீலித்து உங்களுக்குத் தெரிவிக்கும்.' },
    join_approved: { subject: 'Smart Buy கோரிக்கை ஏற்கப்பட்டது', heading: 'நீங்கள் Smart Buy உறுப்பினர்', body: '{{scheme}} திட்டத்திற்கான உங்கள் Smart Buy கோரிக்கை ஏற்கப்பட்டது. தொடங்க:' },
    join_rejected: { subject: 'Smart Buy கோரிக்கை ஏற்கப்படவில்லை', heading: 'Smart Buy கோரிக்கை ஏற்கப்படவில்லை', body: '{{scheme}} திட்டத்திற்கான உங்கள் Smart Buy கோரிக்கை ஏற்கப்படவில்லை. காரணம்: {{reason}}.' },
    cash_receipt: { subject: 'கட்டண ரசீது {{receipt}}', heading: 'கட்டண ரசீது', body: 'உங்கள் முகவர் {{scheme}} திட்டத்திற்காக {{amount}} பெற்றார். ரசீது {{receipt}}. கிளை சரிபார்க்கும் வரை இது நிலுவையில் காட்டப்படும்.' },
  },
  si: {
    welcome: { subject: '{{company}} වෙත සාදරයෙන් පිළිගනිමු', heading: 'ඔබගේ ගිණුම සූදානම්', body: '{{company}} හා එක්වීම ගැන ස්තූතියි, {{name}}. දැන් ඔබට යෙදුමෙන් භාණ්ඩ බලා, ඇණවුම් කර, ඒවා ලුහුබඳින්න පුළුවන්.' },
    verify_email: { subject: '{{company}} තහවුරු කිරීමේ කේතය', heading: 'ඔබගේ ඊමේල් තහවුරු කරන්න', body: 'ඔබගේ ඊමේල් ලිපිනය තහවුරු කිරීමට මෙම කේතය භාවිත කරන්න. එය මිනිත්තු 15ක් වලංගුයි. ඔබ ඉල්ලුවේ නැතිනම් මෙම ඊමේල් එක නොසලකන්න.' },
    password_reset: { subject: '{{company}} මුරපදය යළි සැකසීමේ කේතය', heading: 'මුරපදය යළි සකසන්න', body: 'ඔබගේ මුරපදය යළි සැකසීමට මෙම කේතය භාවිත කරන්න. එය මිනිත්තු 15ක් වලංගුයි. ඔබ ඉල්ලුවේ නැතිනම් මෙම ඊමේල් එක නොසලකන්න.' },
    order_placed: { subject: 'ඇණවුම {{order}} ලැබුණා', heading: 'ඇණවුම ලැබුණා', body: 'ස්තූතියි! ඔබගේ ඇණවුම {{order}} අපට ලැබුණා. ඉක්මනින් තහවුරු කරන්නෙමු.' },
    order_confirmed: { subject: 'ඇණවුම {{order}} තහවුරු කළා', heading: 'ඇණවුම තහවුරු කළා', body: 'ඔබගේ ඇණවුම {{order}} තහවුරු කරන ලදී. යැවූ විට දන්වන්නෙමු.' },
    order_dispatched: { subject: 'ඇණවුම {{order}} යවා ඇත', heading: 'බෙදාහැරීමට පිටත් වී ඇත', body: 'ඔබගේ ඇණවුම {{order}} බෙදාහැරීමට යවා ඇත.' },
    order_delivered: { subject: 'ඇණවුම {{order}} බෙදා හැරියා', heading: 'බෙදාහැරීම අවසන්', body: 'ඔබගේ ඇණවුම {{order}} බෙදා හරින ලදී. අප සමඟ සාප්පු සවාරි කිරීම ගැන ස්තූතියි!' },
    order_cancelled: { subject: 'ඇණවුම {{order}} අවලංගු කළා', heading: 'ඇණවුම අවලංගුයි', body: 'ඔබගේ ඇණවුම {{order}} අවලංගු කරන ලදී. ප්‍රශ්න ඇත්නම් අපව සම්බන්ධ කරගන්න.' },
    slip_verified: { subject: 'ඇණවුම {{order}} සඳහා ගෙවීම ලැබුණා', heading: 'ගෙවීම තහවුරුයි', body: 'ඇණවුම {{order}} සඳහා ඔබගේ ගෙවීම අපට ලැබුණා. ස්තූතියි!' },
    slip_rejected: { subject: 'ඇණවුම {{order}} ගෙවීම් රිසිට්පත පිළිගත්තේ නැත', heading: 'ගෙවීම් රිසිට්පත පිළිගත්තේ නැත', body: 'ඇණවුම {{order}} සඳහා ඔබගේ රිසිට්පත පිළිගත්තේ නැත. හේතුව: {{reason}}. කරුණාකර යෙදුමෙන් නව රිසිට්පතක් උඩුගත කරන්න.' },
    join_received: { subject: 'Smart Buy ඉල්ලීම ලැබුණා', heading: 'Smart Buy ඉල්ලීම ලැබුණා', body: '{{scheme}} යෝජනා ක්‍රමයට එක්වීමට ඔබගේ Smart Buy ඉල්ලීම අපට ලැබුණා. අපගේ කණ්ඩායම එය පරීක්ෂා කර ඔබට දන්වනු ඇත.' },
    join_approved: { subject: 'Smart Buy ඉල්ලීම අනුමත විය', heading: 'ඔබ දැන් Smart Buy සාමාජිකයෙක්', body: '{{scheme}} යෝජනා ක්‍රමය සඳහා ඔබගේ Smart Buy ඉල්ලීම අනුමත විය. ආරම්භ කිරීමට:' },
    join_rejected: { subject: 'Smart Buy ඉල්ලීම අනුමත නොවීය', heading: 'Smart Buy ඉල්ලීම අනුමත නොවීය', body: '{{scheme}} යෝජනා ක්‍රමය සඳහා ඔබගේ Smart Buy ඉල්ලීම අනුමත නොවීය. හේතුව: {{reason}}.' },
    cash_receipt: { subject: 'ගෙවීම් රිසිට්පත {{receipt}}', heading: 'ගෙවීම් රිසිට්පත', body: 'ඔබගේ නියෝජිතයා {{scheme}} සඳහා {{amount}} ලබා ගත්තා. රිසිට්පත {{receipt}}. ශාඛාව තහවුරු කරන තෙක් මෙය පොරොත්තුවේ පෙන්වයි.' },
  },
}

const esc = (s: unknown) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const fill = (tpl: string, vars: Record<string, string>, escape: boolean) =>
  tpl.replace(/\{\{(\w+)\}\}/g, (_m, k: string) => (escape ? esc(vars[k] ?? '') : (vars[k] ?? '')))

export function formatMoney(n: number): string {
  const v = Number.isFinite(n) ? n : 0
  return 'Rs ' + v.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

export function normalizeLang(l: unknown): EmailLang {
  return l === 'ta' || l === 'si' ? l : 'en'
}

/** Only http(s) logo URLs are embedded; anything else is ignored. */
const safeUrl = (u?: string | null) => (u && /^https?:\/\//i.test(u.trim()) ? u.trim() : '')

export function renderEmail(type: EmailType, langIn: unknown, company: EmailCompany, data: EmailData): RenderedEmail {
  const lang = normalizeLang(langIn)
  const copy = COPY[lang][type]
  const lab = LABELS[lang]
  const companyName = company.name || 'Natural Plantation'
  const vars: Record<string, string> = {
    company: companyName,
    name: data.name?.trim() || (lang === 'en' ? 'there' : companyName),
    order: data.order ?? '', reason: data.reason ?? '', code: data.code ?? '', receipt: data.receipt ?? '', scheme: data.scheme ?? '',
    amount: data.amount != null ? formatMoney(data.amount) : '',
  }
  const hello = fill(lab.hello, vars, false)
  const subject = fill(copy.subject, vars, false)
  const heading = fill(copy.heading, vars, false)
  const bodyText = fill(copy.body, vars, false)
  const bodyHtml = fill(copy.body, vars, true)
  const isCode = type === 'verify_email' || type === 'password_reset'
  const showItems = type === 'order_placed' && (data.items?.length ?? 0) > 0

  const textParts: string[] = [hello, '', bodyText]
  let htmlMid = ''
  if (isCode && data.code) {
    textParts.push('', `${lab.code}: ${data.code}`)
    htmlMid += `<div style="margin:20px 0;text-align:center"><div style="font-size:12px;color:#6b7280;margin-bottom:6px">${esc(lab.code)}</div><div style="display:inline-block;background:#f3f5ea;border:1px solid ${BRAND_COLOR};border-radius:10px;padding:12px 24px;font-size:30px;font-weight:700;letter-spacing:6px;color:${BRAND_COLOR};font-family:Consolas,Menlo,monospace">${esc(data.code)}</div></div>`
  }
  if (showItems) {
    textParts.push('', `${lab.items}:`)
    let rows = ''
    for (const it of data.items!) {
      textParts.push(`- ${it.name} x ${it.qty}  ${formatMoney(it.total)}`)
      rows += `<tr><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px">${esc(it.name)}<div style="font-size:12px;color:#6b7280">${esc(lab.qty)}: ${esc(it.qty)}</div></td><td style="padding:8px 0;border-bottom:1px solid #e5e7eb;font-size:14px;text-align:right;white-space:nowrap">${esc(formatMoney(it.total))}</td></tr>`
    }
    if (data.delivery_fee) {
      textParts.push(`${lab.delivery}: ${formatMoney(data.delivery_fee)}`)
      rows += `<tr><td style="padding:8px 0;font-size:14px;color:#6b7280">${esc(lab.delivery)}</td><td style="padding:8px 0;font-size:14px;text-align:right;white-space:nowrap">${esc(formatMoney(data.delivery_fee))}</td></tr>`
    }
    if (data.total != null) {
      textParts.push(`${lab.total}: ${formatMoney(data.total)}`)
      rows += `<tr><td style="padding:10px 0;font-size:15px;font-weight:700">${esc(lab.total)}</td><td style="padding:10px 0;font-size:15px;font-weight:700;text-align:right;white-space:nowrap;color:${BRAND_COLOR}">${esc(formatMoney(data.total))}</td></tr>`
    }
    htmlMid += `<div style="margin:18px 0 4px;font-size:13px;font-weight:700;color:${BRAND_COLOR};text-transform:uppercase;letter-spacing:.04em">${esc(lab.items)}</div><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse">${rows}</table>`
  }
  if (type === 'join_approved') {
    textParts.push('')
    STEPS[lang].forEach((s, i) => textParts.push(`${i + 1}. ${s}`))
    htmlMid += `<ol style="margin:12px 0 0;padding-left:22px;font-size:14px;line-height:1.7;color:#374151">${STEPS[lang].map(s => `<li>${esc(s)}</li>`).join('')}</ol>`
  }

  const contact = [company.phone, company.email, company.website].filter(Boolean) as string[]
  const addr = company.address?.trim()
  const footerLines = [companyName, addr, contact.join('  |  ')].filter(Boolean) as string[]
  textParts.push('', '--', ...footerLines, lab.auto)

  const logo = safeUrl(company.logo_url)
  const header = logo
    ? `<img src="${esc(logo)}" alt="${esc(companyName)}" height="44" style="display:block;margin:0 auto 8px;max-height:44px;max-width:180px;border:0"><div style="font-size:16px;font-weight:700;color:#ffffff">${esc(companyName)}</div>`
    : `<div style="font-size:20px;font-weight:700;color:#ffffff">${esc(companyName)}</div>`
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#f4f5f0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Noto Sans Tamil','Noto Sans Sinhala',Helvetica,Arial,sans-serif;color:#1f2937">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f5f0"><tr><td align="center" style="padding:16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
<tr><td align="center" style="background:${BRAND_COLOR};padding:22px 16px">${header}</td></tr>
<tr><td style="padding:26px 22px 8px">
<h1 style="margin:0 0 14px;font-size:21px;line-height:1.3;color:${BRAND_COLOR}">${esc(heading)}</h1>
<p style="margin:0 0 10px;font-size:15px;line-height:1.6">${esc(hello)}</p>
<p style="margin:0;font-size:15px;line-height:1.6">${bodyHtml}</p>
${htmlMid}
</td></tr>
<tr><td style="padding:18px 22px 24px"><div style="border-top:1px solid #e5e7eb;padding-top:14px;font-size:12px;line-height:1.6;color:#6b7280">
<strong style="color:#374151">${esc(companyName)}</strong>${addr ? `<br>${esc(addr)}` : ''}${contact.length ? `<br>${esc(lab.contact)}: ${esc(contact.join('  |  '))}` : ''}<br><span style="color:#9ca3af">${esc(lab.auto)}</span>
</div></td></tr></table></td></tr></table></body></html>`
  return { subject, html, text: textParts.join('\n') }
}
