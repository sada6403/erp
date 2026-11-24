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
  // In-app updates (additive; all optional for older clients)
  /** Echo of the resolved lookup (?platform=android|ios, ?channel=test|production; defaults android / production). */
  platform?: 'android' | 'ios'
  channel?: 'test' | 'production'
  /** en/ta/si release notes for latest_version; empty strings when not set. */
  release_notes?: { en: string; ta: string; si: string }
  /** Test channel only: https APK URL on an allow-listed host. Always null for production (Play handles it). */
  update_url?: string | null
  /** Lower-case hex sha256 of the APK at update_url; verify before opening the installer. */
  apk_sha256?: string | null
  apk_size_bytes?: number | null
  /** Present only when ?version=<installed app version> was sent: installed < min_app_version. */
  update_required?: boolean
  /** Present only when ?version= was sent: installed < latest_version. */
  update_available?: boolean
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
