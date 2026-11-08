import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { round2 } from '@/lib/app/http'
import type { AgentDashboardResponse, AgentDashboardExtrasDto } from '@/lib/app/contracts/agent'

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
  const extras = await buildExtras(company, agentId, a, Number(mem.n) || 0, Number(pend.n) || 0, round2(Number(com.month_total) || 0)).catch(() => undefined)
  return {
    agent: { id: String(a.id || agentId), code: String(a.code || user.agentCode || ''), name: String(a.name || user.name), branch_id: a.branch_id ? String(a.branch_id) : null },
    members_count: Number(mem.n) || 0, schemes_count: Number(mem.s) || 0,
    deliveries_pending: Number(pend.n) || 0, deliveries_completed_today: Number(done.n) || 0,
    commission_this_month: round2(Number(com.month_total) || 0), commission_pending: round2(Number(com.pending) || 0),
    commission_paid_total: round2(Number(com.paid) || 0),
    ...(extras ? { extras } : {}),
  }
})

type Company = Parameters<typeof need>[0] extends never ? never : ReturnType<typeof need>['company']

/**
 * Real, derived dashboard figures (no invented data). Anything the database cannot support is left out so the app hides it.
 *  - on-time = delivered within 24 h of the order being placed (documented in DECISIONS.md)
 *  - rank = position by this month's commission among agents of the same branch
 */
async function buildExtras(company: Company, agentId: string, a: Record<string, unknown>, members: number, pending: number, monthCommission: number): Promise<AgentDashboardExtrasDto> {
  const q = (sql: string, p: unknown[]) => company.tp.query<Record<string, unknown>>(sql, p).then(r => r.rows)
  const one = async (sql: string, p: unknown[]) => (await q(sql, p))[0] || {}
  const full = await one(`SELECT a.status, a.monthly_target, b.name AS branch_name FROM agents a LEFT JOIN branches b ON b.id = a.branch_id WHERE a.id = ?`, [agentId])
  const fam = await one(`SELECT COUNT(DISTINCT customer_id) AS n FROM customer_orders WHERE assigned_agent_id = ? AND status = 'delivered'`, [agentId])
  const chit = await one(`SELECT COUNT(DISTINCT customer_id) AS n FROM chit_members WHERE agent_id = ?`, [agentId])
  const ot = await one(`SELECT COUNT(*) AS total, SUM(CASE WHEN TIMESTAMPDIFF(HOUR, created_at, delivered_at) <= 24 THEN 1 ELSE 0 END) AS ontime FROM customer_orders WHERE assigned_agent_id = ? AND status = 'delivered' AND delivered_at IS NOT NULL`, [agentId])
  const cod = await one(`SELECT COALESCE(SUM(total_amount), 0) AS amt FROM customer_orders WHERE assigned_agent_id = ? AND status NOT IN ('delivered','cancelled','returned') AND payment_method = 'cod' AND payment_status <> 'paid'`, [agentId])
  const delivered = Number(ot.total) || 0
  const x: AgentDashboardExtrasDto = {
    on_duty: String(full.status || 'active') === 'active',
    branch_name: full.branch_name ? String(full.branch_name) : null,
    families_served: (Number(fam.n) || 0) + (Number(chit.n) || 0),
    smartbuy_members: members,
    cod_to_collect: round2(Number(cod.amt) || 0),
    on_time_pct: delivered > 0 ? Math.round(((Number(ot.ontime) || 0) / delivered) * 1000) / 10 : null,
  }
  const rk = await q(
    `SELECT a.id, COALESCE(SUM(CASE WHEN c.created_at >= DATE_FORMAT(NOW(), '%Y-%m-01') THEN c.total_commission END), 0) AS m
       FROM agents a LEFT JOIN commission_ledger c ON (c.registration_agent_id = a.id OR c.sales_agent_id = a.id)
      WHERE a.status = 'active' AND (a.branch_id <=> ?) GROUP BY a.id ORDER BY m DESC`, [a.branch_id ?? null])
  const pos = rk.findIndex(r => String(r.id) === agentId) + 1
  if (pos > 0) {
    x.rank_label = `Rank #${pos}`
    x.rank_detail = full.branch_name ? `${full.branch_name}` : null
    x.tier = pos <= 3 ? 'Tier 1' : pos <= 10 ? 'Tier 2' : 'Tier 3'
  }
  const target = Number(full.monthly_target) || 0
  if (target > 0) {
    x.goal = { title: 'Monthly Target', subtitle: `Earn Rs ${target.toLocaleString('en-LK')} this month`, target, earned: monthCommission }
  }
  if (pending > 0) x.incentive_banner = `${pending} More Deliveries Today: Complete today's assigned drops to keep your on-time rate high.`
  const badges: string[] = []
  if (delivered >= 100) badges.push('Century Club')
  if (x.on_time_pct != null && delivered >= 10 && x.on_time_pct >= 95) badges.push('Quick Courier')
  if (members >= 25) badges.push('Top Enroller')
  if (badges.length) x.badges = badges
  return x
}
