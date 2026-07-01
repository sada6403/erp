import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// GET /api/activate/verify?company_key=NP-ERP-XXXX
// Called by POS before activation — returns company info + branches for branch selection
export async function GET(req: NextRequest) {
  try {
    const key = req.nextUrl.searchParams.get('company_key')?.trim()
    if (!key) return NextResponse.json({ error: 'company_key required' }, { status: 400 })

    const { rows } = await pool.query(
      `SELECT c.id, c.name, c.status, c.company_key,
              c.max_pos_devices, c.brand_color, c.brand_logo_url,
              s.ends_at as sub_ends_at, s.status as sub_status,
              p.name as package_name, p.grace_period_days
       FROM companies c
       LEFT JOIN company_subscriptions s ON s.company_id = c.id AND s.status IN ('active','trial','grace')
       LEFT JOIN packages p ON p.id = s.package_id
       WHERE c.company_key = ?
       LIMIT 1`,
      [key]
    )

    if (!rows.length) {
      return NextResponse.json({ error: 'Invalid company key. Please contact your administrator.' }, { status: 404 })
    }

    const c = rows[0] as Record<string, unknown>

    if (c.status === 'suspended') {
      return NextResponse.json({ error: 'Your company account is suspended. Contact your administrator.' }, { status: 403 })
    }
    if (c.status === 'cancelled') {
      return NextResponse.json({ error: 'Your company account has been cancelled.' }, { status: 403 })
    }

    // Check subscription expiry
    const subStatus = getSubStatus(c.sub_ends_at as string | null, Number(c.grace_period_days ?? 7), c.sub_status as string)

    // Count active devices
    let activeDevices = 0
    try {
      const { rows: [dc] } = await pool.query(
        `SELECT COUNT(*) as cnt FROM pos_devices WHERE company_id = ? AND status = 'active'`,
        [c.id]
      )
      activeDevices = Number((dc as Record<string, unknown>).cnt ?? 0)
    } catch { /* table may not exist yet */ }

    const maxDevices = Number(c.max_pos_devices ?? 2)

    // Get branches
    let branches: unknown[] = []
    try {
      const { rows: br } = await pool.query(
        `SELECT id, name, address FROM branches WHERE company_id = ? ORDER BY name`,
        [c.id]
      )
      branches = br
    } catch { /* branches table may not be in saas db */ }

    return NextResponse.json({
      company_id:     c.id,
      company_name:   c.name,
      package_name:   c.package_name ?? 'Standard',
      sub_status:     subStatus,
      sub_ends_at:    c.sub_ends_at,
      brand_color:    c.brand_color ?? null,
      brand_logo_url: c.brand_logo_url ?? null,
      active_devices: activeDevices,
      max_devices:    maxDevices,
      device_slots_left: Math.max(0, maxDevices - activeDevices),
      branches,
    })
  } catch (err) {
    console.error('[activate/verify]', err)
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
