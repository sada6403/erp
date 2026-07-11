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
              c.status as company_status,
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

async function getEnabledModules(companyId: string, packageId: string | null): Promise<string[]> {
  const ALL_KEYS = ['pos','inventory','customers','reports_basic','reports_full',
    'installments','multi_branch','purchase_orders','deliveries','expenses','stock_transfers']

  const moduleMap: Record<string, boolean> = {}

  // Package defaults
  if (packageId) {
    try {
      const { rows } = await pool.query(
        `SELECT module_key, is_enabled FROM package_modules WHERE package_id = ?`,
        [packageId]
      )
      for (const m of rows as { module_key: string; is_enabled: number }[]) {
        moduleMap[m.module_key] = Boolean(m.is_enabled)
      }
    } catch { /* table may not exist yet */ }
  }

  // Company-level overrides win
  try {
    const { rows } = await pool.query(
      `SELECT module_key, is_enabled FROM company_modules WHERE company_id = ?`,
      [companyId]
    )
    for (const m of rows as { module_key: string; is_enabled: number }[]) {
      moduleMap[m.module_key] = Boolean(m.is_enabled)
    }
  } catch { /* table may not exist yet */ }

  // If no module info at all, return everything (standard plan assumption)
  if (Object.keys(moduleMap).length === 0) return ALL_KEYS

  return ALL_KEYS.filter(k => moduleMap[k] !== false)
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
