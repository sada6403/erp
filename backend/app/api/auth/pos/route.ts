import { NextRequest, NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { pool, tenantPool } from '@/lib/db'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'

// POST /api/auth/pos
// Called by the Electron POS app when a cashier logs in.
// Auth: x-api-key = company api_key (set in POS Settings → Cloud Sync → API Key)
export async function POST(req: NextRequest) {
  const apiKey = req.headers.get('x-api-key')
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 })
  }

  // Look up company by API key regardless of status so we can give a clear error
  const { rows: compRows } = await pool.query(
    `SELECT id, db_schema, name, slug, status FROM companies WHERE api_key = ?`,
    [apiKey]
  )

  if (!compRows.length) {
    return NextResponse.json({ error: 'Invalid company API key' }, { status: 401 })
  }

  const compRow = compRows[0] as Record<string, string>

  if (compRow.status === 'suspended') {
    return NextResponse.json(
      { error: 'Account suspended. Contact your administrator.', code: 'ACCOUNT_SUSPENDED' },
      { status: 403 }
    )
  }
  if (compRow.status === 'cancelled') {
    return NextResponse.json(
      { error: 'Account cancelled. Contact your service provider.', code: 'ACCOUNT_CANCELLED' },
      { status: 403 }
    )
  }
  if (!['active', 'trial'].includes(compRow.status)) {
    return NextResponse.json(
      { error: 'Account is not active', code: 'ACCOUNT_INACTIVE' },
      { status: 403 }
    )
  }

  const company = {
    id:       compRow.id,
    dbSchema: compRow.db_schema,
    name:     compRow.name,
    slug:     compRow.slug,
    tp:       tenantPool(compRow.db_schema),
  }

  const { email, password, pin } = await req.json()

  if (!email || (!password && !pin)) {
    return NextResponse.json({ error: 'email and password (or pin) required' }, { status: 400 })
  }

  const { rows } = await company.tp.query(
    `SELECT u.*, r.name as role_name, r.permissions, b.name as branch_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     LEFT JOIN branches b ON b.id = u.branch_id
     WHERE u.email = ? AND u.is_active = 1`,
    [email.toLowerCase().trim()]
  )

  if (!rows.length) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  const u = rows[0] as Record<string, unknown>

  let authenticated = false
  if (password) {
    authenticated = await bcrypt.compare(password, u.password_hash as string)
  } else if (pin && u.pin_hash) {
    authenticated = await bcrypt.compare(pin, u.pin_hash as string)
  }

  if (!authenticated) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 })
  }

  await company.tp.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [u.id])

  const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions as string) : u.permissions
  const payload = {
    sub:        u.id as string,
    portal:     'pos' as const,
    company_id: company.id,
    name:       u.name as string,
    email:      u.email as string,
    role:       u.role_name as string,
    permissions: perms as Record<string, unknown>,
  }

  const meta = {
    ip:        req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }

  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, meta)

  return NextResponse.json({
    accessToken,
    refreshToken,
    user: {
      id:          u.id,
      name:        u.name,
      email:       u.email,
      role:        u.role_name,
      branch_name: u.branch_name,
      branch_id:   u.branch_id,
      portal:      'pos',
      company: { id: company.id, name: company.name, slug: company.slug },
    },
  })
}
