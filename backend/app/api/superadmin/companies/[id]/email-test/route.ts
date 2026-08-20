import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { sendCompanyEmail } from '@/lib/email'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { to } = await req.json()
  if (!to) return NextResponse.json({ error: 'to address required' }, { status: 400 })

  const result = await sendCompanyEmail(companyId, {
    to,
    subject: 'Test Email — Company SMTP Settings',
    html: `
      <div style="font-family:sans-serif;padding:24px;color:#1f2937">
        <h2>✅ Email Test Successful</h2>
        <p>This company's SMTP settings are configured correctly.</p>
        <p style="color:#6b7280;font-size:12px">Sent at ${new Date().toISOString()}</p>
      </div>
    `,
    text: 'Email Test Successful. This company\'s SMTP settings are configured correctly.',
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
