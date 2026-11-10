/** Public company profile (no login). Source: POS company settings, synced to companies.branding_json. */
export interface CompanyProfileResponse {
  name: string
  legal_name: string
  address: string | null
  phone: string | null
  email: string | null
  support_email: string | null
  support_phone: string | null
  website: string | null
  /** TIN / registration number */
  tin: string | null
  logo_url: string | null
  invoice_note: string | null
  /** Public pages served by the backend from the same data. */
  privacy_url: string
  delete_account_url: string
  /** Fields the company still has to fill in POS Settings (needed for the Play listing pages). */
  missing: string[]
  updated_at: string | null
}
