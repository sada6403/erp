import { appRoute, need } from '@/lib/app/context'
import { buildTracking, loadOwnOrder } from '@/lib/app/ordersLib'
import type { TrackingResponse } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<TrackingResponse> => {
  const { company, user, params } = need(c)
  return buildTracking(company.tp, await loadOwnOrder(company, user, params.id))
})
