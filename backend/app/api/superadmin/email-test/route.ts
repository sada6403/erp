import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { sendEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { to } = await req.json()
  if (!to) return NextResponse.json({ error: 'to address required' }, { status: 400 })

  const result = await sendEmail({
    to,
    subject: 'Test Email from POS ERP SuperAdmin',
    html: `
      <div style="font-family:sans-serif;padding:24px;color:#1f2937">
        <h2>✅ Email Test Successful</h2>
        <p>This is a test email from your POS ERP platform.</p>
        <p>If you received this, your SMTP settings are configured correctly.</p>
        <p style="color:#6b7280;font-size:12px">Sent at ${new Date().toISOString()}</p>
      </div>
    `,
    text: 'Email Test Successful. Your SMTP settings are working correctly.',
  })

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 500 })
  return NextResponse.json({ ok: true })
}
