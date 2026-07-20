import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { createBackup } from '@/lib/backup'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const { rows } = await pool.query(
      `SELECT id, backup_type, status, file_name, file_size_bytes, error_message,
              created_by, download_count, last_downloaded_at, restored_at, restored_by,
              created_at, completed_at
       FROM company_backups WHERE company_id = ? ORDER BY created_at DESC LIMIT 100`,
      [companyId]
    )
    return NextResponse.json(rows)
  } catch {
    return NextResponse.json([])
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = ?`, [companyId])
  if (!companyRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const backupId = await createBackup({ companyId, backupType: 'manual', createdBy: auth.payload.sub })

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'backup.create', resource: 'company_backups',
    resourceId: backupId, companyId })

  return NextResponse.json({ ok: true, backupId }, { status: 201 })
}
