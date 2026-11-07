import { appRoute, need } from '@/lib/app/context'
import { fail, intParam, toIso } from '@/lib/app/http'
import { notificationToDto } from '@/lib/app/notify'
import type { NotificationsResponse, NotificationDto } from '@/lib/app/contracts/notifications'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user' }, async (c): Promise<NotificationsResponse> => {
  const { req, company, user } = need(c)
  const sp = req.nextUrl.searchParams
  const limit = intParam(sp.get('limit'), 30, 1, 100)
  let curSql = '', curVals: unknown[] = []
  const cur = sp.get('cursor')
  if (cur) {
    try {
      const j = JSON.parse(Buffer.from(cur, 'base64url').toString('utf8')) as { t: string; id: string }
      curSql = 'AND (created_at < ? OR (created_at = ? AND id < ?))'; curVals = [j.t, j.t, j.id]
    } catch { fail(400, 'VALIDATION', 'Invalid cursor') }
  }
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM app_notifications WHERE user_id = ? ${curSql} ORDER BY created_at DESC, id DESC LIMIT ${limit + 1}`, [user.userId, ...curVals])
  const unread = await company.tp.query<{ n: string }>(`SELECT COUNT(*) AS n FROM app_notifications WHERE user_id = ? AND read_at IS NULL`, [user.userId])
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    items: page.map(notificationToDto) as NotificationDto[],
    unread_count: Number(unread.rows[0].n),
    next_cursor: rows.length > limit && last
      ? Buffer.from(JSON.stringify({ t: (toIso(last.created_at) as string).slice(0, 19).replace('T', ' '), id: String(last.id) })).toString('base64url') : null,
  }
})
