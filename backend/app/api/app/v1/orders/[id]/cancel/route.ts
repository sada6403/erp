import { appRoute, need } from '@/lib/app/context'
import { cancelOrder, loadOwnOrder, mapOrder } from '@/lib/app/ordersLib'
import { only, optStr } from '@/lib/app/http'
import type { OrderDto } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', roles: ['customer'], limiter: 'order' }, async (c): Promise<OrderDto> => {
  const { company, user, params, origin, body } = need(c)
  const b = await body()
  only(b, ['reason'])
  optStr(b.reason, 'reason', 300)
  await cancelOrder(company, user, params.id)
  return mapOrder(company.tp, await loadOwnOrder(company, user, params.id), origin, true)
})
