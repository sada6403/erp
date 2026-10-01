import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { withTenant } from '@/lib/tenant'
import { sendCompanyOnboardingEmail } from '@/lib/email'
import bcrypt from 'bcryptjs'

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

    if (companyId) {
      const { rows } = await pool.query(
        `SELECT name, email, admin_name, admin_email, company_key, api_key, initial_admin_password FROM companies WHERE id = ?`,
        [companyId]
      )
      const c = rows[0] as Record<string, string> | undefined
      if (c) {
        companyName = companyName || c.name
        adminName   = adminName   || c.admin_name || c.name || 'Admin'
        adminEmail  = adminEmail  || c.admin_email || c.email
        companyKey  = companyKey  || c.company_key
        apiKey      = apiKey      || c.api_key
        if (!adminPassword && c.initial_admin_password) {
          adminPassword = c.initial_admin_password
        }
      }

      // If adminPassword is provided or updated, keep companies and tenant DB user in sync
      if (adminPassword) {
        await pool.query(
          `UPDATE companies SET initial_admin_password = ? WHERE id = ?`,
          [adminPassword, companyId]
        )
        try {
          const hash = await bcrypt.hash(String(adminPassword), 10)
          await withTenant(companyId, async (client) => {
            await client.query(
              `UPDATE users u
               JOIN roles r ON r.id = u.role_id
               SET u.password_hash = ?, u.updated_at = NOW()
               WHERE u.is_active = 1 AND (LOWER(u.email) = ? OR r.name = 'Company Admin')`,
              [hash, String(adminEmail).toLowerCase().trim()]
            )
          })
        } catch (syncErr) {
          console.warn('[send-onboarding] Tenant password sync warning:', syncErr)
        }
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
