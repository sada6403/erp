import { appRoute, need } from '@/lib/app/context'
import { EMAIL_RE, fail, only, reqStr } from '@/lib/app/http'
import { CODE_TTL_SECONDS, issueEmailCode } from '@/lib/app/emailCodes'
import type { EmailStartResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', limiter: 'auth' }, async (c): Promise<EmailStartResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['email'])
  const email = reqStr(b.email, 'email', 5, 255).toLowerCase()
  if (!EMAIL_RE.test(email)) fail(400, 'VALIDATION', 'Enter a valid email')
  const taken = await company.tp.query(`SELECT id FROM app_users WHERE email = ? AND email_verified_at IS NOT NULL AND id <> ? LIMIT 1`, [email, user.userId])
  if (taken.rows[0]) fail(409, 'CONFLICT', 'This email is already used by another account')
  await company.tp.query(`UPDATE app_users SET email = ?, email_verified_at = NULL WHERE id = ?`, [email, user.userId])
  const r = await issueEmailCode(company, user.userId, email, 'verify', company.name)
  return { sent: r.sent, smtp_configured: r.smtpConfigured, expires_in: CODE_TTL_SECONDS }
})
