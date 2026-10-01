import { NextRequest, NextResponse } from 'next/server'
import { withTransaction } from '@/lib/db'
import { defaultLimiter } from '@/lib/rateLimit'
import {
  hashRequestSecret,
  ProductKeyAccessAuthError,
  requireActivatedDevice,
  verifyApprovalCode,
} from '@/lib/productKeyAccess'

export const runtime = 'nodejs'

type RequestRow = {
  status: string
  code_hash: string | null
  code_salt: string | null
  attempts: number
  expires_at: string
}

export async function POST(req: NextRequest) {
  const limited = defaultLimiter(req)
  if (limited) return limited

  try {
    const { company, deviceId } = await requireActivatedDevice(req)
    const body = await req.json().catch(() => ({})) as {
      request_id?: string; request_secret?: string; code?: string
    }
    const requestId = String(body.request_id || '').trim()
    const secret = String(body.request_secret || '').trim()
    const code = String(body.code || '').trim()
    if (!requestId || !secret || !/^\d{4}$/.test(code)) {
      return NextResponse.json({ error: 'A valid 4-digit approval code is required' }, { status: 400 })
    }

    const result = await withTransaction(async client => {
      const { rows } = await client.query<RequestRow>(
        `SELECT status, code_hash, code_salt, attempts, expires_at
         FROM product_key_access_requests
         WHERE id = ? AND company_id = ? AND device_id = ? AND request_token_hash = ?
         LIMIT 1 FOR UPDATE`,
        [requestId, company.id, deviceId, hashRequestSecret(secret)]
      )
      const request = rows[0]
      if (!request) return { status: 404, body: { success: false, error: 'Access request not found' } }
      if (request.status === 'consumed') return { status: 409, body: { success: false, error: 'This approval code has already been used' } }
      if (request.status === 'denied') return { status: 403, body: { success: false, error: 'This request was denied by Super Admin' } }
      if (request.status !== 'approved') return { status: 409, body: { success: false, error: 'Super Admin approval is still pending' } }
      if (new Date(request.expires_at).getTime() <= Date.now()) {
        await client.query(`UPDATE product_key_access_requests SET status = 'expired' WHERE id = ?`, [requestId])
        return { status: 410, body: { success: false, error: 'The approval code has expired. Send a new request.' } }
      }
      if (Number(request.attempts || 0) >= 5) {
        await client.query(`UPDATE product_key_access_requests SET status = 'expired' WHERE id = ?`, [requestId])
        return { status: 429, body: { success: false, error: 'Too many incorrect attempts. Send a new request.' } }
      }

      const valid = Boolean(request.code_hash && request.code_salt)
        && verifyApprovalCode(code, request.code_salt!, request.code_hash!)
      if (!valid) {
        const attempts = Number(request.attempts || 0) + 1
        await client.query(
          `UPDATE product_key_access_requests
           SET attempts = ?, status = IF(? >= 5, 'expired', status)
           WHERE id = ?`,
          [attempts, attempts, requestId]
        )
        return {
          status: attempts >= 5 ? 429 : 401,
          body: {
            success: false,
            error: attempts >= 5
              ? 'Too many incorrect attempts. Send a new request.'
              : `Incorrect approval code. ${5 - attempts} attempt(s) remaining.`,
          },
        }
      }

      await client.query(
        `UPDATE product_key_access_requests
         SET status = 'consumed', consumed_at = NOW()
         WHERE id = ? AND status = 'approved'`,
        [requestId]
      )
      return { status: 200, body: { success: true, grant_expires_in_seconds: 300 } }
    })

    return NextResponse.json(result.body, { status: result.status })
  } catch (error) {
    if (error instanceof ProductKeyAccessAuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status })
    }
    console.error('[product-key-access verify]', error)
    return NextResponse.json({ error: (error as Error).message || 'Unable to verify approval code' }, { status: 500 })
  }
}

