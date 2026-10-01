import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { requireSuperAdmin } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    await pool.query(
      `UPDATE product_key_access_requests
       SET status = 'expired'
       WHERE status IN ('pending','approved') AND expires_at <= NOW()`
    )
    const requestedStatus = String(req.nextUrl.searchParams.get('status') || '').trim()
    const values: unknown[] = []
    const where = requestedStatus && ['pending', 'approved', 'denied', 'consumed', 'expired'].includes(requestedStatus)
      ? (values.push(requestedStatus), 'WHERE r.status = ?')
      : ''
    const { rows } = await pool.query(
      `SELECT r.id, r.company_id, c.name AS company_name,
              r.device_id, r.device_name, r.status, r.attempts,
              r.expires_at, r.approved_at, r.consumed_at,
              r.created_at, r.updated_at, r.approved_by
       FROM product_key_access_requests r
       JOIN companies c ON c.id = r.company_id
       ${where}
       ORDER BY FIELD(r.status, 'pending','approved','denied','consumed','expired'), r.created_at DESC
       LIMIT 100`,
      values
    )
    return NextResponse.json(rows)
  } catch (error) {
    console.error('[superadmin product-key-access GET]', error)
    return NextResponse.json({ error: (error as Error).message || 'Unable to load access requests' }, { status: 500 })
  }
}

