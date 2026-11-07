import { randomUUID } from 'crypto'
import { appRoute } from '@/lib/app/context'
import { only, reqStr } from '@/lib/app/http'
import { findUserByIdentifier } from '@/lib/app/security'
import { issueEmailCode } from '@/lib/app/emailCodes'
import type { ForgotResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Always answers the same way for unknown ids (no account enumeration).
export const POST = appRoute({ auth: 'none', limiter: 'auth' }, async ({ company, body }): Promise<ForgotResponse> => {
  const b = await body()
  only(b, ['identifier'])
  const identifier = reqStr(b.identifier, 'identifier', 1, 64)
  const row = await findUserByIdentifier(company, identifier)
  const generic: ForgotResponse = { method: 'pos_request', message: 'If this account exists, your branch has been notified and will send you a new temporary password on WhatsApp.' }
  if (!row || row.status === 'disabled') return generic
  if (row.email && row.email_verified_at) {
    await issueEmailCode(company, String(row.id), String(row.email), 'reset', company.name)
    return { method: 'email_code', message: 'We sent a 6-digit code to your verified email.' }
  }
  const pending = await company.tp.query(`SELECT id FROM app_password_reset_requests WHERE user_id = ? AND status = 'pending' LIMIT 1`, [row.id])
  if (!pending.rows[0]) {
    await company.tp.query(
      `INSERT INTO app_password_reset_requests (id, user_id, name, phone, status) VALUES (?, ?, ?, ?, 'pending')`,
      [randomUUID(), row.id, row.name, row.phone])
  }
  return generic
})
