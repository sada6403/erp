import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { pool } from '@/lib/db'
import { defaultLimiter } from '@/lib/rateLimit'
import {
  createRequestSecret,
  ProductKeyAccessAuthError,
  requestExpiry,
  requireActivatedDevice,
} from '@/lib/productKeyAccess'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  const limited = defaultLimiter(req)
  if (limited) return limited

  try {
    const { company, device, deviceId } = await requireActivatedDevice(req)
    const body = await req.json().catch(() => ({})) as { device_name?: string }
    const deviceName = String(body.device_name || '').trim().slice(0, 128) || 'POS Device'
    const id = randomUUID()
    const token = createRequestSecret()
    const expiresAt = requestExpiry()

    // A device needs only one live request. Expire older requests before
    // minting a new secret so an abandoned popup cannot later be approved.
    await pool.query(
      `UPDATE product_key_access_requests
       SET status = 'expired'
       WHERE company_id = ? AND device_id = ? AND status IN ('pending','approved')`,
      [company.id, deviceId]
    )
    await pool.query(
      `INSERT INTO product_key_access_requests
         (id, company_id, device_row_id, device_id, device_name,
          request_token_hash, status, attempts, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?)`,
      [id, company.id, device.id, deviceId, deviceName, token.hash, expiresAt]
    )

    return NextResponse.json({
      request_id: id,
      request_secret: token.secret,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
    }, { status: 201 })
  } catch (error) {
    if (error instanceof ProductKeyAccessAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[product-key-access request]', error)
    return NextResponse.json({ error: (error as Error).message || 'Unable to create access request' }, { status: 500 })
  }
}

