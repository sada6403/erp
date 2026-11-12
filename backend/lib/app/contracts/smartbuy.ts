export interface OpenSchemeDto {
  id: string
  name: string
  contribution_amount: number
  frequency: 'weekly' | 'monthly'
  cycle_count: number
  chit_value: number
  member_count: number
  status: string
}
export interface OpenSchemesResponse {
  items: OpenSchemeDto[]
}

export interface MySchemeDto {
  member_id: string
  scheme_id: string
  scheme_number: string | null
  name: string
  frequency: 'weekly' | 'monthly'
  contribution_amount: number
  chit_value: number
  cycle_count: number
  cycles_paid: number
  contributions_paid: number
  next_draw_date: string | null
  status: string
  /** Display label only, e.g. "Active" (never "Paid") */
  badge: string
  won_cycle_no: number | null
  agent_name: string | null
}
export interface MySchemesResponse {
  items: MySchemeDto[]
}

export interface StatementRowDto {
  id: string
  cycle_no: number | null
  amount: number
  method: string
  receipt_number: string | null
  status: string
  paid_at: string
}
export interface StatementResponse {
  scheme_id: string
  scheme_name: string
  total_paid: number
  rows: StatementRowDto[]
}

export interface DrawDto {
  id: string
  cycle_no: number
  draw_date: string
  method: string
  /** Other members' names are masked, e.g. "K. Ra... - Member #12" */
  winner_label: string | null
  is_me: boolean
  /** Draw proof video arrives in a later update */
  has_video: false
}
export interface DrawsResponse {
  scheme_id: string
  items: DrawDto[]
}

export interface WalletResponse {
  balance: number
  currency: 'LKR'
}
export interface WalletTransactionDto {
  id: string
  type: string
  amount: number
  balance_after: number
  source: string | null
  created_at: string
}
export interface WalletTransactionsResponse {
  items: WalletTransactionDto[]
}

// ── Join requests (agent initiated now, customer self join later; same flow) ──
export type JoinRequestStatus = 'pending' | 'approved' | 'rejected'
export interface JoinRequestDto {
  id: string
  source: 'agent' | 'self'
  scheme_id: string
  scheme_name: string
  full_name: string
  phone_masked: string | null
  status: JoinRequestStatus
  /** Only when rejected */
  reject_reason: string | null
  created_at: string
  decided_at: string | null
}
export interface JoinRequestsResponse {
  items: JoinRequestDto[]
  next_cursor: string | null
}
/** POST /smartbuy/join-requests is multipart/form-data: these text fields + files `nic_front` and `nic_back`. */
export interface JoinRequestFields {
  scheme_id: string
  full_name: string
  phone: string
  nic_number: string
  address?: string
  notes?: string
  /** Idempotency key; the same id returns the original request */
  client_event_id: string
}
