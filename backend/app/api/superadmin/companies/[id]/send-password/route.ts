import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { sendAdminPasswordEmail } from '@/lib/email'

type Params = { params: Promise<{ id: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const body = await req.json().catch(() => ({})) as { password?: string; email?: string; isReset?: boolean }
    const { rows } = await pool.query(
      `SELECT name, email, admin_email, admin_name, company_key, initial_admin_password FROM companies WHERE id = ?`,
      [companyId]
    )
    const company = rows[0] as Record<string, string> | undefined
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    const targetEmail = body.email ? String(body.email).toLowerCase().trim() : (company.admin_email || company.email || '').toLowerCase().trim()
    const password = body.password ? String(body.password).trim() : (company.initial_admin_password || '').trim()

    if (!targetEmail) {
      return NextResponse.json({ error: 'Admin email is required' }, { status: 400 })
    }
    if (!password) {
      return NextResponse.json({ error: 'No password recorded for this company. Please reset password to set a new one.' }, { status: 400 })
    }

    const emailRes = await sendAdminPasswordEmail({
      companyName: company.name,
      adminEmail: targetEmail,
      adminName: company.admin_name || company.name,
      password,
      isReset: Boolean(body.isReset),
      companyKey: company.company_key,
    })

    if (!emailRes.ok) {
      return NextResponse.json({ error: emailRes.error || 'Failed to send password email' }, { status: 500 })
    }

    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'company.sendPasswordEmail', resource: 'companies', resourceId: companyId, companyId,
      newValues: { to: targetEmail, isReset: Boolean(body.isReset) },
    })

    return NextResponse.json({ ok: true, message: `Password sent successfully to ${targetEmail}` })
  } catch (err) {
    console.error('[send-password]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
