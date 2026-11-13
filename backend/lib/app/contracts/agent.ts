import type { OrderItemDto, OrderStatus } from './orders'
import type { MemberDueDto } from './collections'

/** Optional, derived dashboard figures; every field may be absent. */
export interface AgentDashboardExtrasDto {
  on_duty?: boolean
  branch_name?: string | null
  families_served?: number
  smartbuy_members?: number
  cod_to_collect?: number
  on_time_pct?: number | null
  rank_label?: string
  rank_detail?: string | null
  tier?: string
  goal?: { title: string; subtitle: string; target: number; earned: number }
  incentive_banner?: string
  badges?: string[]
}

export interface AgentDashboardResponse {
  extras?: AgentDashboardExtrasDto
  agent: { id: string; code: string; name: string; branch_id: string | null }
  members_count: number
  schemes_count: number
  deliveries_pending: number
  deliveries_completed_today: number
  commission_this_month: number
  commission_pending: number
  commission_paid_total: number
}

export interface AgentSchemeDto {
  id: string
  scheme_number: string | null
  name: string
  member_count: number
  status: string
  next_draw_date: string | null
}
export interface AgentSchemesResponse {
  items: AgentSchemeDto[]
}

export interface AgentMemberDto {
  member_id: string
  customer_name: string
  /** Middle digits masked for list views */
  phone_masked: string | null
  scheme_id: string
  scheme_name: string
  contributions_paid: number
  status: string
  won_cycle_no: number | null
  /** This cycle's due and arrears; absent for members who owe nothing (redeemed, withdrawn, cancelled scheme) */
  collection?: MemberDueDto
}
export interface AgentMembersResponse {
  items: AgentMemberDto[]
  next_cursor: string | null
}
export interface AgentMemberDetailDto extends AgentMemberDto {
  phone: string | null
  address: string | null
  payments: Array<{ cycle_no: number | null; amount: number; status: string; paid_at: string; receipt_number: string | null }>
}

export interface CommissionRowDto {
  id: string
  source: string
  base_amount: number
  amount: number
  status: string
  created_at: string
}
export interface CommissionResponse {
  /** YYYY-MM */
  month: string
  total: number
  pending: number
  approved: number
  paid: number
  rows: CommissionRowDto[]
}

export interface AgentDeliveryDto {
  id: string
  order_number: string
  status: OrderStatus
  customer_name: string
  customer_phone: string | null
  address: string | null
  amount_due: number
  payment_method: string | null
  /** True when cash must be collected (COD) */
  collect_cash: boolean
  created_at: string
  items?: OrderItemDto[]
}
export interface AgentDeliveriesResponse {
  items: AgentDeliveryDto[]
}
export interface DeliveryStatusRequest {
  status: 'in_transit'
}
export interface DeliveryCompleteRequest {
  otp: string
  /** Event UUID used as idempotency key so offline replays are safe */
  event_id: string
  note?: string
}
export interface DeliveryCompleteResponse {
  order_id: string
  status: 'delivered'
  delivered_at: string
}

/** GET /agent/deliveries/:id/bill. `bill_no` is the POS invoice number of the converted app order. */
export interface AgentBillDto {
  bill_no: string
  order_number: string
  date: string
  company_name: string
  branch_name: string | null
  branch_phone: string | null
  /** From POS company settings; optional so older servers still parse */
  company_tin?: string | null
  company_address?: string | null
  footer_note?: string | null
  agent_name: string
  agent_code: string
  customer_name: string
  address: string | null
  lines: Array<{ name: string; quantity: number; unit: string; unit_price: number; line_total: number }>
  subtotal: number
  discount: number
  delivery_fee: number
  total: number
  payment_label: string
  otp: string | null
  paid_in_full: boolean
}
