import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { fail, intParam, toIso } from '@/lib/app/http'
import { createOrder, summaryOf } from '@/lib/app/ordersLib'
import type { OrdersListResponse } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', roles: ['customer'], limiter: 'order' }, async (c) => {
  const { req, company, user, body, origin } = need(c)
  const key = req.headers.get('idempotency-key')?.trim()
  if (!key) fail(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Idempotency-Key header is required')
  if (key.length > 128 || !/^[\w.\-:]+$/.test(key)) fail(400, 'VALIDATION', 'Invalid Idempotency-Key')
  const r = await createOrder(company, user, await body(), key, origin)
  return NextResponse.json(r.body, { status: r.status })
})

// Own orders only: app_user_id from the token, or the customer record linked to this account.
export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<OrdersListResponse> => {
  const { req, company, user } = need(c)
  const sp = req.nextUrl.searchParams
  const limit = intParam(sp.get('limit'), 20, 1, 50)
  const cur = sp.get('cursor')
  let curVals: unknown[] = []
  let curSql = ''
  if (cur) {
    try {
      const j = JSON.parse(Buffer.from(cur, 'base64url').toString('utf8')) as { t: string; id: string }
      curSql = 'AND (o.created_at < ? OR (o.created_at = ? AND o.id < ?))'
      curVals = [j.t, j.t, j.id]
    } catch { fail(400, 'VALIDATION', 'Invalid cursor') }
  }
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT o.*, (SELECT COUNT(*) FROM customer_order_items i WHERE i.order_id = o.id) AS item_count
       FROM customer_orders o
      WHERE (o.app_user_id = ? OR (? IS NOT NULL AND o.customer_id = ?)) ${curSql}
      ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit + 1}`,
    [user.userId, user.customerId, user.customerId, ...curVals])
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  const next = rows.length > limit && last
    ? Buffer.from(JSON.stringify({ t: (toIso(last.created_at) as string).slice(0, 19).replace('T', ' '), id: String(last.id) })).toString('base64url') : null
  return { items: page.map(o => summaryOf(o, Number(o.item_count))), next_cursor: next }
})
