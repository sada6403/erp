import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import { withTenant } from '@/lib/tenant'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'
import { auditLog } from '@/lib/rbac'
import { authLimiter } from '@/lib/rateLimit'

function meta(req: NextRequest) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

export async function POST(req: NextRequest) {
  const limited = authLimiter(req)
  if (limited) return limited

  const { email, password, company_slug } = await req.json()
  if (!email || !password || !company_slug) {
    return NextResponse.json({ error: 'email, password and company_slug required' }, { status: 400 })
  }

  const { rows: companies } = await pool.query(
    `SELECT id, name, db_schema, status FROM companies WHERE slug = ?`,
    [company_slug.toLowerCase().trim()]
  )
  if (!companies.length) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

  const company = companies[0] as Record<string, string>
  if (company.status === 'suspended') return NextResponse.json({ error: 'Account suspended' }, { status: 403 })
  if (company.status === 'cancelled') return NextResponse.json({ error: 'Account cancelled' }, { status: 403 })

  let user: Record<string, unknown> | null = null
  await withTenant(company.id, async (client) => {
    const { rows } = await client.query(
      `SELECT u.*, r.name as role_name, r.permissions
       FROM users u JOIN roles r ON r.id = u.role_id
       WHERE u.email = ? AND u.is_active = 1
         AND (JSON_EXTRACT(r.permissions,'$.all') = true OR r.name IN ('Company Admin','Branch Manager'))`,
      [email.toLowerCase().trim()]
    )
    user = rows[0] ?? null
  })

  if (!user) return NextResponse.json({ error: 'Invalid credentials or insufficient role' }, { status: 401 })
  if (!await bcrypt.compare(password, (user as Record<string,string>).password_hash)) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await withTenant(company.id, async (client) => {
    await client.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [(user as Record<string,string>).id])
  })

  const u = user as Record<string, unknown>
  const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions as string) : u.permissions
  const payload = {
    sub: u.id as string, portal: 'admin' as const, company_id: company.id,
    name: u.name as string, email: u.email as string,
    role: u.role_name as string, permissions: perms as Record<string, unknown>,
  }

  const m = meta(req)
  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, m)

  await auditLog({ portal: 'admin', actorType: 'admin_user', actorId: u.id as string,
    actorName: u.name as string, companyId: company.id, action: 'login', ip: m.ip, userAgent: m.userAgent })

  return NextResponse.json({
    accessToken, refreshToken,
    user: { id: u.id, name: u.name, email: u.email, role: u.role_name, portal: 'admin',
            company: { id: company.id, name: company.name, slug: company_slug } },
  })
}
