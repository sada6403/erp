import { appRoute, need } from '@/lib/app/context'
import { fail, round2, toIso } from '@/lib/app/http'
import { requireSmartBuy } from '@/lib/app/smartbuyLib'
import type { StatementResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['smartbuy'] }, async (c): Promise<StatementResponse> => {
  const { company, user, params } = need(c)
  const customerId = await requireSmartBuy(company, user)
  // Membership is looked up by (scheme, token's customer): someone else's scheme id is a 404.
  const m = await company.tp.query<Record<string, unknown>>(
    `SELECT m.id, s.name FROM chit_members m JOIN chit_schemes s ON s.id = m.scheme_id WHERE m.scheme_id = ? AND m.customer_id = ? LIMIT 1`,
    [params.id, customerId])
  if (!m.rows[0]) fail(404, 'NOT_FOUND', 'Scheme not found')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, cycle_no, amount, method, receipt_number, status, paid_at FROM chit_contributions
      WHERE member_id = ? ORDER BY paid_at DESC LIMIT 500`, [m.rows[0].id])
  return {
    scheme_id: params.id, scheme_name: String(m.rows[0].name),
    total_paid: round2(rows.filter(r => r.status === 'approved').reduce((a, r) => a + Number(r.amount), 0)),
    rows: rows.map(r => ({
      id: String(r.id), cycle_no: r.cycle_no != null ? Number(r.cycle_no) : null, amount: Number(r.amount), method: String(r.method),
      receipt_number: r.receipt_number ? String(r.receipt_number) : null, status: String(r.status), paid_at: toIso(r.paid_at) as string,
    })),
  }
})
