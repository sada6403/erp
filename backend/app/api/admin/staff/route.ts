import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requirePermission, auditLog } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'
import bcrypt from 'bcryptjs'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await withTenant(auth.payload.company_id!, async (client) => {
    return client.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.last_login_at, u.created_at,
              r.name as role, b.name as branch_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN branches b ON b.id = u.branch_id
       ORDER BY u.name`
    )
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, 'employees')
  if ('error' in auth) return auth.error

  const { name, email, phone, password, role_id, branch_id, pin } = await req.json()
  if (!name || !email || !password || !role_id) {
    return NextResponse.json({ error: 'name, email, password, role_id required' }, { status: 400 })
  }

  const password_hash = await bcrypt.hash(password, 12)
  const pin_hash      = pin ? await bcrypt.hash(pin, 10) : null
  const userId        = randomUUID()

  await withTenant(auth.payload.company_id!, async (client) => {
    await client.query(
      `INSERT INTO users (id,name,email,phone,password_hash,pin_hash,role_id,branch_id)
       VALUES (?,?,?,?,?,?,?,?)`,
      [userId, name, email, phone??null, password_hash, pin_hash, role_id, branch_id??null]
    )
  })

  await auditLog({ portal: 'admin', actorType: 'admin_user', actorId: auth.payload.sub,
    actorName: auth.payload.name, companyId: auth.payload.company_id,
    action: 'staff.create', resource: 'users', resourceId: userId,
    newValues: { name, email, role_id } })

  return NextResponse.json({ id: userId, name, email }, { status: 201 })
}
