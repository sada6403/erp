import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { backupFilePathFor } from '@/lib/backup'

type Params = { params: Promise<{ id: string; backupId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId, backupId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT file_name, status FROM company_backups WHERE id = ? AND company_id = ?`,
    [backupId, companyId]
  )
  const backup = rows[0] as Record<string, string> | undefined
  if (!backup || backup.status !== 'completed' || !backup.file_name) {
    return NextResponse.json({ error: 'Backup not found or not ready' }, { status: 404 })
  }

  let data: Buffer
  try {
    data = await readFile(backupFilePathFor(companyId, backup.file_name))
  } catch {
    return NextResponse.json({ error: 'Backup file missing on disk' }, { status: 410 })
  }

  await pool.query(
    `UPDATE company_backups SET download_count = download_count + 1, last_downloaded_at = NOW() WHERE id = ?`,
    [backupId]
  )
  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'backup.download', resource: 'company_backups',
    resourceId: backupId, companyId })

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': 'application/octet-stream',
      'content-disposition': `attachment; filename="${backup.file_name}"`,
      'content-length': String(data.length),
    },
  })
}
