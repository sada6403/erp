import { appRoute, need } from '@/lib/app/context'
import { fail, only, reqStr } from '@/lib/app/http'
import { assertPasswordPolicy, hashPassword, issueTokens, revokeAllUserTokens, toAuthUser, verifyPassword, agentCodeOf } from '@/lib/app/security'
import { enqueueNotification } from '@/lib/app/notify'
import type { ChangePasswordResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', limiter: 'auth', allowPasswordChangePending: true }, async (c): Promise<ChangePasswordResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['current_password', 'new_password'])
  const current = reqStr(b.current_password, 'current_password', 1, 100)
  const next = assertPasswordPolicy(b.new_password, 'new_password')
  if (!(await verifyPassword(current, user.passwordHash))) fail(401, 'INVALID_CREDENTIALS', 'Current password is incorrect')
  if (next === current) fail(400, 'VALIDATION', 'New password must be different from the current one')
  await company.tp.query(
    `UPDATE app_users SET password_hash = ?, must_change_password = 0, temp_password_expires_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?`,
    [await hashPassword(next), user.userId])
  await revokeAllUserTokens(company, user.userId)
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_users WHERE id = ?`, [user.userId])
  const tokens = await issueTokens(company, rows[0])
  await enqueueNotification(company.tp, {
    userId: user.userId, type: 'account', channel: 'account', title: 'Password changed',
    body: 'Your password was changed. If this was not you, contact your branch.',
  })
  return { tokens, user: toAuthUser(rows[0], await agentCodeOf(company, rows[0].agent_id)) }
})
