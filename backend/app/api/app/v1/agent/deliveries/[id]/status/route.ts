import { appRoute, need } from '@/lib/app/context'
import { loadAgentOrder, requireAgent } from '@/lib/app/agentLib'
import { fail, only, oneOf } from '@/lib/app/http'
import { onOrderStatusChanged } from '@/lib/app/ordersLib'
import type { OkResponse } from '@/lib/app/contracts/common'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<OkResponse> => {
  const { company, user, params } = need(c)
  const body = await c.body()
  only(body, ['status'])
  oneOf(body.status, 'status', ['in_transit'] as const)
  const o = await loadAgentOrder(company, requireAgent(user), params.id)
  if (String(o.status) === 'in_transit') return { ok: true }
  if (!['ready_for_delivery', 'dispatched'].includes(String(o.status))) fail(409, 'CONFLICT', 'Order is not ready for delivery.')
  await company.tp.query(
    `UPDATE customer_orders SET status = 'in_transit', dispatch_at = COALESCE(dispatch_at, NOW()) WHERE id = ? AND status IN ('ready_for_delivery','dispatched')`, [params.id])
  await onOrderStatusChanged(company.tp, params.id)
  return { ok: true }
})
