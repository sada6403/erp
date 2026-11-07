import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { fail, round2, toIso } from '@/lib/app/http'
import type { AgentMemberDetailDto } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentMemberDetailDto> => {
  const { company, user, params } = need(c)
  const agentId = requireAgent(user)
  // Scoped by the token's agent: another agent's member id is a 404.
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT m.id AS member_id, m.scheme_id, m.contributions_paid, m.status, m.won_cycle_no, cu.name AS customer_name, cu.phone, cu.address, s.name AS scheme_name
       FROM chit_members m JOIN chit_schemes s ON s.id = m.scheme_id LEFT JOIN customers cu ON cu.id = m.customer_id
      WHERE m.id = ? AND m.agent_id = ? LIMIT 1`, [params.id, agentId])
  const m = rows[0]
  if (!m) fail(404, 'NOT_FOUND', 'Member not found')
  const pay = await company.tp.query<Record<string, unknown>>(
    `SELECT cycle_no, amount, status, paid_at, receipt_number FROM chit_contributions WHERE member_id = ? ORDER BY paid_at DESC LIMIT 200`, [params.id])
  const phone = m.phone ? String(m.phone) : null
  return {
    member_id: String(m.member_id), customer_name: String(m.customer_name || 'Member'),
    phone_masked: phone ? phone.slice(0, 3) + '****' + phone.slice(-3) : null, phone,
    address: m.address ? String(m.address) : null,
    scheme_id: String(m.scheme_id), scheme_name: String(m.scheme_name), contributions_paid: round2(Number(m.contributions_paid) || 0),
    status: String(m.status), won_cycle_no: m.won_cycle_no != null ? Number(m.won_cycle_no) : null,
    payments: pay.rows.map(p => ({
      cycle_no: p.cycle_no != null ? Number(p.cycle_no) : null, amount: Number(p.amount), status: String(p.status),
      paid_at: toIso(p.paid_at) as string, receipt_number: p.receipt_number ? String(p.receipt_number) : null,
    })),
  }
})
