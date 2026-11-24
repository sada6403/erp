import { appRoute, need } from '@/lib/app/context'
import { fail, only } from '@/lib/app/http'
import type { NotificationSettingsDto } from '@/lib/app/contracts/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CH = ['orders', 'deliveries', 'smartbuy', 'account', 'offers'] as const
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/

function toDto(s: Record<string, unknown>): NotificationSettingsDto {
  const o = {} as NotificationSettingsDto
  for (const k of CH) o[k] = s[k] !== false
  o.quiet_hours_start = typeof s.quiet_hours_start === 'string' ? s.quiet_hours_start : null
  o.quiet_hours_end = typeof s.quiet_hours_end === 'string' ? s.quiet_hours_end : null
  return o
}

export const GET = appRoute({ auth: 'user' }, async (c): Promise<NotificationSettingsDto> => toDto(need(c).user.notificationSettings))

export const PUT = appRoute({ auth: 'user' }, async (c): Promise<NotificationSettingsDto> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, [...CH, 'quiet_hours_start', 'quiet_hours_end'])
  const next: Record<string, unknown> = { ...user.notificationSettings }
  for (const k of CH) if (b[k] !== undefined) { if (typeof b[k] !== 'boolean') fail(400, 'VALIDATION', `${k} must be boolean`); next[k] = b[k] }
  for (const k of ['quiet_hours_start', 'quiet_hours_end'] as const) {
    if (b[k] === undefined) continue
    if (b[k] === null) next[k] = null
    else if (typeof b[k] === 'string' && HHMM.test(b[k] as string)) next[k] = b[k]
    else fail(400, 'VALIDATION', `${k} must be HH:MM or null`)
  }
  await company.tp.query(`UPDATE app_users SET notification_settings = ? WHERE id = ?`, [JSON.stringify(next), user.userId])
  return toDto(next)
})
