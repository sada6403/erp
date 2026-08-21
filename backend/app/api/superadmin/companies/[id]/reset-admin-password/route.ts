import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'
import { pool } from '@/lib/db'
import bcrypt from 'bcryptjs'
import { randomBytes, randomUUID } from 'crypto'

type Params = { params: Promise<{ id: string }> }

function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$'
  return Array.from(randomBytes(12))
    .map(b => chars[b % chars.length])
    .join('')
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const { rows: companyRows } = await pool.query(
      `SELECT name, email, admin_email, admin_name FROM companies WHERE id = ?`,
      [companyId]
    )
    const company = companyRows[0] as Record<string, string> | undefined
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    const tempPassword = generateTempPassword()
    const hash = await bcrypt.hash(tempPassword, 10)

    const result = await withTenant(companyId, async (client) => {
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

      let admin: { id?: string; name: string; email: string }

      if (adminRows.length) {
        admin = adminRows[0] as { id: string; name: string; email: string }
        await client.query(
          `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`,
          [hash, admin.id]
        )
      } else {
        // Fallback 1: find ANY active user (for companies migrated from local setup)
        const { rows: anyRows } = await client.query(
          `SELECT u.id, u.name, u.email FROM users u WHERE u.is_active = 1 ORDER BY u.created_at ASC LIMIT 1`
        )
        if (anyRows.length) {
          admin = anyRows[0] as { id: string; name: string; email: string }
          await client.query(
            `UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?`,
            [hash, admin.id]
          )
        } else {
          // Fallback 2: No active users exist yet in tenant database — auto-provision Company Admin user
          let adminRoleId: string | undefined
          const { rows: roleRows } = await client.query(
            `SELECT id FROM roles WHERE name = 'Company Admin' LIMIT 1`
          )
          if (roleRows.length) {
            adminRoleId = (roleRows[0] as Record<string, string>).id
          } else {
            const newRoleId = randomUUID()
            await client.query(
              `INSERT INTO roles (id, name, permissions, is_system) VALUES (?, 'Company Admin', '{"all":true}', 1)`,
              [newRoleId]
            )
            adminRoleId = newRoleId
          }

          const { rows: branchRows } = await client.query(
            `SELECT id FROM branches ORDER BY created_at ASC LIMIT 1`
          )
          let branchId = (branchRows[0] as Record<string, string>)?.id
          if (!branchId) {
            branchId = randomUUID()
            await client.query(
              `INSERT INTO branches (id, name, code, is_active) VALUES (?, 'Main Branch', 'MAIN-001', 1)`,
              [branchId]
            )
          }

          const newUserId = randomUUID()
          const adminEmail = (company.admin_email || company.email || 'admin@demo.com').toLowerCase()
          const adminName = company.admin_name || company.name || 'Company Admin'

          await client.query(
            `INSERT INTO users (id, branch_id, role_id, name, email, password_hash, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 1)`,
            [newUserId, branchId, adminRoleId, adminName, adminEmail, hash]
          )

          admin = { id: newUserId, name: adminName, email: adminEmail }
        }
      }

      return { tempPassword, adminEmail: admin.email, adminName: admin.name }
    })

    await auditLog({
      portal: 'superadmin', actorType: 'superadmin',
      actorId: auth.payload.sub, actorName: auth.payload.name,
      action: 'company.resetAdminPassword', resource: 'companies', resourceId: companyId, companyId,
    })

    return NextResponse.json(result)
  } catch (err) {
    console.error('[resetAdminPassword]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
