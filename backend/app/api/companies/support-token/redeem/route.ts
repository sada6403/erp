import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, resolveCompany } from '@/lib/auth'
import { pool } from '@/lib/db'
import { auditLog } from '@/lib/rbac'
import { createHash } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Device-facing redemption of a support-access token (Issue 33). Requires
// an online round-trip by design — there is no offline bypass. Returns the
// target Company Admin user's identity only (never a password); the
// Electron device uses this to open a locally-tagged "Support Session"
// against its own already-synced local user row.
export async function POST(request: NextRequest) {
  let company
  try {
    company = await resolveCompany(request)
  } catch (error) {
    if (error instanceof AccountStatusError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }
  if (!company) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  let body: { token?: string; device_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const token = String(body.token || '').trim()
  if (!token) return NextResponse.json({ success: false, error: 'token is required' })

  const tokenHash = createHash('sha256').update(token).digest('hex')
  const { rows } = await pool.query(
    `SELECT id, superadmin_id, superadmin_name, company_id, started_at, expires_at, ended_at FROM support_sessions WHERE token_hash = ?`,
    [tokenHash]
  )
  const session = rows[0] as {
    id: string; superadmin_id: string; superadmin_name: string | null; company_id: string
    started_at: string | null; expires_at: string; ended_at: string | null
  } | undefined

  // Every failure path below returns the same generic message — this token
  // value alone should never let a caller distinguish "wrong token" from
  // "right token, wrong company" from "expired"/"already used".
  const invalid = { success: false, error: 'This support token is invalid, expired, or already used.' }

  if (!session) return NextResponse.json(invalid)
  // Defense-in-depth: even though a token is only ever handed to the one
  // company it was generated for, a token can never be redeemed against a
  // company other than the one its row was scoped to at generation time.
  if (session.company_id !== company.id) return NextResponse.json(invalid)
  if (session.started_at) return NextResponse.json(invalid)
  if (new Date(session.expires_at) <= new Date()) return NextResponse.json(invalid)

  const { rows: adminRows } = await company.tp.query(
    `SELECT u.id, u.name, u.email
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.is_active = 1 AND (r.name = 'Company Admin' OR JSON_UNQUOTE(JSON_EXTRACT(r.permissions, '$.all')) = 'true')
     ORDER BY (r.name = 'Company Admin') DESC, u.created_at ASC
     LIMIT 1`
  )
  const admin = adminRows[0] as { id: string; name: string; email: string } | undefined
  if (!admin) {
    return NextResponse.json({ success: false, error: 'No Company Admin account found for this company.' })
  }

  const deviceId = String(body.device_id || '').trim() || null
  await pool.query(
    `UPDATE support_sessions SET started_at = NOW(), redeemed_device_id = ? WHERE id = ?`,
    [deviceId, session.id]
  )

  await auditLog({
    portal: 'admin', actorType: 'support_session', actorId: session.id, actorName: session.superadmin_name || undefined,
    companyId: company.id, action: 'company.support_token.redeem', resource: 'support_sessions', resourceId: session.id,
    newValues: { superadmin_id: session.superadmin_id, redeemed_device_id: deviceId, admin_user_id: admin.id },
  })

  return NextResponse.json({
    success: true,
    session_id: session.id,
    expires_at: session.expires_at,
    user: { id: admin.id, name: admin.name, email: admin.email },
  })
}
