import { appRoute, need } from '@/lib/app/context'
import { maskPhone, requireAgent } from '@/lib/app/agentLib'
import { intParam, round2 } from '@/lib/app/http'
import { dueFor } from '@/lib/app/collectionsLib'
import type { AgentMembersResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentMembersResponse> => {
  const { company, user, req } = need(c)
  const agentId = requireAgent(user)
  const sp = req.nextUrl.searchParams
  const limit = intParam(sp.get('limit'), 30, 1, 100)
  const offset = intParam(sp.get('cursor'), 0, 0, 100000)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT m.id AS member_id, m.id, m.scheme_id, m.contributions_paid, m.credit_balance, m.status, m.won_cycle_no, cu.name AS customer_name, cu.phone, s.name AS scheme_name,
       s.status AS scheme_status, s.contribution_amount, s.start_date, s.late_payment_days, s.late_fee_amount, s.frequency
       FROM chit_members m JOIN chit_schemes s ON s.id = m.scheme_id LEFT JOIN customers cu ON cu.id = m.customer_id
      WHERE m.agent_id = ? ORDER BY cu.name, m.id LIMIT ${limit + 1} OFFSET ${offset}`, [agentId])
  const page = rows.slice(0, limit)
  const due = await dueFor(company, page)
  return {
    items: page.map(m => ({
      member_id: String(m.member_id), customer_name: String(m.customer_name || 'Member'), phone_masked: maskPhone(m.phone ? String(m.phone) : null),
      scheme_id: String(m.scheme_id), scheme_name: String(m.scheme_name), contributions_paid: round2(Number(m.contributions_paid) || 0),
      status: String(m.status), won_cycle_no: m.won_cycle_no != null ? Number(m.won_cycle_no) : null,
      ...(due.get(String(m.member_id)) && m.status === 'active' && m.scheme_status !== 'cancelled' ? { collection: due.get(String(m.member_id)) } : {}),
    })),
    next_cursor: rows.length > limit ? String(offset + limit) : null,
  }
})
