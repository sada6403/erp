import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT enabled, frequency, last_run_at FROM company_backup_schedules WHERE company_id = ?`,
    [companyId]
  )
  return NextResponse.json(rows[0] ?? { enabled: false, frequency: 'daily', last_run_at: null })
}

export async function PATCH(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { enabled, frequency } = await req.json() as { enabled?: boolean; frequency?: 'daily' | 'weekly' }
  const freq = frequency === 'weekly' ? 'weekly' : 'daily'

  await pool.query(
    `INSERT INTO company_backup_schedules (company_id, enabled, frequency, updated_by)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled), frequency = VALUES(frequency), updated_by = VALUES(updated_by)`,
    [companyId, enabled ? 1 : 0, freq, auth.payload.sub]
  )

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'backup.schedule.update', resource: 'company_backup_schedules',
    resourceId: companyId, companyId, newValues: { enabled, frequency: freq } })

  return NextResponse.json({ ok: true, enabled: Boolean(enabled), frequency: freq })
}
