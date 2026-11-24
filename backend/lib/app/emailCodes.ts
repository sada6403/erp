// 6-digit email codes (verify email / reset password) over the company SMTP.
import { randomInt, randomUUID } from 'crypto'
import type { AppCompany } from './context'
import { sendEmailNow } from './emailService'
import { sha256 } from './security'
import { fail } from './http'

export const CODE_TTL_SECONDS = 15 * 60
export const CODE_MAX_ATTEMPTS = 5

const hashCode = (userId: string, code: string, purpose: string) => sha256(`${purpose}:${userId}:${code}`)

export async function issueEmailCode(
  company: AppCompany, userId: string, email: string, purpose: 'verify' | 'reset', _appName: string
): Promise<{ sent: boolean; smtpConfigured: boolean }> {
  const code = String(randomInt(0, 1000000)).padStart(6, '0')
  const rowId = randomUUID()
  await company.tp.query(`UPDATE app_email_verifications SET used_at = NOW() WHERE user_id = ? AND purpose = ? AND used_at IS NULL`, [userId, purpose])
  await company.tp.query(
    `INSERT INTO app_email_verifications (id, user_id, email, purpose, code_hash, expires_at)
     VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))`,
    [rowId, userId, email, purpose, hashCode(userId, code, purpose), CODE_TTL_SECONDS])
  // Branded en/ta/si email through the queue: allow-list in non-production, status log, no address stored.
  const r = await sendEmailNow(company.dbSchema, company.tp, { userId, type: purpose === 'verify' ? 'verify_email' : 'password_reset', entityId: rowId, data: { code } })
  // 'suppressed' (non-production, address not allow-listed) is reported as sent so app flows behave the same everywhere.
  const sent = r.status === 'sent' || r.status === 'suppressed'
  if (!sent && process.env.NODE_ENV !== 'production') console.log(`[app-api dev] email code for user ${userId}: ${code} (${r.status})`)
  return { sent, smtpConfigured: r.smtpConfigured }
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
