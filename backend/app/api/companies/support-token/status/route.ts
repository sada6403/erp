import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, resolveCompany } from '@/lib/auth'
import { pool } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight server-side kill-switch check (Issue 33) — polled from the
// device's existing sync loop while a support session is active, so an
// ended/expired session is force-logged-out even if the device's own local
// clock has been tampered with.
export async function GET(request: NextRequest) {
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

  const sessionId = String(request.nextUrl.searchParams.get('session_id') || '').trim()
  if (!sessionId) return NextResponse.json({ active: false })

  const { rows } = await pool.query(
    `SELECT started_at, ended_at, expires_at FROM support_sessions WHERE id = ? AND company_id = ?`,
    [sessionId, company.id]
  )
  const session = rows[0] as { started_at: string | null; ended_at: string | null; expires_at: string } | undefined
  const active = Boolean(session && session.started_at && !session.ended_at && new Date(session.expires_at) > new Date())

  return NextResponse.json({ active })
}
