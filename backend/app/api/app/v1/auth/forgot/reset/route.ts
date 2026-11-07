import { appRoute } from '@/lib/app/context'
import { fail, only, reqStr } from '@/lib/app/http'
import { assertPasswordPolicy, findUserByIdentifier, hashPassword, revokeAllUserTokens } from '@/lib/app/security'
import { consumeEmailCode } from '@/lib/app/emailCodes'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'none', limiter: 'auth' }, async ({ company, body }): Promise<OkResponse> => {
  const b = await body()
  only(b, ['identifier', 'code', 'new_password'])
  const identifier = reqStr(b.identifier, 'identifier', 1, 64)
  const code = reqStr(b.code, 'code', 6, 6)
  const next = assertPasswordPolicy(b.new_password, 'new_password')
  const row = await findUserByIdentifier(company, identifier)
  if (!row || row.status === 'disabled') fail(400, 'CODE_INVALID', 'Invalid or expired code')
  await consumeEmailCode(company, String(row.id), code, 'reset')
  await company.tp.query(
    `UPDATE app_users SET password_hash = ?, must_change_password = 0, temp_password_expires_at = NULL, failed_logins = 0, locked_until = NULL WHERE id = ?`,
    [await hashPassword(next), row.id])
  await revokeAllUserTokens(company, String(row.id))
  return { ok: true }
})
