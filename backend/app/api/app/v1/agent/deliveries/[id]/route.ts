import { appRoute, need } from '@/lib/app/context'
import { deliveryDto, loadAgentOrder, loadAgentOrderItems, requireAgent } from '@/lib/app/agentLib'
import type { AgentDeliveryDto } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentDeliveryDto> => {
  const { company, user, params, origin } = need(c)
  const o = await loadAgentOrder(company, requireAgent(user), params.id)
  return deliveryDto(o, await loadAgentOrderItems(company, params.id, origin))
})
