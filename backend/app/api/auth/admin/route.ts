import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool } from '@/lib/db'
import { withTenant } from '@/lib/tenant'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'
import { auditLog } from '@/lib/rbac'
import { authLimiter } from '@/lib/rateLimit'
import { resolveEntitlements } from '@/lib/entitlements'

function meta(req: NextRequest) {
  return {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
}

function parsePermissions(value: unknown): Record<string, boolean> {
  if (!value) return {}
  if (typeof value === 'string') {
    try { return JSON.parse(value) as Record<string, boolean> } catch { return {} }
  }
  return value as Record<string, boolean>
}

function resolveScope(roleName: string, branchId: string | null) {
  const normalized = roleName.trim().toLowerCase()
  if (normalized === 'company admin' || normalized === 'owner' || normalized === 'super admin') {
    return { portal: 'admin' as const, scope: { level: 'owner' as const, branchId: null, subBranchId: null } }
  }
  if (normalized === 'branch manager') {
    if (!branchId) throw new Error('Branch Manager account must be assigned to a branch before login')
    return { portal: 'admin' as const, scope: { level: 'branch' as const, branchId, subBranchId: null } }
  }
  throw new Error('This account cannot use the admin portal')
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
  const perms = parsePermissions(u.permissions)
  const { portal, scope } = resolveScope(String(u.role_name || ''), u.branch_id ? String(u.branch_id) : null)
  const entitlements = await resolveEntitlements({ companyId: company.id, roleName: String(u.role_name || ''), branchId: u.branch_id ? String(u.branch_id) : null })
  const payload = {
    sub: u.id as string, portal,
    company_id: company.id,
    name: u.name as string, email: u.email as string,
    role: u.role_name as string,
    role_id: u.role_id ? String(u.role_id) : undefined,
    branch_id: scope.branchId,
    sub_branch_id: null,
    scope,
    permissions: perms as Record<string, unknown>,
    enabledModules: entitlements.enabledModules,
    enabledFeatures: entitlements.enabledFeatures,
    limits: entitlements.limits,
    licenseId: entitlements.licenseId,
    deviceId: entitlements.deviceId,
  }

  const m = meta(req)
  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, m)

  await auditLog({ portal: 'admin', actorType: 'admin_user', actorId: u.id as string,
    actorName: u.name as string, companyId: company.id, action: 'login', ip: m.ip, userAgent: m.userAgent })

  return NextResponse.json({
    accessToken, refreshToken,
    user: {
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role_name,
      role_id: u.role_id ?? null,
      portal,
      company: { id: company.id, name: company.name, slug: company_slug },
      company_id: company.id,
      branch_id: null,
      sub_branch_id: null,
      scope,
      permissions: perms,
      enabledModules: entitlements.enabledModules,
      enabledFeatures: entitlements.enabledFeatures,
      limits: entitlements.limits,
      licenseId: entitlements.licenseId,
      deviceId: entitlements.deviceId,
    },
  })
}
