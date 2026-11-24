import { appRoute, need } from '@/lib/app/context'
import { only, reqStr } from '@/lib/app/http'
import { consumeEmailCode } from '@/lib/app/emailCodes'
import type { EmailVerifyResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', limiter: 'auth' }, async (c): Promise<EmailVerifyResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['code'])
  const code = reqStr(b.code, 'code', 6, 6)
  const email = await consumeEmailCode(company, user.userId, code, 'verify')
  await company.tp.query(`UPDATE app_users SET email = ?, email_verified_at = NOW() WHERE id = ?`, [email, user.userId])
  return { email, email_verified: true }
})
