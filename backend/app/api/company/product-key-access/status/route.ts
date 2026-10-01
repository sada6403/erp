import { NextRequest, NextResponse } from 'next/server'
import { pool } from '@/lib/db'
import { syncLimiter } from '@/lib/rateLimit'
import {
  hashRequestSecret,
  ProductKeyAccessAuthError,
  requireActivatedDevice,
} from '@/lib/productKeyAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const limited = syncLimiter(req)
  if (limited) return limited

  try {
    const { company, deviceId } = await requireActivatedDevice(req)
    const requestId = String(req.nextUrl.searchParams.get('request_id') || '').trim()
    const secret = String(req.nextUrl.searchParams.get('request_secret') || '').trim()
    if (!requestId || !secret) {
      return NextResponse.json({ error: 'Request credentials are required' }, { status: 400 })
    }

    const { rows } = await pool.query<{
      status: string; expires_at: string; attempts: number
    }>(
      `SELECT status, expires_at, attempts
       FROM product_key_access_requests
       WHERE id = ? AND company_id = ? AND device_id = ? AND request_token_hash = ?
       LIMIT 1`,
      [requestId, company.id, deviceId, hashRequestSecret(secret)]
    )
    const request = rows[0]
    if (!request) return NextResponse.json({ error: 'Access request not found' }, { status: 404 })

    let status = request.status
    if ((status === 'pending' || status === 'approved') && new Date(request.expires_at).getTime() <= Date.now()) {
      status = 'expired'
      await pool.query(
        `UPDATE product_key_access_requests SET status = 'expired' WHERE id = ? AND status IN ('pending','approved')`,
        [requestId]
      )
    }

    return NextResponse.json({
      status,
      expires_at: request.expires_at,
      attempts_remaining: Math.max(0, 5 - Number(request.attempts || 0)),
    })
  } catch (error) {
    if (error instanceof ProductKeyAccessAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[product-key-access status]', error)
    return NextResponse.json({ error: (error as Error).message || 'Unable to check access request' }, { status: 500 })
  }
}

