import { appRoute, need } from '@/lib/app/context'
import { fail, only } from '@/lib/app/http'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user' }, async (c): Promise<OkResponse> => {
  const { company, user, body } = need(c)
  const b = await body()
  only(b, ['ids', 'all'])
  if (b.all === true) {
    await company.tp.query(`UPDATE app_notifications SET read_at = NOW() WHERE user_id = ? AND read_at IS NULL`, [user.userId])
  } else if (Array.isArray(b.ids) && b.ids.length && b.ids.length <= 200 && b.ids.every(i => typeof i === 'string')) {
    await company.tp.query(`UPDATE app_notifications SET read_at = NOW() WHERE user_id = ? AND id IN (?) AND read_at IS NULL`, [user.userId, b.ids])
  } else fail(400, 'VALIDATION', 'Send ids (array) or all: true')
  return { ok: true }
})
