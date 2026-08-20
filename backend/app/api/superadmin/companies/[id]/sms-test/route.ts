import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { sendCompanySms } from '@/lib/sms'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { to } = await req.json()
  if (!to) return NextResponse.json({ error: 'to number required' }, { status: 400 })

  const result = await sendCompanySms(companyId, to, 'Test SMS — this company\'s SMS settings are configured correctly.')

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
