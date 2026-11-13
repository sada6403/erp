import type { PaymentMethod } from './common'
import type { AddressInput } from './addresses'

export interface CartLineInput {
  product_id: string
  variant_id?: string | null
  /** Decimal for weight items (e.g. 0.25), integer otherwise */
  quantity: number
}

export interface QuoteRequest {
  items: CartLineInput[]
  branch_id?: string
  address_id?: string
  payment_method?: PaymentMethod
}
export interface QuoteLineDto {
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  unit: string
  quantity: number
  unit_price: number
  line_total: number
  available: boolean
  available_qty: number | null
  /** Set when the requested quantity is more than available or the item cannot be sold */
  issue: 'OUT_OF_STOCK' | 'INSUFFICIENT_STOCK' | 'NOT_FOR_SALE' | 'NOT_FOUND' | 'INVALID_QUANTITY' | null
}
export interface QuoteResponse {
  branch_id: string
  lines: QuoteLineDto[]
  subtotal: number
  delivery_fee: number
  total: number
  currency: 'LKR'
  can_order: boolean
  ordering_enabled: boolean
  payment_methods: PaymentMethod[]
  /** Wallet payment arrives in a later update */
  wallet: { eligible: false }
  estimated_delivery_date: string | null
}

/** Header `Idempotency-Key: <uuid>` is mandatory. Totals are always recomputed on the server. */
export interface CreateOrderRequest {
  items: CartLineInput[]
  branch_id?: string
  /** Use a saved address, or send `address` inline */
  address_id?: string
  address?: AddressInput
  payment_method: PaymentMethod
  notes?: string
  /** Bank transfer: slip reference / note typed by the customer */
  payment_reference?: string
  /** Total the customer saw; if it differs from the server total the order is rejected with PRICE_CHANGED */
  expected_total?: number
}

export type OrderStatus =
  | 'pending' | 'confirmed' | 'processing' | 'preparing' | 'ready_for_delivery'
  | 'dispatched' | 'in_transit' | 'delivered' | 'cancelled' | 'returned'

export interface OrderItemDto {
  product_id: string
  variant_id: string | null
  name: string
  variant_name: string | null
  unit: string
  quantity: number
  unit_price: number
  line_total: number
  thumbnail_url: string | null
}

export interface OrderSummaryDto {
  id: string
  order_number: string
  status: OrderStatus
  /** Customer-facing step */
  stage: 'placed' | 'confirmed' | 'packed' | 'out_for_delivery' | 'delivered' | 'cancelled'
  payment_method: PaymentMethod | null
  payment_status: string
  total_amount: number
  item_count: number
  created_at: string
  estimated_delivery_date: string | null
}

export interface OrderDto extends OrderSummaryDto {
  branch_id: string
  branch_name: string | null
  items: OrderItemDto[]
  subtotal: number
  delivery_fee: number
  address: string | null
  notes: string | null
  /** Bank reference the customer typed at checkout (prefills the slip form). */
  payment_reference?: string | null
  needs_call_confirmation: boolean
  can_cancel: boolean
  /** 4-digit code the customer tells the delivery agent. Only the owner sees it. */
  delivery_otp: string | null
  agent: { name: string; phone: string | null; code: string } | null
}
export type CreateOrderResponse = OrderDto
export interface OrdersListResponse {
  items: OrderSummaryDto[]
  next_cursor: string | null
}

export interface TrackingStep {
  key: 'placed' | 'confirmed' | 'packed' | 'out_for_delivery' | 'delivered'
  label: string
  done: boolean
  at: string | null
}
export interface TrackingResponse {
  order_id: string
  order_number: string
  status: OrderStatus
  cancelled: boolean
  steps: TrackingStep[]
  agent: { name: string; phone: string | null; code: string } | null
  estimated_delivery_date: string | null
  delivery_otp: string | null
}
export interface CancelOrderRequest {
  reason?: string
}

// ── Bank slip (POST /orders/{id}/slip is multipart: file `slip`, text `reference?`, `client_event_id`) ──
export interface OrderSlipDto {
  id: string
  order_id: string
  status: 'pending' | 'verified' | 'rejected'
  reject_reason: string | null
  reference: string | null
  created_at: string
}
export interface OrderSlipsResponse {
  items: OrderSlipDto[]
}
