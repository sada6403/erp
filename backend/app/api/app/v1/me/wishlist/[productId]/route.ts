import { appRoute, need } from '@/lib/app/context'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const DELETE = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<OkResponse> => {
  const { company, user, params } = need(c)
  await company.tp.query(`DELETE FROM wishlists WHERE user_id = ? AND product_id = ?`, [user.userId, params.productId])
  return { ok: true }
})
