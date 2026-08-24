import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, resolveCompany } from '@/lib/auth'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_ATTEMPTS = 5
const LOCKOUT_MINUTES = 15

// Device-facing Clear-All-Data password check (Issue 29). Verification is
// deliberately server-side only — the hash never reaches the device, so a
// stolen/inspected local install can't be brute-forced offline. Always
// responds 200 with {success, error} for normal wrong-password/lockout
// cases (matching this app's pervasive {success,error} shape rather than
// relying on HTTP status for business-logic failures) — a non-2xx here
// means the device itself couldn't be identified/authenticated at all.
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

  let body: { password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.password) return NextResponse.json({ error: 'password is required' }, { status: 400 })

  const { rows } = await pool.query(
    `SELECT clear_data_password_hash, clear_data_attempts, clear_data_locked_until FROM companies WHERE id = ?`,
    [company.id]
  )
  const c = rows[0] as { clear_data_password_hash: string | null; clear_data_attempts: number; clear_data_locked_until: string | null } | undefined
  if (!c?.clear_data_password_hash) {
    return NextResponse.json({ success: false, error: 'Clear-data password not configured for this company — contact support' })
  }

  if (c.clear_data_locked_until && new Date(c.clear_data_locked_until) > new Date()) {
    const minutesLeft = Math.ceil((new Date(c.clear_data_locked_until).getTime() - Date.now()) / 60000)
    return NextResponse.json({ success: false, error: `Too many failed attempts. Try again in ${minutesLeft} minute(s).` })
  }

  const valid = await bcrypt.compare(body.password, c.clear_data_password_hash)
  if (!valid) {
    const attempts = (c.clear_data_attempts || 0) + 1
    const locked = attempts >= MAX_ATTEMPTS
    await pool.query(
      `UPDATE companies SET clear_data_attempts = ?, clear_data_locked_until = ? WHERE id = ?`,
      [locked ? 0 : attempts, locked ? new Date(Date.now() + LOCKOUT_MINUTES * 60000) : null, company.id]
    )
    return NextResponse.json({
      success: false,
      error: locked
        ? `Too many failed attempts. Try again in ${LOCKOUT_MINUTES} minute(s).`
        : `Incorrect password. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
    })
  }

  await pool.query(`UPDATE companies SET clear_data_attempts = 0, clear_data_locked_until = NULL WHERE id = ?`, [company.id])
  return NextResponse.json({ success: true })
}
