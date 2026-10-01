import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { sendCompanyOnboardingEmail } from '@/lib/email'

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const body = await req.json()
    let {
      companyId,
      companyName,
      adminName,
      adminEmail,
      adminPassword,
      companyKey,
      apiKey,
      downloadUrl,
      serverUrl,
    } = body

    if (companyId && (!companyName || !companyKey || !apiKey || !adminEmail)) {
      const { rows } = await pool.query(
        `SELECT name, email, admin_name, admin_email, company_key, api_key FROM companies WHERE id = ?`,
        [companyId]
      )
      const c = rows[0] as Record<string, string> | undefined
      if (c) {
        companyName = companyName || c.name
        adminName   = adminName   || c.admin_name || c.name || 'Admin'
        adminEmail  = adminEmail  || c.admin_email || c.email
        companyKey  = companyKey  || c.company_key
        apiKey      = apiKey      || c.api_key
      }
    }

    if (!adminEmail) {
      return NextResponse.json({ error: 'Recipient adminEmail is required' }, { status: 400 })
    }

    const emailRes = await sendCompanyOnboardingEmail({
      companyName: companyName || 'Company',
      adminName: adminName || 'Admin',
      adminEmail,
      adminPassword: adminPassword || undefined,
      companyKey: companyKey || '',
      apiKey: apiKey || '',
      downloadUrl: downloadUrl || `${process.env.PUBLIC_BASE_URL || 'http://72.61.115.222'}/download`,
      serverUrl: serverUrl || `${process.env.PUBLIC_BASE_URL || 'http://72.61.115.222'}:4001`,
    })

    if (!emailRes.ok) {
      return NextResponse.json({ error: emailRes.error || 'Failed to send email' }, { status: 500 })
    }

    if (companyId) {
      await auditLog({
        portal: 'superadmin',
        actorType: 'superadmin',
        actorId: auth.payload.sub,
        actorName: auth.payload.name,
        action: 'company.sendOnboardingEmail',
        resource: 'companies',
        resourceId: companyId,
        companyId,
        newValues: { to: adminEmail },
      })
    }

    return NextResponse.json({ ok: true, message: 'Onboarding email sent successfully' })
  } catch (err) {
    console.error('[send-onboarding error]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
