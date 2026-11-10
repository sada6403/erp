// One place that reads the company profile for the app API, receipts, notifications and the public legal pages.
// Source of truth: POS Settings -> company details -> synced to companies.branding_json (PUT /api/company/branding).
import { pool } from '@/lib/db'
import { toIso } from '@/lib/app/http'
import type { CompanyProfileResponse } from '@/lib/app/contracts/company'

type Row = Record<string, unknown>
const str = (v: unknown): string | null => {
  const s = typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim()
  return s || null
}

export function profileFromRow(c: Row, origin: string): CompanyProfileResponse {
  let b: Row = {}
  try { b = c.branding_json ? JSON.parse(String(c.branding_json)) as Row : {} } catch { /* ignore */ }
  const name = str(b.company_name) ?? str(c.name) ?? ''
  const phone = str(b.company_phone)
  const email = str(b.company_email)
  const legal = str(b.company_legal_name)
  const supportEmail = str(b.support_email) ?? email
  const supportPhone = str(b.support_phone) ?? phone
  const address = str(b.company_address)
  const slug = str(c.slug)
  const q = slug ? `?c=${encodeURIComponent(slug)}` : ''
  const missing: string[] = []
  if (!legal) missing.push('company_legal_name')
  if (!address) missing.push('company_address')
  if (!supportEmail) missing.push('support_email')
  if (!supportPhone) missing.push('support_phone')
  return {
    name, legal_name: legal ?? name, address, phone, email,
    support_email: supportEmail, support_phone: supportPhone,
    website: str(b.company_website), tin: str(b.company_tin),
    logo_url: str(b.company_logo_url) ?? str(c.brand_logo_url),
    invoice_note: str(b.invoice_note),
    privacy_url: `${origin}/legal/privacy${q}`,
    delete_account_url: `${origin}/legal/delete-account${q}`,
    missing, updated_at: toIso(c.updated_at),
  }
}

export async function loadCompanyProfile(companyId: string, origin: string): Promise<CompanyProfileResponse | null> {
  const { rows } = await pool.query(
    `SELECT name, slug, brand_logo_url, branding_json, updated_at FROM companies WHERE id = ? LIMIT 1`, [companyId])
  return rows[0] ? profileFromRow(rows[0] as Row, origin) : null
}

/** Public legal pages: ?c=<slug>, or the only active company when the deployment has exactly one. */
export async function loadCompanyProfileForLegal(slug: string | null, origin: string): Promise<CompanyProfileResponse | null> {
  const { rows } = slug
    ? await pool.query(`SELECT name, slug, brand_logo_url, branding_json, updated_at FROM companies WHERE slug = ? AND status IN ('active','trial') LIMIT 2`, [slug])
    : await pool.query(`SELECT name, slug, brand_logo_url, branding_json, updated_at FROM companies WHERE status IN ('active','trial') LIMIT 2`)
  if (rows.length !== 1) return null
  return profileFromRow(rows[0] as Row, origin)
}
