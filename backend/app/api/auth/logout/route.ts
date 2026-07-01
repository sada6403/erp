import { NextRequest, NextResponse } from 'next/server'
import { authenticate } from '@/lib/rbac'
import { revokeAllTokens } from '@/lib/jwt'

// POST /api/auth/logout — revoke all refresh tokens for this user
export async function POST(req: NextRequest) {
  const auth = authenticate(req)
  if ('error' in auth) return auth.error

  await revokeAllTokens(auth.payload.portal, auth.payload.sub)
  return NextResponse.json({ ok: true })
}
