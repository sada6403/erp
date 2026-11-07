// 6-digit email codes (verify email / reset password) over the company SMTP.
import { randomInt, randomUUID } from 'crypto'
import type { AppCompany } from './context'
import { sendCompanyEmail } from '../email'
import { sha256 } from './security'
import { fail } from './http'

export const CODE_TTL_SECONDS = 15 * 60
export const CODE_MAX_ATTEMPTS = 5

const hashCode = (userId: string, code: string, purpose: string) => sha256(`${purpose}:${userId}:${code}`)

export async function issueEmailCode(
  company: AppCompany, userId: string, email: string, purpose: 'verify' | 'reset', appName: string
): Promise<{ sent: boolean; smtpConfigured: boolean }> {
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  await company.tp.query(`UPDATE app_email_verifications SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, purpose])
  await company.tp.query(
    `INSERT INTO app_email_verifications (id, user_id, email, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [randomUUID(), userId, email, purpose, hashCode(userId, code, purpose), CODE_TTL_SECONDS])
  const subject = purpose === 'verify' ? `${appName}: verify your email` : `${appName}: password reset code`
  const text = `Your ${appName} code is ${code}. It is valid for 15 minutes. If you did not request it, ignore this email.`
  const r = await sendCompanyEmail(company.id, { to: email, subject, text, html: `<p>${text}</p>` })
  const smtpConfigured = r.ok || !/not configured/i.test(r.error ?? '')
  if (!r.ok && process.env.NODE_ENV !== 'production') console.log(`[app-api dev] email code for ${email}: ${code} (${r.error})`)
  return { sent: r.ok, smtpConfigured }
}

/** Verifies and consumes a code. Throws CODE_INVALID / CODE_EXPIRED. Returns the email it was sent to. */
export async function consumeEmailCode(company: AppCompany, userId: string, code: string, purpose: 'verify' | 'reset'): Promise<string> {
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM app_email_verifications WHERE user_id = ? AND purpose = ? AND used_at IS NULL ORDER BY created_at DESC LIMIT 1`,
    [userId, purpose])
  const r = rows[0]
  if (!r) fail(400, 'CODE_INVALID', 'Invalid or expired code')
  if (new Date(r.expires_at as string | Date).getTime() < Date.now()) fail(400, 'CODE_EXPIRED', 'This code has expired. Request a new one.')
  if (Number(r.attempts) >= CODE_MAX_ATTEMPTS) fail(400, 'CODE_EXPIRED', 'Too many attempts. Request a new code.')
  if (r.code_hash !== hashCode(userId, code, purpose)) {
    await company.tp.query(`UPDATE app_email_verifications SET attempts = attempts + 1 WHERE id = ?`, [r.id])
    fail(400, 'CODE_INVALID', 'Incorrect code')
  }
  await company.tp.query(`UPDATE app_email_verifications SET used_at = NOW() WHERE id = ?`, [r.id])
  return String(r.email)
}
