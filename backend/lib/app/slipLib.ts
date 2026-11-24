// Bank transfer slips for app orders: customer uploads (private image), POS verifies or rejects.
import { randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import { fail, only, optStr, reqStr, round2, toIso } from './http'
import { enqueueNotification } from './notify'
import { loadOwnOrder } from './ordersLib'
import type { OrderSlipDto } from './contracts/orders'
import type { AdminSlipDto, AdminSlipDecisionResponse } from './contracts/admin'

export const SLIP_FIELDS = ['reference', 'client_event_id']
const MAX_SLIPS = 5

function isDup(e: unknown): boolean {
  return /ER_DUP_ENTRY|Duplicate entry/i.test(String((e as Error)?.message ?? e))
}

export function slipDto(r: Record<string, unknown>): OrderSlipDto {
  const status = String(r.status) as OrderSlipDto['status']
  return {
    id: String(r.id), order_id: String(r.order_id), status, reject_reason: status === 'rejected' && r.reject_reason ? String(r.reject_reason) : null,
    reference: r.reference ? String(r.reference) : null, created_at: toIso(r.created_at) ?? '',
  }
}

export async function listOwnSlips(company: AppCompany, user: AppUserCtx, orderId: string): Promise<OrderSlipDto[]> {
  await loadOwnOrder(company, user, orderId) // 404 for anyone else's order
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM order_payment_slips WHERE order_id = ? ORDER BY created_at DESC LIMIT 20`, [orderId])
  return rows.map(slipDto)
}

export async function submitSlip(
  company: AppCompany, user: AppUserCtx, orderId: string, fields: Record<string, string>, save: () => Promise<string>
): Promise<{ created: boolean; dto: OrderSlipDto }> {
  only(fields, SLIP_FIELDS)
  const eventId = reqStr(fields.client_event_id, 'client_event_id', 8, 64)
  const reference = optStr(fields.reference, 'reference', 200)
  const order = await loadOwnOrder(company, user, orderId)
  const prior = await company.tp.query<Record<string, unknown>>(`SELECT * FROM order_payment_slips WHERE app_user_id = ? AND client_event_id = ?`, [user.userId, eventId])
  if (prior.rows[0]) return { created: false, dto: slipDto(prior.rows[0]) }

  if (String(order.payment_method) !== 'bank_transfer') fail(409, 'CONFLICT', 'This order is not paid by bank transfer.')
  if (String(order.status) === 'cancelled') fail(409, 'CONFLICT', 'This order was cancelled.')
  if (String(order.payment_status) === 'paid') fail(409, 'CONFLICT', 'This order is already paid.')
  const ex = await company.tp.query<Record<string, unknown>>(`SELECT status FROM order_payment_slips WHERE order_id = ?`, [orderId])
  if (ex.rows.some(s => ['pending', 'verified'].includes(String(s.status)))) fail(409, 'CONFLICT', 'A slip for this order is already waiting for verification.')
  if (ex.rows.length >= MAX_SLIPS) fail(409, 'CONFLICT', 'Too many slips for this order. Contact the branch.')

  const ref = await save()
  const id = randomUUID()
  try {
    await company.tp.query(
      `INSERT INTO order_payment_slips (id, order_id, app_user_id, file_ref, reference, client_event_id) VALUES (?, ?, ?, ?, ?, ?)`,
      [id, orderId, user.userId, ref, reference, eventId])
  } catch (e) {
    if (!isDup(e)) throw e
    const again = await company.tp.query<Record<string, unknown>>(`SELECT * FROM order_payment_slips WHERE app_user_id = ? AND client_event_id = ?`, [user.userId, eventId])
    if (again.rows[0]) return { created: false, dto: slipDto(again.rows[0]) }
    throw e
  }
  const row = await company.tp.query<Record<string, unknown>>(`SELECT * FROM order_payment_slips WHERE id = ?`, [id])
  return { created: true, dto: slipDto(row.rows[0]) }
}

export async function adminSlipList(company: AppCompany, status: string | null): Promise<AdminSlipDto[]> {
  const where = status && ['pending', 'verified', 'rejected'].includes(status) ? `WHERE p.status = ?` : ''
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT p.*, o.order_number, o.customer_name, o.total_amount, o.payment_reference AS order_reference FROM order_payment_slips p JOIN customer_orders o ON o.id = p.order_id
      ${where} ORDER BY (p.status = 'pending') DESC, p.created_at DESC LIMIT 300`, where ? [status] : [])
  return rows.map(r => ({
    id: String(r.id), order_id: String(r.order_id), order_number: String(r.order_number), customer_name: r.customer_name ? String(r.customer_name) : null,
    order_total: round2(Number(r.total_amount) || 0), reference: r.reference ? String(r.reference) : null,
    order_reference: r.order_reference ? String(r.order_reference) : null,
    status: String(r.status) as AdminSlipDto['status'], reject_reason: r.reject_reason ? String(r.reject_reason) : null,
    reviewed_by: r.reviewed_by ? String(r.reviewed_by) : null, reviewed_at: toIso(r.reviewed_at), created_at: toIso(r.created_at) ?? '',
  }))
}

/** verify -> order becomes paid (paid_amount = total); reject -> customer can upload a new slip. */
export async function decideSlip(
  company: AppCompany, id: string, decision: 'verify' | 'reject', reason: string | null, reviewedBy: string | null
): Promise<AdminSlipDecisionResponse> {
  if (decision === 'reject' && !reason) fail(400, 'VALIDATION', 'A reason is required to reject.')
  const conn = await company.tp.connect()
  let orderId = '', userId = '', orderNumber = ''
  try {
    await conn.query('START TRANSACTION')
    const s = await conn.query<Record<string, unknown>>(`SELECT * FROM order_payment_slips WHERE id = ? FOR UPDATE`, [id])
    const slip = s.rows[0]
    if (!slip) { await conn.query('ROLLBACK'); fail(404, 'NOT_FOUND', 'Slip not found') }
    if (String(slip.status) !== 'pending') { await conn.query('ROLLBACK'); fail(409, 'CONFLICT', `This slip was already ${String(slip.status)}.`) }
    orderId = String(slip.order_id); userId = String(slip.app_user_id)
    const o = await conn.query<Record<string, unknown>>(`SELECT order_number, total_amount, status FROM customer_orders WHERE id = ? FOR UPDATE`, [orderId])
    if (!o.rows[0]) { await conn.query('ROLLBACK'); fail(404, 'NOT_FOUND', 'Order not found') }
    orderNumber = String(o.rows[0].order_number)
    if (decision === 'verify') {
      if (String(o.rows[0].status) === 'cancelled') { await conn.query('ROLLBACK'); fail(409, 'CONFLICT', 'This order was cancelled.') }
      await conn.query(`UPDATE order_payment_slips SET status = 'verified', reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`, [reviewedBy, id])
      await conn.query(`UPDATE customer_orders SET payment_status = 'paid', paid_amount = total_amount WHERE id = ?`, [orderId])
    } else {
      await conn.query(`UPDATE order_payment_slips SET status = 'rejected', reject_reason = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`, [reason, reviewedBy, id])
    }
    await conn.query('COMMIT')
  } catch (e) {
    try { await conn.query('ROLLBACK') } catch { /* already rolled back */ }
    throw e
  } finally {
    conn.release()
  }
  await enqueueNotification(company.tp, {
    userId, type: 'order_status', channel: 'orders',
    title: decision === 'verify' ? 'Payment received' : 'Payment slip not accepted',
    body: decision === 'verify' ? `We received your payment for order ${orderNumber}.` : `Your slip for order ${orderNumber} was not accepted: ${reason}. Please upload a new one.`,
    url: `lankahome://orders/${orderId}`, dedupeKey: `slip:${id}:${decision}`,
    email: { type: decision === 'verify' ? 'slip_verified' : 'slip_rejected', entityId: id, data: { order: orderNumber, reason: reason ?? '' } },
  }).catch(() => undefined)
  return { ok: true, status: decision === 'verify' ? 'verified' : 'rejected' }
}
