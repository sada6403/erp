import { appRoute, need } from '@/lib/app/context'
import { loadOwnOrder, mapOrder } from '@/lib/app/ordersLib'
import type { OrderDto } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<OrderDto> => {
  const { company, user, params, origin } = need(c)
  return mapOrder(company.tp, await loadOwnOrder(company, user, params.id), origin, true)
})
