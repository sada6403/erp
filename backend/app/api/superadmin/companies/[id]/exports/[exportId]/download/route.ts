import { NextRequest, NextResponse } from 'next/server'
import { readFile } from 'fs/promises'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { exportFilePathFor, contentTypeFor, type Format } from '@/lib/export'

type Params = { params: Promise<{ id: string; exportId: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId, exportId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const { rows } = await pool.query(
    `SELECT file_name, format, status FROM company_exports WHERE id = ? AND company_id = ?`,
    [exportId, companyId]
  )
  const exp = rows[0] as Record<string, string> | undefined
  if (!exp || exp.status !== 'completed' || !exp.file_name) {
    return NextResponse.json({ error: 'Export not found or not ready' }, { status: 404 })
  }

  let data: Buffer
  try {
    data = await readFile(exportFilePathFor(companyId, exp.file_name))
  } catch {
    return NextResponse.json({ error: 'Export file missing on disk' }, { status: 410 })
  }

  await pool.query(
    `UPDATE company_exports SET download_count = download_count + 1, last_downloaded_at = NOW() WHERE id = ?`,
    [exportId]
  )
  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'export.download', resource: 'company_exports',
    resourceId: exportId, companyId })

  return new NextResponse(new Uint8Array(data), {
    headers: {
      'content-type': contentTypeFor(exp.format as Format),
      'content-disposition': `attachment; filename="${exp.file_name}"`,
      'content-length': String(data.length),
    },
  })
}
