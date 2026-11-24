import type { AppCompany, AppUserCtx } from './context'
import { fail, round2, toIso } from './http'
import { maskPhone } from './security'
import { loadOrderItems } from './ordersLib'
import type { AgentDeliveryDto } from './contracts/agent'
import type { OrderStatus } from './contracts/orders'

export function requireAgent(user: AppUserCtx): string {
  if (!user.agentId) fail(403, 'FORBIDDEN', 'Not allowed for this account')
  return user.agentId
}

export { maskPhone }

export function deliveryDto(o: Record<string, unknown>, items?: AgentDeliveryDto['items']): AgentDeliveryDto {
  const cod = String(o.payment_method || '') === 'cod' && String(o.payment_status) !== 'paid'
  const total = Number(o.total_amount) || 0
  const wallet = Number(o.wallet_amount) || 0
  return {
    id: String(o.id), order_number: String(o.order_number), status: String(o.status) as OrderStatus,
    customer_name: String(o.customer_name || 'Customer'), customer_phone: o.customer_phone ? String(o.customer_phone) : null,
    address: o.customer_address ? String(o.customer_address) : null,
    amount_due: cod ? round2(Math.max(0, total - wallet)) : 0,
    payment_method: o.payment_method ? String(o.payment_method) : null, collect_cash: cod,
    created_at: toIso(o.created_at) as string, ...(items ? { items } : {}),
  }
}

/** Order assigned to this agent, or 404 (another agent's order never reveals existence). */
export async function loadAgentOrder(company: AppCompany, agentId: string, id: string): Promise<Record<string, unknown>> {
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT * FROM customer_orders WHERE id = ? AND assigned_agent_id = ? LIMIT 1`, [id, agentId])
  if (!rows[0]) fail(404, 'NOT_FOUND', 'Delivery not found')
  return rows[0]
}

export async function loadAgentOrderItems(company: AppCompany, id: string, origin: string) {
  return loadOrderItems(company.tp, id, origin)
}
