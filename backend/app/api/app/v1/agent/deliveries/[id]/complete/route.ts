import { randomUUID } from 'crypto'
import { appRoute, need } from '@/lib/app/context'
import { loadAgentOrder, requireAgent } from '@/lib/app/agentLib'
import { fail, only, optStr, reqStr, toIso } from '@/lib/app/http'
import { onOrderStatusChanged } from '@/lib/app/ordersLib'
import { verifyDeliveryOtp } from '@/lib/app/security'
import type { DeliveryCompleteResponse } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Per-order wrong-OTP counter (in addition to the route rate limit).
const attempts = new Map<string, { n: number; until: number }>()
const MAX_ATTEMPTS = 5

export const POST = appRoute({ auth: 'user', roles: ['agent'], limiter: 'otp' }, async (c): Promise<DeliveryCompleteResponse> => {
  const { company, user, params } = need(c)
  const agentId = requireAgent(user)
  const body = await c.body()
  only(body, ['otp', 'event_id', 'note'])
  const otp = reqStr(body.otp, 'otp', 4, 4)
  const eventId = reqStr(body.event_id, 'event_id', 8, 128)
  const note = optStr(body.note, 'note', 500)

  // Idempotent replay (offline queue may resend the same event).
  const prior = await company.tp.query<Record<string, unknown>>(
    `SELECT response_body FROM app_request_receipts WHERE user_id = ? AND scope = 'delivery' AND idempotency_key = ?`, [user.userId, eventId])
  if (prior.rows[0]?.response_body) return JSON.parse(String(prior.rows[0].response_body)) as DeliveryCompleteResponse

  const o = await loadAgentOrder(company, agentId, params.id)
  if (String(o.status) === 'delivered') {
    return { order_id: params.id, status: 'delivered', delivered_at: toIso(o.delivered_at) || new Date().toISOString() }
  }
  if (['cancelled', 'returned'].includes(String(o.status))) fail(409, 'CONFLICT', 'Order is not deliverable.')

  const a = attempts.get(params.id)
  if (a && a.until > Date.now() && a.n >= MAX_ATTEMPTS) fail(429, 'RATE_LIMITED', 'Too many wrong codes. Try again later.')
  if (!verifyDeliveryOtp(params.id, otp)) {
    const cur = a && a.until > Date.now() ? a : { n: 0, until: Date.now() + 15 * 60 * 1000 }
    cur.n += 1
    attempts.set(params.id, cur)
    fail(400, 'OTP_INVALID', 'The delivery code is incorrect.')
  }
  attempts.delete(params.id)

  const deliveredAt = new Date()
  const cod = String(o.payment_method || '') === 'cod'
  await company.tp.query(
    `UPDATE customer_orders SET status = 'delivered', delivered_at = ?, payment_status = ? WHERE id = ? AND status NOT IN ('delivered','cancelled','returned')`,
    [deliveredAt, cod ? 'paid' : String(o.payment_status), params.id])
  await onOrderStatusChanged(company.tp, params.id)
  const resp: DeliveryCompleteResponse = { order_id: params.id, status: 'delivered', delivered_at: deliveredAt.toISOString() }
  try {
    await company.tp.query(
      `INSERT INTO app_request_receipts (id, user_id, scope, idempotency_key, request_hash, response_status, response_body) VALUES (?, ?, 'delivery', ?, NULL, 200, ?)`,
      [randomUUID(), user.userId, eventId, JSON.stringify(resp)])
  } catch { /* duplicate event: harmless */ }
  void note
  return resp
})
