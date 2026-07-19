import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { resolveEntitlements } from '@/lib/entitlements'

export async function GET(req: NextRequest) {
  try {
    const apiKey = req.headers.get('x-api-key')
    if (!apiKey) {
      return NextResponse.json({ error: 'x-api-key header required' }, { status: 401 })
    }

    const { rows } = await pool.query(
      `SELECT c.id as company_id, c.name, c.email, c.phone, c.address,
              c.brand_color, c.brand_logo_url,
              c.status as company_status, c.suspension_reason,
              c.max_users, c.max_branches, c.max_pos_devices,
              s.ends_at as sub_ends_at, s.status as sub_status,
              s.package_id, p.grace_period_days
       FROM companies c
       LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial','grace')
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE c.api_key = ?
       LIMIT 1`,
      [apiKey]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
    }

    const c = rows[0] as Record<string, unknown>
    const subStatus = getSubStatus(
      c.sub_ends_at as string | null,
      Number(c.grace_period_days ?? 7),
      (c.sub_status as string) ?? 'active'
    )

    const entitlements = await resolveEntitlements({ companyId: String(c.company_id) })

    return NextResponse.json({
      company_name:    c.name,
      company_email:   c.email   ?? null,
      company_phone:   c.phone   ?? null,
      company_address: c.address ?? null,
      brand_color:     c.brand_color    ?? null,
      brand_logo_url:  c.brand_logo_url ?? null,
      sub_status:     subStatus,
      sub_ends_at:    c.sub_ends_at    ?? null,
      is_locked:      c.company_status === 'suspended' || c.company_status === 'cancelled',
      lock_reason:    c.company_status === 'cancelled' ? 'cancelled' : (c.company_status === 'suspended' ? 'suspended' : null),
      suspension_reason: c.company_status === 'suspended' ? (c.suspension_reason ?? null) : null,
      max_users:      Number(c.max_users    ?? 10),
      max_branches:   Number(c.max_branches ?? 3),
      modules:        entitlements.enabledModules,
      features:       entitlements.enabledFeatures,
      limits:         entitlements.limits,
      license_id:     entitlements.licenseId,
    })
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}

function getSubStatus(endsAt: string | null, graceDays: number, dbStatus: string): string {
  if (!endsAt) return dbStatus ?? 'active'
  const now = new Date()
  const end = new Date(endsAt)
  const graceEnd = new Date(end.getTime() + graceDays * 86400000)
  if (now < end) return 'active'
  if (now < graceEnd) return 'grace'
  return 'expired'
}
