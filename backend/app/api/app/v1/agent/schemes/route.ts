import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { toIso } from '@/lib/app/http'
import type { AgentSchemesResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentSchemesResponse> => {
  const { company, user } = need(c)
  const agentId = requireAgent(user)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT s.id, s.scheme_number, s.name, s.status, s.next_draw_date, COUNT(m.id) AS member_count
       FROM chit_schemes s JOIN chit_members m ON m.scheme_id = s.id AND m.agent_id = ?
      GROUP BY s.id, s.scheme_number, s.name, s.status, s.next_draw_date ORDER BY s.name`, [agentId])
  return { items: rows.map(s => ({
    id: String(s.id), scheme_number: s.scheme_number ? String(s.scheme_number) : null, name: String(s.name),
    member_count: Number(s.member_count) || 0, status: String(s.status), next_draw_date: toIso(s.next_draw_date),
  })) }
})
