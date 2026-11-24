import { agentDeactivated, appRoute } from '@/lib/app/context'
import { fail, only, reqStr, optStr } from '@/lib/app/http'
import { REFRESH_TTL_MS, agentCodeOf, issueTokens, sha256, toAuthUser } from '@/lib/app/security'
import type { RefreshResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'none', limiter: 'auth' }, async ({ company, body }): Promise<RefreshResponse> => {
  const b = await body()
  only(b, ['refresh_token', 'device_id'])
  const raw = reqStr(b.refresh_token, 'refresh_token', 10, 300)
  const deviceId = optStr(b.device_id, 'device_id', 191)
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_refresh_tokens WHERE token_hash = ? LIMIT 1`, [sha256(raw)])
  const t = rows[0]
  if (!t) fail(401, 'UNAUTHORIZED', 'Sign in required')
  const family = String(t.family_id)
  if (t.revoked_at) {
    // Reuse of a rotated token: assume theft, kill the whole family.
    await company.tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL`, [family])
    fail(401, 'UNAUTHORIZED', 'Sign in required')
  }
  if (new Date(t.expires_at as string | Date).getTime() < Date.now()) fail(401, 'TOKEN_EXPIRED', 'Session expired')
  const u = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_users WHERE id = ? AND deleted_at IS NULL`, [t.user_id])
  const row = u.rows[0]
  if (!row || row.status !== 'active') fail(401, 'UNAUTHORIZED', 'Sign in required')
  if (String(row.roles ?? '').replace(/[\[\]"\s]/g, '') === 'agent' && await agentDeactivated(company.tp, row.agent_id)) fail(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact your branch.')
  // Rotate: atomically revoke the presented token (only one concurrent caller wins).
  const upd = await company.tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE id = ? AND revoked_at IS NULL`, [t.id])
  if (Number((upd.rows as unknown as { affectedRows?: number }).affectedRows) === 0) fail(401, 'UNAUTHORIZED', 'Sign in required')
  void REFRESH_TTL_MS
  const tokens = await issueTokens(company, row, { deviceId: deviceId ?? (t.device_id as string | null), familyId: family })
  return { ...tokens, user: toAuthUser(row, await agentCodeOf(company, row.agent_id)) }
})
