// Sales force v1.0 contracts (type-only: the app imports them with `import type ... from '@contracts/staff'`).
export type StaffLevel = 'director' | 'agm' | 'manager' | 'zonal_manager' | 'regional_manager' | 'branch_manager' | 'field_officer'
export type VisitOutcome = 'purchased' | 'not_interested' | 'come_back' | 'not_at_home' | 'already_member'

export interface StaffPerformanceDto {
  staff_id: string
  name: string
  code: string | null
  level: StaffLevel
  period: string
  target: number
  target_source: 'own' | 'rollup' | 'none'
  registrations_target: number | null
  sales_net: number
  contributions: number
  achieved: number
  registrations: number
  achievement_pct: number | null
  team_size: number
}

export interface StaffDashboardResponse {
  level: StaffLevel
  period: string
  performance: StaffPerformanceDto
  team_size: number
  visits_today: number
  follow_ups_due: number
}

export interface StaffTeamMemberDto extends StaffPerformanceDto {
  reports_to: string | null
}
export interface StaffTeamResponse {
  period: string
  me: string
  items: StaffTeamMemberDto[]
}

export interface SetTargetRequest {
  period: string
  amount: number
  registrations_target?: number
}

export interface VisitDto {
  id: string
  staff_id: string
  customer_id: string | null
  prospect_name: string | null
  prospect_phone: string | null
  lat: number | null
  lng: number | null
  gps_missing: boolean
  visited_at: string | null
  outcome: VisitOutcome
  reason: string | null
  follow_up_at: string | null
  notes: string | null
  client_event_id: string
}

export interface CreateVisitRequest {
  client_event_id: string
  customer_id?: string
  prospect_name?: string
  prospect_phone?: string
  lat?: number
  lng?: number
  visited_at?: string
  outcome: VisitOutcome
  reason?: string
  follow_up_at?: string
  notes?: string
}
export interface CreateVisitResponse {
  visit: VisitDto
  duplicate: boolean
}
export interface VisitsTodayResponse {
  visits: VisitDto[]
  follow_ups: VisitDto[]
}
export interface VisitReportRowDto {
  staff_id: string
  name: string
  code: string | null
  level: StaffLevel
  total: number
  purchased: number
  not_interested: number
  come_back: number
  not_at_home: number
  already_member: number
  gps_missing: number
  follow_ups_due: number
  follow_ups_done: number
}
export interface VisitReportResponse {
  period: string
  items: VisitReportRowDto[]
}

/** Drill-down for one person inside the caller's scope (own figures, latest rows first). */
export interface StaffDetailSaleDto { invoice_number: string; created_at: string | null; total: number; wallet_part: number; customer_name: string | null }
export interface StaffDetailCollectionDto { id: string; paid_at: string | null; amount: number; status: string; member_name: string | null; receipt_number: string | null }
export interface StaffDetailResponse {
  staff_id: string
  period: string
  performance: StaffPerformanceDto
  sales: StaffDetailSaleDto[]
  collections: StaffDetailCollectionDto[]
  visits: VisitDto[]
}
