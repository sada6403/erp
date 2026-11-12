// Called by the POS desktop (Electron main process) with the company sync key (`x-api-key`).
// NOT used by the mobile app.
import type { AppRole } from './common'

export interface InviteTarget {
  /** Exactly one of customer_id / agent_id */
  customer_id?: string
  agent_id?: string
}
export interface InviteRequest {
  targets: InviteTarget[]
  /** Download link to include in the message */
  download_link?: string
  language?: 'en' | 'ta' | 'si'
  /** POS user performing the invite (audit) */
  sent_by?: string
}
export interface InviteResultDto {
  target: InviteTarget
  ok: boolean
  skipped_reason?: 'NO_VALID_PHONE' | 'NOT_FOUND'
  user_id?: string
  name?: string
  /** Normalised 07XXXXXXXX */
  phone?: string
  /** The login ids the person can use */
  login_ids?: string[]
  roles?: AppRole[]
  /** Click-to-chat message text (contains the temporary password; show to staff only) */
  message?: string
  /** https://wa.me/94... link with the message pre-filled */
  whatsapp_url?: string
  dispatch_id?: string
}
export interface InviteResponse {
  results: InviteResultDto[]
  /** 'whatsapp_click' unless the Cloud API flag is on */
  channel: 'whatsapp_click' | 'whatsapp_api'
}

export interface AppAccessRowDto {
  user_id: string
  name: string
  phone: string | null
  member_no: string | null
  agent_code: string | null
  roles: AppRole[]
  status: 'active' | 'locked' | 'disabled'
  must_change_password: boolean
  last_login_at: string | null
  last_dispatch_status: string | null
  last_dispatch_at: string | null
  pending_reset_request_id: string | null
}
export interface AppAccessListResponse {
  items: AppAccessRowDto[]
}
export interface AppAccessStatusRequest {
  user_id: string
  status: 'active' | 'disabled'
}

// ── Join requests: POS review (x-api-key) ──
export interface AdminJoinRequestDto {
  id: string
  source: 'agent' | 'self'
  agent_code: string | null
  agent_name: string | null
  scheme_id: string
  scheme_name: string
  full_name: string
  phone: string
  nic_number: string
  address: string | null
  notes: string | null
  has_nic_front: boolean
  has_nic_back: boolean
  customer_id: string | null
  status: 'pending' | 'approved' | 'rejected'
  reject_reason: string | null
  decided_by: string | null
  decided_at: string | null
  member_id: string | null
  created_at: string
}
export interface AdminJoinRequestsResponse {
  items: AdminJoinRequestDto[]
}
export interface AdminDecisionRequest {
  decision: 'approve' | 'reject'
  /** Required for reject */
  reason?: string
  decided_by?: string
}
export interface AdminJoinDecisionResponse {
  ok: true
  status: 'approved' | 'rejected'
  member_id: string | null
  customer_id: string | null
}

// ── Bank slips: POS verification ──
export interface AdminSlipDto {
  id: string
  order_id: string
  order_number: string
  customer_name: string | null
  order_total: number
  reference: string | null
  status: 'pending' | 'verified' | 'rejected'
  reject_reason: string | null
  reviewed_by: string | null
  reviewed_at: string | null
  created_at: string
}
export interface AdminSlipsResponse {
  items: AdminSlipDto[]
}
export interface AdminSlipDecisionResponse {
  ok: true
  status: 'verified' | 'rejected'
}
