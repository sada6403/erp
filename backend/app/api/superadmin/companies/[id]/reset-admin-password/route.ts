import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'
import bcrypt from 'bcryptjs'
import { randomBytes } from 'crypto'

type Params = { params: { id: string } }

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(randomBytes(12))
    .map(b => chars[b % chars.length])
    .join('')
}

export async function POST(req: NextRequest, { params }: Params) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const result = await withTenant(params.id, async (client) => {
      // Find the most privileged active user — try Company Admin role first, then any admin perm
      const { rows: adminRows } = await client.query(
        `SELECT u.id, u.name, u.email
         FROM users u
         JOIN roles r ON r.id = u.role_id
         WHERE u.is_active = 1
           AND (
             r.name = 'Company Admin'
             OR JSON_UNQUOTE(JSON_EXTRACT(r.permissions, '$.all')) = 'true'
           )
         ORDER BY r.name = 'Company Admin' DESC
         LIMIT 1`
      )
      if (!adminRows.length) {
        // Fallback: find ANY active user (for companies migrated from local setup)
        const { rows: anyRows } = await client.query(
          `SELECT u.id, u.name, u.email FROM users u WHERE u.is_active = 1 ORDER BY u.created_at ASC LIMIT 1`
        )
        if (!anyRows.length) throw new Error('No active users found for this company. The POS may not have synced yet.')
        adminRows.push(anyRows[0])
      }
      const admin = adminRows[0] as Record<string, string>

      const tempPassword = generateTempPassword()
      const hash = await bcrypt.hash(tempPassword, 10)

      await client.query(
        `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`,
        [hash, admin.id]
      )

      return { tempPassword, adminEmail: admin.email, adminName: admin.name }
    })

    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'company.resetAdminPassword', resource: 'companies', resourceId: params.id,
    })

    return NextResponse.json(result)
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
