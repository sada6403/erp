import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { round2 } from '@/lib/app/http'
import type { AgentDashboardResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentDashboardResponse> => {
  const { company, user } = need(c)
  const agentId = requireAgent(user)
  const q = (sql: string, p: unknown[]) => company.tp.query<Record<string, unknown>>(sql, p).then(r => r.rows[0] || {})
  const a = await q(`SELECT id, code, name, branch_id FROM agents WHERE id = ?`, [agentId])
  const mem = await q(`SELECT COUNT(*) AS n, COUNT(DISTINCT scheme_id) AS s FROM chit_members WHERE agent_id = ?`, [agentId])
  const pend = await q(`SELECT COUNT(*) AS n FROM customer_orders WHERE assigned_agent_id = ? AND status NOT IN ('delivered','cancelled','returned')`, [agentId])
  const done = await q(`SELECT COUNT(*) AS n FROM customer_orders WHERE assigned_agent_id = ? AND status = 'delivered' AND DATE(delivered_at) = CURDATE()`, [agentId])
  const com = await q(
    `SELECT
       COALESCE(SUM(CASE WHEN created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN total_commission END), 0) AS month_total,
       COALESCE(SUM(CASE WHEN status LIKE 'pending%' THEN total_commission END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status = 'paid' THEN total_commission END), 0) AS paid
     FROM commission_ledger WHERE registration_agent_id = ? OR sales_agent_id = ?`, [agentId, agentId])
  return {
    agent: { id: String(a.id || agentId), code: String(a.code || user.agentCode || ''), name: String(a.name || user.name), branch_id: a.branch_id ? String(a.branch_id) : null },
    members_count: Number(mem.n) || 0, schemes_count: Number(mem.s) || 0,
    deliveries_pending: Number(pend.n) || 0, deliveries_completed_today: Number(done.n) || 0,
    commission_this_month: round2(Number(com.month_total) || 0), commission_pending: round2(Number(com.pending) || 0),
    commission_paid_total: round2(Number(com.paid) || 0),
  }
})
