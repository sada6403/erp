import { appRoute, need } from '@/lib/app/context'
import { deliveryDto, requireAgent } from '@/lib/app/agentLib'
import type { AgentDeliveriesResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentDeliveriesResponse> => {
  const { company, user } = need(c)
  const agentId = requireAgent(user)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM customer_orders WHERE assigned_agent_id = ?
        AND (status NOT IN ('delivered','cancelled','returned') OR (status = 'delivered' AND delivered_at >= DATE_SUB(NOW(), INTERVAL 2 DAY)))
      ORDER BY created_at DESC LIMIT 200`, [agentId])
  return { items: rows.map(o => deliveryDto(o)) }
})
