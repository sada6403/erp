import { appRoute } from '@/lib/app/context'
import { toIso } from '@/lib/app/http'
import { VISIBLE_SQL } from '@/lib/app/catalogLib'
import type { WatermarkResponse } from '@/lib/app/contracts/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'optional' }, async ({ company, user }): Promise<WatermarkResponse> => {
  const max = async (sql: string, v: unknown[] = []) => {
    const { rows } = await company.tp.query<{ m: unknown }>(sql, v)
    return toIso(rows[0]?.m)
  }
  const areas: WatermarkResponse['areas'] = {
    catalog: await max(`SELECT GREATEST(COALESCE(MAX(p.updated_at), '1970-01-01'), COALESCE((SELECT MAX(updated_at) FROM product_variants), '1970-01-01'), COALESCE((SELECT MAX(updated_at) FROM stocks), '1970-01-01')) AS m FROM products p WHERE ${VISIBLE_SQL}`),
    categories: await max(`SELECT MAX(updated_at) AS m FROM categories`),
    banners: await max(`SELECT MAX(updated_at) AS m FROM app_banners`),
    settings: await max(`SELECT MAX(updated_at) AS m FROM app_settings`),
  }
  if (user) {
    areas.orders = await max(`SELECT MAX(updated_at) AS m FROM customer_orders WHERE app_user_id = ? OR (customer_id IS NOT NULL AND customer_id = ?)`, [user.userId, user.customerId])
    areas.notifications = await max(`SELECT MAX(created_at) AS m FROM app_notifications WHERE user_id = ?`, [user.userId])
    if (user.agentId) areas.deliveries = await max(`SELECT MAX(updated_at) AS m FROM customer_orders WHERE assigned_agent_id = ?`, [user.agentId])
  }
  return { server_time: new Date().toISOString(), areas }
})
