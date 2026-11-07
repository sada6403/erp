/**
 * Mobile-only types for things the shared contracts (backend/lib/app/contracts) do not describe yet.
 * Everything here is optional on the wire: the UI renders these parts only when the server sends them,
 * so production never shows invented data. Move into contracts when workstream A adds them.
 */

/** GET /agent/deliveries/:id/bill (no contract type yet; shape confirmed in ARCHITECTURE section 6.3). */
export interface AgentBillDto {
  bill_no: string;
  order_number: string;
  date: string;
  company_name: string;
  branch_name: string | null;
  branch_phone: string | null;
  agent_name: string;
  agent_code: string;
  customer_name: string;
  address: string | null;
  lines: Array<{ name: string; quantity: number; unit: string; unit_price: number; line_total: number }>;
  subtotal: number;
  discount: number;
  delivery_fee: number;
  total: number;
  payment_label: string;
  /** Printed on the receipt after completion. */
  otp: string | null;
  paid_in_full: boolean;
}

/** Optional motivation block on the agent dashboard (rank, tier, goal, badges). Not in v1.0 contracts. */
export interface AgentDashboardExtras {
  rank_label?: string | null;
  tier?: string | null;
  rating?: number | null;
  review_count?: number | null;
  families_served?: number | null;
  on_time_pct?: number | null;
  on_duty?: boolean | null;
  branch_name?: string | null;
  goal?: { title: string; subtitle: string; target: number; earned: number } | null;
  incentive_banner?: string | null;
  badges?: string[] | null;
}

/** Salted delivery OTP hash ("salt$sha256hex") the agent app can verify offline. Not in contracts yet. */
export interface DeliveryOfflineOtp {
  delivery_otp_hash?: string | null;
}

/** Local queued-state helper for the agent list. */
export type DeliveryLocalState = 'queued_complete' | 'queued_status' | null;
