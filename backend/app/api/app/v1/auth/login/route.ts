import { appRoute } from '@/lib/app/context'
import { fail, only, reqStr, optStr } from '@/lib/app/http'
import {
  LOCK_MINUTES, MAX_FAILED_LOGINS, agentCodeOf, burnPasswordCheck, findUserByIdentifier, issueTokens, toAuthUser, verifyPassword,
} from '@/lib/app/security'
import type { LoginResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'none', limiter: 'auth' }, async ({ company, body }): Promise<LoginResponse> => {
  const b = await body()
  only(b, ['identifier', 'password', 'device_id'])
  const identifier = reqStr(b.identifier, 'identifier', 1, 64)
  const password = reqStr(b.password, 'password', 1, 100)
  const deviceId = optStr(b.device_id, 'device_id', 191)

  const row = await findUserByIdentifier(company, identifier)
  if (!row) {
    await burnPasswordCheck(password)
    fail(401, 'INVALID_CREDENTIALS', 'Incorrect ID or password')
  }
  const id = String(row.id)
  if (row.status === 'disabled') fail(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact your branch.')
  const lockedUntil = row.locked_until ? new Date(row.locked_until as string | Date) : null
  if (lockedUntil && lockedUntil.getTime() > Date.now()) {
    fail(403, 'ACCOUNT_LOCKED', `Too many attempts. Try again in ${Math.ceil((lockedUntil.getTime() - Date.now()) / 60000)} minutes.`)
  }
  const ok = await verifyPassword(password, String(row.password_hash))
  if (!ok) {
    const failed = Number(row.failed_logins) + 1
    if (failed >= MAX_FAILED_LOGINS) {
      await company.tp.query(`UPDATE app_users SET failed_logins = 0, locked_until = DATE_ADD(NOW(), INTERVAL ? MINUTE) WHERE id = ?`, [LOCK_MINUTES, id])
      fail(403, 'ACCOUNT_LOCKED', `Too many attempts. Try again in ${LOCK_MINUTES} minutes.`)
    }
    await company.tp.query(`UPDATE app_users SET failed_logins = ? WHERE id = ?`, [failed, id])
    fail(401, 'INVALID_CREDENTIALS', 'Incorrect ID or password')
  }
  const mustChange = Number(row.must_change_password) === 1
  const exp = row.temp_password_expires_at ? new Date(row.temp_password_expires_at as string | Date) : null
  if (mustChange && exp && exp.getTime() < Date.now()) {
    fail(401, 'TEMP_PASSWORD_EXPIRED', 'Your temporary password has expired. Please ask your branch for a new one.')
  }
  await company.tp.query(`UPDATE app_users SET failed_logins = 0, locked_until = NULL, last_login_at = NOW() WHERE id = ?`, [id])
  const tokens = await issueTokens(company, row, { deviceId })
  return { tokens, user: toAuthUser(row, await agentCodeOf(company, row.agent_id)), must_change_password: mustChange }
})
