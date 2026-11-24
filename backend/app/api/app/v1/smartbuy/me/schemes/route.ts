import { appRoute, need } from '@/lib/app/context'
import { mySchemeDto, requireSmartBuy } from '@/lib/app/smartbuyLib'
import type { MySchemesResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['smartbuy'] }, async (c): Promise<MySchemesResponse> => {
  const { company, user } = need(c)
  const customerId = await requireSmartBuy(company, user)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT m.id AS member_id, m.scheme_id, m.contributions_paid, m.won_cycle_no, s.scheme_number, s.name, s.frequency,
            s.contribution_amount, s.chit_value, s.cycle_count, s.next_draw_date, s.status, a.name AS agent_name,
            (SELECT COUNT(DISTINCT cc.cycle_no) FROM chit_contributions cc
               WHERE cc.member_id = m.id AND cc.status = 'approved' AND cc.cycle_no IS NOT NULL) AS cycles_paid
       FROM chit_members m JOIN chit_schemes s ON s.id = m.scheme_id LEFT JOIN agents a ON a.id = m.agent_id
      WHERE m.customer_id = ? ORDER BY s.name`, [customerId])
  return { items: rows.map(mySchemeDto) }
})
