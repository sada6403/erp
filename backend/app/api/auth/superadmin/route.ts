import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'
import { auditLog } from '@/lib/rbac'

function meta(req: NextRequest) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

export async function POST(req: NextRequest) {
  const { email, password } = await req.json()
  if (!email || !password) {
    return NextResponse.json({ error: 'email and password required' }, { status: 400 })
  }

  const { rows } = await pool.query(
    `SELECT * FROM superadmins WHERE email = ? AND is_active = 1`,
    [email.toLowerCase().trim()]
  )
  if (!rows.length) return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })

  const sa = rows[0] as Record<string, string>
  if (!await bcrypt.compare(password, sa.password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await pool.query(`UPDATE superadmins SET last_login_at = NOW() WHERE id = ?`, [sa.id])

  const payload = { sub: sa.id, portal: 'superadmin' as const, company_id: null, name: sa.name, email: sa.email }
  const m = meta(req)
  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, m)

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: sa.id,
    actorName: sa.name, action: 'login', ip: m.ip, userAgent: m.userAgent })

  return NextResponse.json({
    accessToken, refreshToken,
    user: { id: sa.id, name: sa.name, email: sa.email, portal: 'superadmin' },
  })
}
