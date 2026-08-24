import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { randomBytes, randomUUID, createHash } from 'crypto'

type Params = { params: Promise<{ id: string }> }

const DEFAULT_DURATION_MINUTES = 15
const MAX_DURATION_MINUTES = 30 * 24 * 60 // 30 days

// Generates a per-company, single-use, time-boxed emergency support access
// token (Issue 33). Deliberately not a shared/reusable credential of any
// kind: every call mints a fresh CSPRNG value, stores only its sha256 hash,
// and scopes the row to exactly this company_id — see
// backend/app/api/companies/support-token/redeem/route.ts for the
// company-boundary check on the redeeming side.
export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({})) as { reason?: string; duration_minutes?: number }
  const reason = String(body.reason || '').trim()
  if (!reason) {
    return NextResponse.json({ error: 'A reason is required to generate support access' }, { status: 400 })
  }

  const requestedMinutes = Number(body.duration_minutes) || DEFAULT_DURATION_MINUTES
  const durationMinutes = Math.min(Math.max(requestedMinutes, 1), MAX_DURATION_MINUTES)

  const { rows } = await pool.query(`SELECT id, name FROM companies WHERE id = ?`, [companyId])
  const company = rows[0] as Record<string, string> | undefined
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const token = randomBytes(32).toString('base64url')
  const tokenHash = createHash('sha256').update(token).digest('hex')
  const id = randomUUID()
  const createdAt = new Date()
  const expiresAt = new Date(createdAt.getTime() + durationMinutes * 60_000)

  await pool.query(
    `INSERT INTO support_sessions (id, superadmin_id, superadmin_name, company_id, reason, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, auth.payload.sub, auth.payload.name || null, companyId, reason, tokenHash, createdAt, expiresAt]
  )

  await auditLog({
    portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub, actorName: auth.payload.name,
    action: 'company.support_token.generate', resource: 'support_sessions', resourceId: id, companyId,
    newValues: { reason, duration_minutes: durationMinutes, expires_at: expiresAt.toISOString() },
  })

  // The token itself is returned exactly once — only its hash is ever
  // persisted, so this response is the only time it will be visible again.
  return NextResponse.json({ token, session_id: id, expires_at: expiresAt.toISOString() })
}
