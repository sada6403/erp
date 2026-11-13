/** Smart Buy cash collection by agents. Type-only (the app imports it with `import type`). */

export type CollectionStatus = 'pending_verification' | 'approved' | 'rejected'

/** What one member owes right now. Display only: the POS recomputes at approval and stays the authority. */
export interface MemberDueDto {
  cycle_no: number
  due_date: string
  installment_amount: number
  /** Approved cash + credit already counted for this cycle */
  settled: number
  /** Collected by an agent and waiting for the branch to verify */
  pending_amount: number
  /** What is still owed for this cycle after approved payments */
  balance_due: number
  late_fee: number
  is_late: boolean
  /** Most an agent may collect now (balance + late fee, minus what is already pending) */
  collectable: number
  /** Unpaid balance of earlier cycles */
  arrears: number
  last_payment_at: string | null
  last_payment_amount: number | null
  frequency: 'weekly' | 'monthly'
}

export interface CollectionDto {
  id: string
  receipt_number: string
  member_id: string
  customer_name: string
  scheme_id: string
  scheme_name: string
  cycle_no: number | null
  amount: number
  late_fee_applied: number
  status: CollectionStatus
  rejected_reason: string | null
  collected_at: string
  agent_code: string | null
  agent_name: string | null
  /** Cycle balance still owed after this payment (approved + pending counted) */
  balance_after: number
}

export interface CreateCollectionRequest {
  /** Also the id of the chit_contributions row: a replay returns the stored row */
  client_event_id: string
  member_id: string
  amount: number
  /** e.g. AG001-000123; unique per agent */
  receipt_number: string
  collected_at: string
  notes?: string
}
export interface CreateCollectionResponse {
  collection: CollectionDto
  duplicate: boolean
}

export interface CollectionsTodayResponse {
  items: CollectionDto[]
  summary: {
    count: number
    total: number
    pending_total: number
    approved_total: number
    rejected_total: number
    /** Cash the agent still holds: collected (not rejected) minus handed over to the branch */
    cash_in_hand: number
    /** Collected but not yet verified by the branch */
    pending_remittance: number
  }
  /** Highest receipt sequence already used by this agent (the app continues from it) */
  last_receipt_seq: number
}

export interface ReceiptDto extends CollectionDto {
  company_name: string
  branch_name: string | null
  scheme_number: string | null
}
