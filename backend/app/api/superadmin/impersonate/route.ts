import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { signAccessToken, issueRefreshToken } from '@/lib/jwt'
import { pool } from '@/lib/db'
import { randomUUID } from 'crypto'

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { company_id, reason } = await req.json()
  if (!company_id) return NextResponse.json({ error: 'company_id required' }, { status: 400 })

  const { rows: companies } = await pool.query(
    `SELECT * FROM companies WHERE id = ? AND status NOT IN ('cancelled')`, [company_id]
  )
  if (!companies.length) return NextResponse.json({ error: 'Company not found' }, { status: 404 })
  const company = companies[0] as Record<string, string>

  await pool.query(
    `INSERT INTO support_sessions (id, superadmin_id, company_id, reason) VALUES (?,?,?,?)`,
    [randomUUID(), auth.payload.sub, company_id, reason ?? null]
  )

  const meta = {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }
  const payload = {
    sub: `sa_${auth.payload.sub}`, portal: 'admin' as const, company_id,
    name: `[Support] ${auth.payload.name}`, email: auth.payload.email,
    role: 'Company Admin', permissions: { all: true },
  }

  const accessToken  = signAccessToken(payload)
  const refreshToken = await issueRefreshToken(payload, meta)

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, companyId: company_id,
    action: 'impersonate.start', resource: 'companies', resourceId: company_id,
    newValues: { reason, company_name: company.name } })

  return NextResponse.json({
    accessToken, refreshToken,
    company: { id: company.id, name: company.name, slug: company.slug },
  })
}
