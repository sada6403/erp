import { appRoute, need } from '@/lib/app/context'
import { fail, toIso } from '@/lib/app/http'
import { maskedWinner, requireSmartBuy } from '@/lib/app/smartbuyLib'
import type { DrawsResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['smartbuy'] }, async (c): Promise<DrawsResponse> => {
  const { company, user, params } = need(c)
  const customerId = await requireSmartBuy(company, user)
  const m = await company.tp.query(`SELECT id FROM chit_members WHERE scheme_id = ? AND customer_id = ? LIMIT 1`, [params.id, customerId])
  if (!m.rows[0]) fail(404, 'NOT_FOUND', 'Scheme not found')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT d.id, d.cycle_no, d.draw_date, d.method, d.winner_member_id, w.join_order, w.customer_id AS winner_customer, cu.name AS winner_name
       FROM chit_draws d LEFT JOIN chit_members w ON w.id = d.winner_member_id LEFT JOIN customers cu ON cu.id = w.customer_id
      WHERE d.scheme_id = ? ORDER BY d.cycle_no DESC`, [params.id])
  return {
    scheme_id: params.id,
    items: rows.map(d => {
      const me = d.winner_customer === customerId
      return {
        id: String(d.id), cycle_no: Number(d.cycle_no), draw_date: toIso(d.draw_date) as string, method: String(d.method),
        winner_label: d.winner_name ? (me ? `You - Member #${Number(d.join_order)}` : maskedWinner(String(d.winner_name), Number(d.join_order))) : null,
        is_me: me, has_video: false as const,
      }
    }),
  }
})
