import { randomUUID } from 'crypto'
import { appRoute, need } from '@/lib/app/context'
import { fail, only, oneOf, reqStr, optStr } from '@/lib/app/http'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TOKEN_RE = /^(Expo|Exponent)PushToken\[[\w\-]+\]$/

export const POST = appRoute({ auth: 'user' }, async (c): Promise<OkResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['expo_push_token', 'platform', 'app_version', 'device_label'])
  const token = reqStr(b.expo_push_token, 'expo_push_token', 10, 255)
  if (!TOKEN_RE.test(token)) fail(400, 'VALIDATION', 'Invalid Expo push token')
  const platform = oneOf(b.platform, 'platform', ['android', 'ios'] as const)
  const ver = reqStr(b.app_version, 'app_version', 1, 32)
  const label = optStr(b.device_label, 'device_label', 128)
  // A token belongs to exactly one account: re-registering moves it to the current user.
  await company.tp.query(
    `INSERT INTO app_devices (id, user_id, expo_push_token, platform, app_version, device_label, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE user_id = VALUES(user_id), platform = VALUES(platform), app_version = VALUES(app_version),
       device_label = VALUES(device_label), last_seen_at = NOW()`,
    [randomUUID(), user.userId, token, platform, ver, label])
  return { ok: true }
})

export const DELETE = appRoute({ auth: 'user' }, async (c): Promise<OkResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['expo_push_token'])
  await company.tp.query(`DELETE FROM app_devices WHERE expo_push_token = ? AND user_id = ?`, [reqStr(b.expo_push_token, 'expo_push_token', 10, 255), user.userId])
  return { ok: true }
})
