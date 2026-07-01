import nodemailer from 'nodemailer'
import { pool } from './db'

async function getSmtpSettings() {
  const { rows } = await pool.query(`SELECT value FROM system_settings WHERE \`key\` = 'smtp' LIMIT 1`)
  if (!rows.length) return null
  const r = rows[0] as Record<string, string>
  return typeof r.value === 'string' ? JSON.parse(r.value) as Record<string, string> : r.value as Record<string, string>
}

async function getBrandingSettings() {
  const { rows } = await pool.query(`SELECT value FROM system_settings WHERE \`key\` = 'branding' LIMIT 1`)
  if (!rows.length) return { app_name: 'POS ERP', support_email: '' }
  const r = rows[0] as Record<string, string>
  return typeof r.value === 'string' ? JSON.parse(r.value) as Record<string, string> : r.value as Record<string, string>
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  text?: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    const smtp = await getSmtpSettings()
    if (!smtp?.host) return { ok: false, error: 'SMTP not configured' }

    const transport = nodemailer.createTransport({
      host: smtp.host,
      port: Number(smtp.port ?? 587),
      secure: Number(smtp.port) === 465,
      auth: { user: smtp.user, pass: smtp.pass },
    })

    const branding = await getBrandingSettings()

    await transport.sendMail({
      from: `"${smtp.from_name || branding.app_name || 'POS ERP'}" <${smtp.from_email || smtp.user}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    })

    return { ok: true }
  } catch (err) {
    console.error('[email] send failed:', err)
    return { ok: false, error: err instanceof Error ? err.message : 'Unknown error' }
  }
}

// ─── Email Templates ──────────────────────────────────────────────────────────

export async function sendTrialExpiryWarning(opts: {
  companyName: string
  adminEmail: string
  adminName: string
  daysLeft: number
  endsAt: string
}) {
  const branding = await getBrandingSettings()
  const appName  = branding.app_name || 'POS ERP'
  const support  = branding.support_email || ''

  return sendEmail({
    to: opts.adminEmail,
    subject: `Your ${appName} trial expires in ${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
        <div style="background:#1e293b;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">${appName}</h1>
        </div>
        <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
          <p style="margin-top:0">Hi ${opts.adminName},</p>
          <p>Your <strong>${opts.companyName}</strong> trial on <strong>${appName}</strong> expires in
            <strong style="color:#dc2626">${opts.daysLeft} day${opts.daysLeft === 1 ? '' : 's'}</strong>
            (${new Date(opts.endsAt).toLocaleDateString()}).
          </p>
          <p>To continue using all features without interruption, please upgrade your plan before the trial ends.</p>
          <div style="margin:24px 0">
            <a href="#" style="background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">
              Upgrade Now
            </a>
          </div>
          <p style="color:#6b7280;font-size:14px">
            If you have any questions, contact us at
            <a href="mailto:${support}" style="color:#2563eb">${support || 'our support team'}</a>.
          </p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
          <p style="color:#9ca3af;font-size:12px;margin:0">${appName} — Automated notification. Do not reply to this email.</p>
        </div>
      </div>
    `,
    text: `Hi ${opts.adminName},\n\nYour ${opts.companyName} trial on ${appName} expires in ${opts.daysLeft} day(s) on ${new Date(opts.endsAt).toLocaleDateString()}.\n\nPlease upgrade your plan to continue.\n\n${appName}`,
  })
}

export async function sendWelcomeEmail(opts: {
  companyName: string
  adminEmail: string
  adminName: string
  tempPassword: string
  loginUrl?: string
}) {
  const branding = await getBrandingSettings()
  const appName  = branding.app_name || 'POS ERP'
  const support  = branding.support_email || ''

  return sendEmail({
    to: opts.adminEmail,
    subject: `Welcome to ${appName} — Your account is ready`,
    html: `
      <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1f2937">
        <div style="background:#1e293b;padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:#fff;margin:0;font-size:20px">${appName}</h1>
        </div>
        <div style="background:#f9fafb;padding:32px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
          <p style="margin-top:0">Hi ${opts.adminName},</p>
          <p>Welcome to <strong>${appName}</strong>! Your company account <strong>${opts.companyName}</strong> has been created.</p>
          <p>Here are your login credentials:</p>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin:16px 0">
            <p style="margin:4px 0"><strong>Email:</strong> ${opts.adminEmail}</p>
            <p style="margin:4px 0"><strong>Password:</strong> <code style="background:#f3f4f6;padding:2px 6px;border-radius:4px">${opts.tempPassword}</code></p>
            ${opts.loginUrl ? `<p style="margin:4px 0"><strong>Login URL:</strong> <a href="${opts.loginUrl}">${opts.loginUrl}</a></p>` : ''}
          </div>
          <p style="color:#dc2626;font-size:14px">⚠️ Please change your password after first login.</p>
          <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0" />
          <p style="color:#9ca3af;font-size:12px;margin:0">
            ${support ? `Need help? Contact <a href="mailto:${support}" style="color:#2563eb">${support}</a>` : ''}
          </p>
        </div>
      </div>
    `,
    text: `Hi ${opts.adminName},\n\nWelcome to ${appName}!\n\nEmail: ${opts.adminEmail}\nPassword: ${opts.tempPassword}\n${opts.loginUrl ? `Login: ${opts.loginUrl}` : ''}\n\nPlease change your password after first login.`,
  })
}
