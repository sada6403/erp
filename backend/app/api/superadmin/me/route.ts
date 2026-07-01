import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT id, name, email, last_login_at, created_at FROM superadmins WHERE id = ?`,
    [auth.payload.sub]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json() as {
    name?: string; email?: string
    currentPassword?: string; newPassword?: string
  }

  const { rows } = await pool.query(
    `SELECT * FROM superadmins WHERE id = ?`,
    [auth.payload.sub]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  const sa = rows[0] as Record<string, string>

  // ── Password change ───────────────────────────────────────────────────────
  if (body.currentPassword && body.newPassword) {
    if (!await bcrypt.compare(body.currentPassword, sa.password_hash)) {
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }
    if (body.newPassword.length < 8) {
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 400 })
    }
    const hash = await bcrypt.hash(body.newPassword, 10)
    await pool.query(`UPDATE superadmins SET password_hash = ?, updated_at = NOW() WHERE id = ?`, [hash, sa.id])
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: sa.id, actorName: sa.name, action: 'password.change' })
    return NextResponse.json({ ok: true })
  }

  // ── Profile update ────────────────────────────────────────────────────────
  const sets: string[] = []
  const vals: unknown[] = []
  if (body.name?.trim()) { sets.push('name = ?'); vals.push(body.name.trim()) }
  if (body.email?.trim()) { sets.push('email = ?'); vals.push(body.email.trim().toLowerCase()) }
  if (!sets.length) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })

  vals.push(sa.id)
  await pool.query(`UPDATE superadmins SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, vals)
  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: sa.id, actorName: sa.name, action: 'profile.update', newValues: { name: body.name, email: body.email } })
  return NextResponse.json({ ok: true })
}
