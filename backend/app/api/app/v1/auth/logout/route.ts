import { appRoute } from '@/lib/app/context'
import { only, optStr } from '@/lib/app/http'
import { sha256 } from '@/lib/app/security'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Idempotent; works with an expired access token too (refresh token identifies the session).
export const POST = appRoute({ auth: 'optional', limiter: 'auth' }, async ({ company, user, body }): Promise<OkResponse> => {
  const b = await body()
  only(b, ['refresh_token', 'expo_push_token'])
  const raw = optStr(b.refresh_token, 'refresh_token', 300)
  const push = optStr(b.expo_push_token, 'expo_push_token', 255)
  if (raw) {
    const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT family_id, user_id FROM app_refresh_tokens WHERE token_hash = ?`, [sha256(raw)])
    if (rows[0]) {
      await company.tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE family_id = ? AND revoked_at IS NULL`, [rows[0].family_id])
      if (push) await company.tp.query(`DELETE FROM app_devices WHERE expo_push_token = ? AND user_id = ?`, [push, rows[0].user_id])
    }
  } else if (user && push) {
    await company.tp.query(`DELETE FROM app_devices WHERE expo_push_token = ? AND user_id = ?`, [push, user.userId])
  }
  return { ok: true }
})
