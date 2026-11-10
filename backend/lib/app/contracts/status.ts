export interface StatusResponse {
  ordering_enabled: boolean
  maintenance_message: string | null
  min_app_version: string
  latest_version: string
  latest_version_critical: boolean
  apk_url: string | null
  server_time: string
  company: { name: string; currency: 'LKR' }
  /** Modules the company has enabled; hide Smart Buy / Installments UI when false. */
  modules: { smartbuy: boolean; installments: boolean }
  delivery: { flat_fee: number; free_over: number | null }
  bank_transfer: { enabled: boolean; instructions: string | null }
}

/** Per-area MAX(updated_at); null when the area is empty. Poll and invalidate changed keys only. */
export interface WatermarkResponse {
  server_time: string
  areas: {
    catalog: string | null
    categories: string | null
    banners: string | null
    settings: string | null
    /** Company profile (POS Settings) last changed */
    company: string | null
    /** Present only with a valid token */
    orders?: string | null
    notifications?: string | null
    deliveries?: string | null
  }
}
