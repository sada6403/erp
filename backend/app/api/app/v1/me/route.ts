import { randomUUID } from 'crypto'
import { appRoute, need } from '@/lib/app/context'
import { fail, only, optStr, oneOf, reqStr } from '@/lib/app/http'
import { ctxToAuthUser, revokeAllUserTokens, verifyPassword } from '@/lib/app/security'
import { getModules } from '@/lib/app/settings'
import type { MeResponse } from '@/lib/app/contracts/auth'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET works while a password change is pending so the app can show the forced screen.
export const GET = appRoute({ auth: 'user', allowPasswordChangePending: true }, async (c): Promise<MeResponse> => {
  const { company, user } = need(c)
  return { ...ctxToAuthUser(user), modules: await getModules(company) }
})

export const PATCH = appRoute({ auth: 'user' }, async (c): Promise<MeResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['name', 'language'])
  const sets: string[] = [], vals: unknown[] = []
  if (b.name !== undefined) { sets.push('name = ?'); vals.push(reqStr(b.name, 'name', 2, 100)) }
  if (b.language !== undefined) { sets.push('language = ?'); vals.push(oneOf(b.language, 'language', ['en', 'ta', 'si'] as const)) }
  if (sets.length) await company.tp.query(`UPDATE app_users SET ${sets.join(', ')} WHERE id = ?`, [...vals, user.userId])
  const next = { ...user, name: b.name !== undefined ? String(vals[0]).toString() : user.name, language: (b.language as 'en' | 'ta' | 'si') ?? user.language }
  return { ...ctxToAuthUser(next), modules: await getModules(company) }
})

// Account deletion (Play policy): anonymise + disable; order history rows stay for accounting.
export const DELETE = appRoute({ auth: 'user', limiter: 'auth' }, async (c): Promise<OkResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['password'])
  const password = reqStr(b.password, 'password', 1, 100)
  if (!(await verifyPassword(password, user.passwordHash))) fail(401, 'INVALID_CREDENTIALS', 'Password is incorrect')
  const tomb = 'deleted-' + randomUUID().slice(0, 8)
  await company.tp.query(
    `UPDATE app_users SET status = 'disabled', deleted_at = NOW(), phone = NULL, member_no = NULL, email = NULL, email_verified_at = NULL,
            name = 'Deleted user', password_hash = ?, notification_settings = NULL WHERE id = ?`,
    ['x:' + tomb, user.userId])
  await revokeAllUserTokens(company, user.userId)
  await company.tp.query(`DELETE FROM app_devices WHERE user_id = ?`, [user.userId])
  await company.tp.query(`DELETE FROM wishlists WHERE user_id = ?`, [user.userId])
  await company.tp.query(`DELETE FROM app_addresses WHERE user_id = ?`, [user.userId])
  await company.tp.query(`DELETE FROM app_notifications WHERE user_id = ?`, [user.userId])
  void optStr
  return { ok: true }
})
