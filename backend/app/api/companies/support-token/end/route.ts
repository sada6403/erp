import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, resolveCompany } from '@/lib/auth'
import { pool } from '@/lib/db'
import { auditLog } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Ends an active support session (Issue 33) — called on manual "End Support
// Session", on local-expiry detection, and best-effort on logout. Idempotent:
// ending an already-ended (or never-redeemed) session is a no-op success.
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

  let body: { session_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  const sessionId = String(body.session_id || '').trim()
  if (!sessionId) return NextResponse.json({ success: false, error: 'session_id is required' })

  const { rows } = await pool.query(
    `SELECT id, superadmin_id, superadmin_name, company_id, ended_at FROM support_sessions WHERE id = ? AND company_id = ?`,
    [sessionId, company.id]
  )
  const session = rows[0] as { id: string; superadmin_id: string; superadmin_name: string | null; company_id: string; ended_at: string | null } | undefined
  if (!session) return NextResponse.json({ success: false, error: 'Session not found' })

  if (!session.ended_at) {
    await pool.query(`UPDATE support_sessions SET ended_at = NOW() WHERE id = ?`, [sessionId])
    await auditLog({
      portal: 'admin', actorType: 'support_session', actorId: sessionId, actorName: session.superadmin_name || undefined,
      companyId: company.id, action: 'company.support_token.session_end', resource: 'support_sessions', resourceId: sessionId,
      newValues: { superadmin_id: session.superadmin_id },
    })
  }

  return NextResponse.json({ success: true })
}
