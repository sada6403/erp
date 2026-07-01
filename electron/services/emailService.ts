import nodemailer from 'nodemailer'
import Store from 'electron-store'

const store = new Store<Record<string, unknown>>()

export interface EmailPayload {
  to: string | string[]
  subject: string
  html: string
  text?: string
  attachments?: { filename: string; content: Buffer | string; contentType?: string }[]
}

function getConfig() {
  return {
    enabled:   Boolean(store.get('email_enabled', false)),
    host:      String(store.get('smtp_host', '')),
    port:      Number(store.get('smtp_port', 587)),
    encryption:String(store.get('smtp_encryption', 'TLS')),
    user:      String(store.get('smtp_username', '')),
    pass:      String(store.get('smtp_password', '')),
    fromEmail: String(store.get('smtp_from_email', '')),
    fromName:  String(store.get('smtp_from_name', 'POS System')),
    replyTo:   String(store.get('smtp_reply_to', '')),
  }
}

function createTransport(cfg = getConfig()) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.encryption === 'SSL',
    requireTLS: cfg.encryption === 'TLS',
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
  })
}

export async function sendEmail(payload: EmailPayload): Promise<{ success: boolean; error?: string }> {
  const cfg = getConfig()
  if (!cfg.enabled) return { success: false, error: 'Email is not enabled in settings' }
  if (!cfg.host)    return { success: false, error: 'SMTP host not configured' }
  try {
    const transport = createTransport(cfg)
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail || cfg.user}>`,
      replyTo: cfg.replyTo || undefined,
      to: Array.isArray(payload.to) ? payload.to.join(', ') : payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      attachments: payload.attachments,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) }
  }
}

export async function testEmail(testTo: string): Promise<{ success: boolean; error?: string }> {
  const cfg = getConfig()
  if (!cfg.host) return { success: false, error: 'SMTP host not configured' }
  try {
    const transport = createTransport(cfg)
    await transport.verify()
    await transport.sendMail({
      from: `"${cfg.fromName}" <${cfg.fromEmail || cfg.user}>`,
      to: testTo,
      subject: 'POS System — Email Test',
      html: `<p>Email configuration is working correctly.</p><p><small>Sent from your POS system at ${new Date().toLocaleString()}</small></p>`,
    })
    return { success: true }
  } catch (err) {
    return { success: false, error: String((err as Error).message || err) }
  }
}

// ── Email Templates ────────────────────────────────────────────────────────────

export function invoiceEmailHtml(data: {
  companyName: string
  customerName: string
  invoiceNumber: string
  invoiceDate: string
  totalAmount: string
  currency: string
  items: { name: string; qty: number; price: string; total: string }[]
  footerNote?: string
}) {
  const rows = data.items.map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;">${i.qty}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${data.currency} ${i.price}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:right;">${data.currency} ${i.total}</td>
    </tr>`
  ).join('')

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#16a34a;padding:24px 32px;">
    <h1 style="margin:0;color:#fff;font-size:20px;font-weight:700;">${data.companyName}</h1>
    <p style="margin:4px 0 0;color:#bbf7d0;font-size:14px;">Invoice #${data.invoiceNumber}</p>
  </div>
  <div style="padding:24px 32px;">
    <p style="margin:0 0 16px;color:#374151;font-size:15px;">Dear <strong>${data.customerName}</strong>,</p>
    <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">Thank you for your purchase. Please find your invoice details below.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 12px;text-align:left;color:#374151;font-weight:600;border-bottom:2px solid #e5e7eb;">Item</th>
          <th style="padding:10px 12px;text-align:center;color:#374151;font-weight:600;border-bottom:2px solid #e5e7eb;">Qty</th>
          <th style="padding:10px 12px;text-align:right;color:#374151;font-weight:600;border-bottom:2px solid #e5e7eb;">Price</th>
          <th style="padding:10px 12px;text-align:right;color:#374151;font-weight:600;border-bottom:2px solid #e5e7eb;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="3" style="padding:12px;text-align:right;font-weight:700;color:#111827;">Total</td>
          <td style="padding:12px;text-align:right;font-weight:700;font-size:16px;color:#16a34a;">${data.currency} ${data.totalAmount}</td>
        </tr>
      </tfoot>
    </table>
    ${data.footerNote ? `<p style="margin:20px 0 0;color:#9ca3af;font-size:12px;">${data.footerNote}</p>` : ''}
  </div>
  <div style="background:#f9fafb;padding:16px 32px;text-align:center;color:#9ca3af;font-size:12px;">
    ${data.invoiceDate} · Powered by POS ERP
  </div>
</div>
</body>
</html>`
}

export function installmentReminderHtml(data: {
  companyName: string
  customerName: string
  dueDate: string
  dueAmount: string
  currency: string
  overdue?: boolean
}) {
  const color = data.overdue ? '#dc2626' : '#d97706'
  const title = data.overdue ? 'Payment Overdue Notice' : 'Payment Reminder'
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:520px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:${color};padding:20px 28px;">
    <h1 style="margin:0;color:#fff;font-size:18px;font-weight:700;">${data.companyName}</h1>
    <p style="margin:4px 0 0;color:#fff;opacity:0.85;font-size:13px;">${title}</p>
  </div>
  <div style="padding:24px 28px;">
    <p style="margin:0 0 12px;color:#374151;">Dear <strong>${data.customerName}</strong>,</p>
    <p style="margin:0 0 20px;color:#6b7280;font-size:14px;">
      ${data.overdue
        ? `Your installment payment of <strong>${data.currency} ${data.dueAmount}</strong> was due on <strong>${data.dueDate}</strong> and is now overdue. Please make payment immediately to avoid penalties.`
        : `This is a reminder that your installment payment of <strong>${data.currency} ${data.dueAmount}</strong> is due on <strong>${data.dueDate}</strong>.`}
    </p>
    <div style="background:${data.overdue ? '#fef2f2' : '#fffbeb'};border:1px solid ${data.overdue ? '#fecaca' : '#fde68a'};border-radius:8px;padding:16px;">
      <p style="margin:0;font-size:15px;font-weight:700;color:${color};">Amount Due: ${data.currency} ${data.dueAmount}</p>
      <p style="margin:4px 0 0;font-size:12px;color:#6b7280;">Due Date: ${data.dueDate}</p>
    </div>
  </div>
  <div style="background:#f9fafb;padding:12px 28px;text-align:center;color:#9ca3af;font-size:11px;">Powered by POS ERP</div>
</div>
</body>
</html>`
}

export function lowStockAlertHtml(data: {
  companyName: string
  items: { name: string; sku: string; current: number; min: number }[]
}) {
  const rows = data.items.map(i =>
    `<tr>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;">${i.name}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;font-family:monospace;">${i.sku}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#dc2626;font-weight:700;">${i.current}</td>
      <td style="padding:8px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#6b7280;">${i.min}</td>
    </tr>`
  ).join('')
  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
  <div style="background:#f59e0b;padding:20px 28px;">
    <h1 style="margin:0;color:#fff;font-size:18px;">⚠ Low Stock Alert</h1>
    <p style="margin:4px 0 0;color:#fff;opacity:0.9;font-size:13px;">${data.companyName}</p>
  </div>
  <div style="padding:24px 28px;">
    <p style="color:#6b7280;font-size:14px;margin:0 0 16px;">${data.items.length} item${data.items.length > 1 ? 's' : ''} need restocking.</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;">
      <thead>
        <tr style="background:#f9fafb;">
          <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#374151;">Product</th>
          <th style="padding:10px 12px;text-align:left;border-bottom:2px solid #e5e7eb;color:#374151;">SKU</th>
          <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e5e7eb;color:#374151;">Current</th>
          <th style="padding:10px 12px;text-align:center;border-bottom:2px solid #e5e7eb;color:#374151;">Min Level</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  </div>
</div>
</body>
</html>`
}
