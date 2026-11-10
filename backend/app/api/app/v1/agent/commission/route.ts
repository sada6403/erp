import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { fail, round2, toIso } from '@/lib/app/http'
import type { CommissionResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The ledger stores the source table name; the app shows a readable label instead.
const SOURCE_LABELS: Record<string, string> = {
  chit_contributions: 'Smart Buy contribution',
  invoices: 'Sale commission',
  customer_orders: 'Delivery commission',
}
const sourceLabel = (table: unknown) => SOURCE_LABELS[String(table)] ?? 'Commission'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<CommissionResponse> => {
  const { company, user, req } = need(c)
  const agentId = requireAgent(user)
  const now = new Date()
  const month = req.nextUrl.searchParams.get('month') || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) fail(400, 'VALIDATION', 'month must be YYYY-MM')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, source_table, base_amount, total_commission, status, created_at FROM commission_ledger
      WHERE (registration_agent_id = ? OR sales_agent_id = ?) AND DATE_FORMAT(created_at, '%Y-%m') = ?
      ORDER BY created_at DESC LIMIT 500`, [agentId, agentId, month])
  const sum = (f: (s: string) => boolean) => round2(rows.filter(r => f(String(r.status))).reduce((a, r) => a + Number(r.total_commission), 0))
  return {
    month, total: sum(() => true), pending: sum(s => s.startsWith('pending')), approved: sum(s => s === 'approved'), paid: sum(s => s === 'paid'),
    rows: rows.map(r => ({
      id: String(r.id), source: sourceLabel(r.source_table), base_amount: Number(r.base_amount), amount: Number(r.total_commission),
      status: String(r.status), created_at: toIso(r.created_at) as string,
    })),
  }
})
