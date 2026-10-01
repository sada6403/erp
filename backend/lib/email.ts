import nodemailer from 'nodemailer'
import { pool } from './db'
import { decryptSecret } from './secretCrypto'

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

    const port = Number(smtp.port ?? 587)
    const isSecure = port === 465 ? true : port === 587 ? false : (Boolean(smtp.secure) || smtp.encryption === 'SSL')

    const transport = nodemailer.createTransport({
      host: String(smtp.host),
      port,
      secure: isSecure,
      auth: { user: String(smtp.user || ''), pass: String(smtp.pass || '') },
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

// ─── Per-company SMTP (Issue 24b — Super Admin-configured, per tenant) ─────────
// Separate from getSmtpSettings() above, which is the PLATFORM's own outbound
// mail (trial-expiry notices etc., stored in system_settings). This reads a
// single company's SMTP config from companies.branding_json.smtp — storage
// only for now, not wired into the local POS app's own send path.

async function getCompanySmtpSettings(companyId: string): Promise<Record<string, unknown> | null> {
  const { rows } = await pool.query(`SELECT branding_json FROM companies WHERE id = ?`, [companyId])
  if (!rows.length) return null
  const raw = (rows[0] as Record<string, unknown>).branding_json
  if (!raw) return null
  try {
    const branding = JSON.parse(String(raw)) as Record<string, unknown>
    const smtp = branding.smtp as Record<string, unknown> | undefined
    if (!smtp?.host) return null
    return smtp
  } catch {
    return null
  }
}

const MASKED_SECRET = '********'

function resolvePassword(passInput?: unknown, storedPass?: unknown): string {
  const pStr = String(passInput || '')
  let raw = pStr
  if (!raw || raw === MASKED_SECRET) {
    raw = String(storedPass || '')
  }
  if (!raw) return ''
  const decrypted = decryptSecret(raw)
  return decrypted || raw
}

export async function sendCompanyEmail(
  companyId: string,
  opts: {
    to: string
    subject: string
    html: string
    text?: string
  },
  overrideSmtp?: Record<string, unknown>
): Promise<{ ok: boolean; error?: string }> {
  try {
    const storedSmtp = await getCompanySmtpSettings(companyId)
    const smtp = overrideSmtp ? { ...storedSmtp, ...overrideSmtp } : storedSmtp
    if (!smtp?.host) return { ok: false, error: 'SMTP is not configured for this company' }

    const port = Number(smtp.port ?? 587)
    // STRICT RULE:
    // Port 587 => secure MUST be false (STARTTLS)
    // Port 465 => secure MUST be true (implicit SSL)
    let isSecure = false
    if (port === 465) {
      isSecure = true
    } else if (port === 587) {
      isSecure = false
    } else {
      isSecure = Boolean(smtp.secure) || String(smtp.encryption) === 'SSL'
    }

    const pass = resolvePassword(smtp.pass, storedSmtp?.pass)

    const transport = nodemailer.createTransport({
      host: String(smtp.host),
      port,
      secure: isSecure,
      auth: smtp.user ? { user: String(smtp.user), pass } : undefined,
    })

    await transport.sendMail({
      from: `"${String(smtp.from_name || 'POS ERP')}" <${String(smtp.from_email || smtp.user || '')}>`,
      to:      opts.to,
      subject: opts.subject,
      html:    opts.html,
      text:    opts.text,
    })

    return { ok: true }
  } catch (err) {
    console.error('[email] company send failed:', err)
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

export async function sendCompanyOnboardingEmail(opts: {
  companyName: string
  adminEmail: string
  adminName: string
  adminPassword?: string
  companyKey: string
  apiKey: string
  downloadUrl?: string
  serverUrl?: string
}) {
  const branding = await getBrandingSettings()
  const appName  = branding.app_name || 'Enterprise POS ERP'
  const support  = branding.support_email || ''
  const downloadUrl = opts.downloadUrl || branding.download_url || (process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}/download` : 'http://72.61.115.222/download')
  const serverUrl = opts.serverUrl || branding.server_url || (process.env.PUBLIC_BASE_URL ? `${process.env.PUBLIC_BASE_URL}:4001` : 'http://72.61.115.222:4001')
  const passwordDisplay = opts.adminPassword
    ? `${opts.adminPassword} (⚠️ Must change after first login)`
    : '(Your chosen password)'

  return sendEmail({
    to: opts.adminEmail,
    subject: `Welcome to ${appName} — Setup Guide & Account Credentials for ${opts.companyName}`,
    html: `
      <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; max-width: 600px; margin: 0 auto; color: #1e293b; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
        <div style="background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%); padding: 28px; text-align: center;">
          <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.025em;">${appName}</h1>
          <p style="color: #94a3b8; margin: 6px 0 0; font-size: 14px;">Welcome & PC Onboarding Guide</p>
        </div>
        <div style="padding: 32px 28px;">
          <p style="margin-top: 0; font-size: 15px; line-height: 1.6;">Hi <strong>${opts.adminName || 'Admin'}</strong>,</p>
          <p style="font-size: 15px; line-height: 1.6; color: #334155;">
            Welcome to <strong>${appName}</strong>! Your company account <strong>${opts.companyName}</strong> has been successfully registered. Below are your login credentials and steps to set up your POS terminal on your PC.
          </p>

          <div style="background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px; padding: 20px; margin: 24px 0;">
            <h2 style="font-size: 14px; font-weight: 700; text-transform: uppercase; color: #475569; letter-spacing: 0.05em; margin: 0 0 16px;">🔑 Account & Setup Credentials</h2>
            <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
              <tr>
                <td style="padding: 6px 0; color: #64748b; width: 180px;">Admin Email:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">${opts.adminEmail}</td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Admin Password:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">
                  <code style="background: #fef3c7; color: #92400e; padding: 4px 10px; border: 1px solid #fde68a; border-radius: 4px; font-family: monospace; font-size: 14px; font-weight: bold;">${opts.adminPassword || '(Your chosen password)'}</code>
                  ${opts.adminPassword ? '<span style="color: #dc2626; font-size: 12px; margin-left: 8px; font-weight: 600;">(⚠️ Must change upon first login)</span>' : ''}
                </td>
              </tr>
              <tr>
                <td style="padding: 6px 0; color: #64748b;">Company Activation Key:</td>
                <td style="padding: 6px 0; font-weight: 600; color: #0f172a;">
                  <code style="background: #e2e8f0; padding: 3px 8px; border-radius: 4px; font-family: monospace; font-size: 13px; word-break: break-all;">${opts.companyKey}</code>
                </td>
              </tr>
            </table>
          </div>

          <div style="text-align: center; margin: 28px 0;">
            <a href="${downloadUrl}" style="background: #2563eb; color: #ffffff; padding: 14px 28px; border-radius: 8px; text-decoration: none; font-weight: 600; font-size: 15px; display: inline-block; box-shadow: 0 4px 6px -1px rgba(37, 99, 235, 0.2);">
              ⬇️ Download Windows Desktop App
            </a>
          </div>

          <div style="background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 10px; padding: 20px; margin: 24px 0;">
            <h3 style="font-size: 14px; font-weight: 700; color: #1e40af; margin: 0 0 12px;">💻 PC Installation & Setup Steps</h3>
            <ol style="margin: 0; padding-left: 20px; color: #1e3a8a; font-size: 14px; line-height: 1.7;">
              <li>Download the Windows installer using the button above (or visit <a href="${downloadUrl}" style="color: #2563eb;">${downloadUrl}</a>).</li>
              <li>Install and open the <strong>${appName}</strong> desktop application.</li>
              <li>On first launch, enter your <strong>Company Activation Key</strong> to activate the terminal.</li>
              <li>Log in using your <strong>Admin Email</strong> and <strong>Admin Password</strong>.</li>
              <li><strong style="color: #b91c1c;">Mandatory Security Step:</strong> Go to <strong>Settings → Security / Profile</strong> and change your temporary password immediately.</li>
              <li>Navigate to <strong>Settings → Cloud Sync</strong> to verify that synchronization is active.</li>
            </ol>
          </div>

          <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px 16px; margin: 20px 0; color: #92400e; font-size: 13px; line-height: 1.5;">
            ⚠️ <strong>Security Requirement:</strong> This Admin Password is a temporary credential. For security reasons, please change your password immediately after logging in for the first time.
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 28px 0;" />
          <p style="color: #64748b; font-size: 13px; margin: 0; line-height: 1.5;">
            Need help or have questions? Contact our support team at <a href="mailto:${support || 'support@example.com'}" style="color: #2563eb;">${support || 'support@example.com'}</a>.
          </p>
        </div>
      </div>
    `,
    text: `Welcome to ${appName}!\n\nHi ${opts.adminName || 'Admin'},\nYour company account ${opts.companyName} is ready.\n\nCREDENTIALS:\n- Admin Email: ${opts.adminEmail}\n- Admin Password: ${passwordDisplay}\n- Company Activation Key: ${opts.companyKey}\n\nDOWNLOAD APP:\n${downloadUrl}\n\nSTEPS:\n1. Download and run the POS app installer on your PC.\n2. In the activation screen, enter your Company Activation Key.\n3. Log in with Admin Email & Password.\n4. CRITICAL: Go to Settings -> Security and change your temporary Admin Password immediately.\n5. Go to Settings -> Cloud Sync to confirm connection.\n\n${appName}`,
  })
}

