import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, resolveCompany } from '@/lib/auth'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Branding keys a POS device may read/write. Company-wide: set once at the
// main branch, pulled by every activated device during sync.
const BRANDING_KEYS = [
  'company_name', 'company_logo_url', 'login_logo_url', 'pos_bill_logo_url',
  'invoice_logo_url', 'favicon_url', 'brand_color', 'footer_text',
] as const

async function requireCompany(request: NextRequest) {
  try {
    const company = await resolveCompany(request)
    if (!company) {
      return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
    }
    return { company }
  } catch (error) {
    if (error instanceof AccountStatusError) {
      return { error: NextResponse.json({ error: error.message, code: error.code }, { status: 403 }) }
    }
    throw error
  }
}

export async function GET(request: NextRequest) {
  const auth = await requireCompany(request)
  if (auth.error) return auth.error

  const { rows } = await pool.query(
    `SELECT name, brand_color, brand_logo_url, branding_json, updated_at
       FROM companies WHERE id = ? LIMIT 1`,
    [auth.company.id]
  )
  const c = rows[0] as Record<string, unknown> | undefined
  if (!c) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  let branding: Record<string, unknown> = {}
  if (c.branding_json) {
    try { branding = JSON.parse(String(c.branding_json)) as Record<string, unknown> } catch { /* ignore */ }
  }
  // Legacy fallbacks so devices get something even before the first PUT
  if (!branding.company_name)      branding.company_name      = c.name
  if (!branding.brand_color)       branding.brand_color       = c.brand_color ?? null
  if (!branding.company_logo_url)  branding.company_logo_url  = c.brand_logo_url ?? null

  return NextResponse.json({ branding, updated_at: c.updated_at ?? null })
}

export async function PUT(request: NextRequest) {
  const auth = await requireCompany(request)
  if (auth.error) return auth.error

  let body: Record<string, unknown>
  try {
    body = await request.json() as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT branding_json FROM companies WHERE id = ? LIMIT 1`,
    [auth.company.id]
  )
  let branding: Record<string, unknown> = {}
  const existing = (rows[0] as Record<string, unknown> | undefined)?.branding_json
  if (existing) {
    try { branding = JSON.parse(String(existing)) as Record<string, unknown> } catch { /* ignore */ }
  }

  for (const key of BRANDING_KEYS) {
    if (key in body) {
      const value = body[key]
      branding[key] = value === null || value === undefined ? null : String(value)
    }
  }

  // Reject local-only URLs — other devices cannot resolve app-img:// paths
  for (const key of BRANDING_KEYS) {
    if (typeof branding[key] === 'string' && (branding[key] as string).startsWith('app-img://')) {
      return NextResponse.json(
        { error: `${key} must be a public URL (upload the image first)` },
        { status: 400 }
      )
    }
  }

  await pool.query(
    `UPDATE companies
        SET branding_json = ?,
            brand_logo_url = COALESCE(?, brand_logo_url),
            brand_color = COALESCE(?, brand_color)
      WHERE id = ?`,
    [
      JSON.stringify(branding),
      (branding.company_logo_url as string) || null,
      (branding.brand_color as string) || null,
      auth.company.id,
    ]
  )

  return NextResponse.json({ success: true, branding })
}
