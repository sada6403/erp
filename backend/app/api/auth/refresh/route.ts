import { NextRequest, NextResponse } from 'next/server'
import { rotateRefreshToken } from '@/lib/jwt'
import { pool } from '@/lib/db'

// POST /api/auth/refresh — rotate refresh token and issue new access token
export async function POST(req: NextRequest) {
  const { refreshToken } = await req.json()
  if (!refreshToken) {
    return NextResponse.json({ error: 'refreshToken required' }, { status: 400 })
  }

  const meta = {
    ip: req.headers.get('x-forwarded-for')?.split(',')[0] ?? undefined,
    userAgent: req.headers.get('user-agent') ?? undefined,
  }

  const result = await rotateRefreshToken(refreshToken, meta)
  if (!result) {
    return NextResponse.json({ error: 'Invalid or expired refresh token' }, { status: 401 })
  }

  // Block token refresh for suspended or cancelled companies
  if (result.payload.company_id && result.payload.portal !== 'superadmin') {
    const { rows } = await pool.query(
      `SELECT status FROM companies WHERE id = ?`,
      [result.payload.company_id]
    )
    const company = rows[0] as Record<string, string> | undefined

    if (!company) {
      return NextResponse.json({ error: 'Company not found', code: 'COMPANY_NOT_FOUND' }, { status: 403 })
    }
    if (company.status === 'suspended') {
      return NextResponse.json({ error: 'Account suspended. Contact your administrator.', code: 'ACCOUNT_SUSPENDED' }, { status: 403 })
    }
    if (company.status === 'cancelled') {
      return NextResponse.json({ error: 'Account cancelled. Contact your service provider.', code: 'ACCOUNT_CANCELLED' }, { status: 403 })
    }
  }

  return NextResponse.json({
    accessToken:  result.accessToken,
    refreshToken: result.refreshToken,
    user: {
      id:         result.payload.sub,
      name:       result.payload.name,
      email:      result.payload.email,
      portal:     result.payload.portal,
      company_id: result.payload.company_id,
      role:       result.payload.role,
      role_id:    result.payload.role_id,
      branch_id:  result.payload.branch_id ?? null,
      sub_branch_id: result.payload.sub_branch_id ?? null,
      scope:      result.payload.scope,
      permissions: result.payload.permissions,
      enabledModules: result.payload.enabledModules ?? [],
      enabledFeatures: result.payload.enabledFeatures ?? [],
      limits:     result.payload.limits ?? {},
      licenseId:  result.payload.licenseId ?? null,
      deviceId:   result.payload.deviceId ?? null,
    },
  })
}
