import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'

type Params = { params: Promise<{ id: string }> }

// Set/change a company's Clear-All-Data password (Issue 29). Super-Admin
// only, by design — an admin who can wipe a company's data must never also
// control the password protecting against it. Write-only: the current hash
// is never read back to the client, matching the portal's own "Change
// Password" pattern (SettingsPage.tsx) rather than the SMTP/SMS masked-
// secret pattern, since a password hash never needs to be reversed for use.
export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json() as { newPassword?: string }
  if (!body.newPassword || body.newPassword.length < 8) {
    return NextResponse.json({ error: 'newPassword must be at least 8 characters' }, { status: 400 })
  }

  const { rows } = await pool.query(`SELECT id, name FROM companies WHERE id = ?`, [companyId])
  const company = rows[0] as Record<string, string> | undefined
  if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const hash = await bcrypt.hash(body.newPassword, 10)
  // Also reset the lockout counters — a superadmin setting a fresh password
  // is a legitimate reason to clear any prior lockout on the old one.
  await pool.query(
    `UPDATE companies SET clear_data_password_hash = ?, clear_data_attempts = 0, clear_data_locked_until = NULL WHERE id = ?`,
    [hash, companyId]
  )

  await auditLog({
    portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub, actorName: auth.payload.name,
    action: 'company.clear_data_password.change', resource: 'companies', resourceId: companyId, companyId,
  })

  return NextResponse.json({ ok: true })
}
