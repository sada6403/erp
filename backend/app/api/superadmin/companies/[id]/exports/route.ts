import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { createExport, isValidCombination, ALL_ENTITIES, ALL_FORMATS, type Entity, type Format } from '@/lib/export'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { id: companyId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    const { rows } = await pool.query(
      `SELECT id, entity, format, status, file_name, file_size_bytes, row_count, error_message,
              created_by, download_count, last_downloaded_at, created_at, completed_at
       FROM company_exports WHERE company_id = ? ORDER BY created_at DESC LIMIT 100`,
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

  const { entity, format } = await req.json() as { entity?: string; format?: string }

  if (!ALL_ENTITIES.includes(entity as Entity) || !ALL_FORMATS.includes(format as Format)) {
    return NextResponse.json({ error: 'Unknown entity or format' }, { status: 400 })
  }
  if (!isValidCombination(entity as Entity, format as Format)) {
    return NextResponse.json({ error: `${format} is not offered for ${entity}` }, { status: 400 })
  }

  const { rows: companyRows } = await pool.query(`SELECT id FROM companies WHERE id = ?`, [companyId])
  if (!companyRows.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const exportId = await createExport({
    companyId, entity: entity as Entity, format: format as Format, createdBy: auth.payload.sub,
  })

  await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
    actorName: auth.payload.name, action: 'export.create', resource: 'company_exports',
    resourceId: exportId, companyId, newValues: { entity, format } })

  return NextResponse.json({ ok: true, exportId }, { status: 201 })
}
