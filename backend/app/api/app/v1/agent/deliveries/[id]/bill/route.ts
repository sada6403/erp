import { appRoute, need } from '@/lib/app/context'
import { fail, round2 } from '@/lib/app/http'
import { loadAgentOrder, requireAgent } from '@/lib/app/agentLib'
import { loadAgent } from '@/lib/app/ordersLib'
import type { AgentBillDto } from '@/lib/app/contracts/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Bill for the agent's delivery, numbered with the POS invoice created from the order. */
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<AgentBillDto> => {
  const { company, user, params } = need(c)
  const o = await loadAgentOrder(company, requireAgent(user), params.id)
  const { rows: inv } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, invoice_number, created_at, total_amount, delivery_fee FROM invoices WHERE source_order_id = ? LIMIT 1`, [o.id])
  if (!inv[0]) fail(409, 'CONFLICT', 'The bill is not ready yet. The branch has not invoiced this order.')
  const { rows: lines } = await company.tp.query<Record<string, unknown>>(
    `SELECT ii.*, p.name AS pname, p.unit AS punit, p.sale_by FROM invoice_items ii
       LEFT JOIN products p ON p.id = ii.product_id WHERE ii.invoice_id = ? ORDER BY ii.id`, [inv[0].id])
  const { rows: br } = await company.tp.query<Record<string, unknown>>(`SELECT name, phone FROM branches WHERE id = ?`, [o.branch_id])
  const agent = await loadAgent(company.tp, user.agentId)
  const subtotal = round2(lines.reduce((s, l) => s + Number(l.unit_price) * Number(l.quantity), 0))
  const total = round2(Number(inv[0].total_amount) || 0)
  const cod = String(o.payment_method || '') === 'cod' && String(o.payment_status) !== 'paid'
  const delivered = String(o.status) === 'delivered'
  return {
    bill_no: String(inv[0].invoice_number), order_number: String(o.order_number),
    date: new Date(String(inv[0].created_at)).toISOString(),
    company_name: company.name, branch_name: br[0]?.name ? String(br[0].name) : null, branch_phone: br[0]?.phone ? String(br[0].phone) : null,
    agent_name: agent?.name ?? '', agent_code: agent?.code ?? '',
    customer_name: String(o.customer_name || 'Customer'), address: o.customer_address ? String(o.customer_address) : null,
    lines: lines.map(l => ({
      name: String(l.pname || 'Item') + (l.variant_title ? ` - ${String(l.variant_title)}` : ''),
      quantity: Number(l.quantity), unit: l.punit ? String(l.punit) : String(l.sale_by) === 'weight' ? 'kg' : 'pcs',
      unit_price: Number(l.unit_price), line_total: round2(Number(l.unit_price) * Number(l.quantity)),
    })),
    subtotal, discount: 0, delivery_fee: round2(Number(inv[0].delivery_fee) || 0), total,
    payment_label: cod ? 'Cash on delivery' : String(o.payment_method) === 'bank_transfer' ? 'Bank transfer' : 'Paid',
    otp: null,
    paid_in_full: !cod && (String(o.payment_status) === 'paid' || delivered),
  }
})
