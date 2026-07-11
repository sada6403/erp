import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT c.max_users AS company_max_users,
            c.max_branches AS company_max_branches,
            cl.max_users,
            cl.max_branches,
            cl.max_pos_devices,
            cl.max_storage_gb,
            cl.updated_at
     FROM companies c
     LEFT JOIN company_limits cl ON cl.company_id = c.id
     WHERE c.id = ?`,
    [companyId]
  )
  if (!rows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rows[0])
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json()
  const max_users = body.max_users ?? body.maxUsers
  const max_branches = body.max_branches ?? body.maxBranches
  const max_pos_devices = body.max_pos_devices ?? body.maxPosDevices
  const max_storage_gb = body.max_storage_gb ?? body.maxStorageGb

  await pool.query(
    `INSERT INTO company_limits (id, company_id, max_users, max_branches, max_pos_devices, max_storage_gb, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       max_users = VALUES(max_users),
       max_branches = VALUES(max_branches),
       max_pos_devices = VALUES(max_pos_devices),
       max_storage_gb = VALUES(max_storage_gb),
       updated_by = VALUES(updated_by),
       updated_at = NOW()`,
    [
      randomUUID(),
      companyId,
      Number(max_users ?? 0),
      Number(max_branches ?? 0),
      Number(max_pos_devices ?? 0),
      Number(max_storage_gb ?? 0),
      auth.payload.sub,
    ]
  )

  await auditLog({
    portal: 'superadmin',
    actorType: 'superadmin',
    actorId: auth.payload.sub,
    actorName: auth.payload.name,
    action: 'company.limits.update',
    resource: 'company_limits',
    resourceId: companyId,
    newValues: { max_users, max_branches, max_pos_devices, max_storage_gb },
  })

  return NextResponse.json({ ok: true })
}
