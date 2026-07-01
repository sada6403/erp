import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin, requirePermission, auditLog } from '@/lib/rbac'
import { withTenant } from '@/lib/tenant'
import { randomUUID } from 'crypto'

export async function GET(req: NextRequest) {
  const auth = requireAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await withTenant(auth.payload.company_id!, async (client) => {
    return client.query(
      `SELECT b.*, u.name as manager_name,
              (SELECT COUNT(*) FROM users WHERE branch_id=b.id AND is_active=1) as staff_count
       FROM branches b
       LEFT JOIN users u ON u.id = b.manager_id
       ORDER BY b.name`
    )
  })
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const auth = requirePermission(req, 'all')
  if ('error' in auth) return auth.error

  const { name, code, address, phone, manager_id } = await req.json()
  if (!name || !code) return NextResponse.json({ error: 'name and code required' }, { status: 400 })

  const branchId = randomUUID()
  await withTenant(auth.payload.company_id!, async (client) => {
    await client.query(
      `INSERT INTO branches (id,name,code,address,phone,manager_id) VALUES (?,?,?,?,?,?)`,
      [branchId, name, code, address??null, phone??null, manager_id??null]
    )
  })

  await auditLog({ portal: 'admin', actorType: 'admin_user', actorId: auth.payload.sub,
    actorName: auth.payload.name, companyId: auth.payload.company_id,
    action: 'branch.create', resource: 'branches', resourceId: branchId, newValues: { name, code } })

  return NextResponse.json({ id: branchId, name, code }, { status: 201 })
}
