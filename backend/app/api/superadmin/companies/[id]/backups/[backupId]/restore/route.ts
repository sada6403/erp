import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { restoreBackup } from '@/lib/backup'

type Params = { params: Promise<{ id: string; backupId: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const { id: companyId, backupId } = await params
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json().catch(() => ({})) as { confirmCompanyName?: string }

  const { rows } = await pool.query(`SELECT name FROM companies WHERE id = ?`, [companyId])
  const company = rows[0] as Record<string, string> | undefined
  if (!company) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  if (String(body.confirmCompanyName ?? '').trim() !== company.name) {
    return NextResponse.json({ error: 'Company name confirmation does not match' }, { status: 400 })
  }

  try {
    await restoreBackup({ companyId, backupId, actorId: auth.payload.sub })
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'backup.restore', resource: 'company_backups',
      resourceId: backupId, companyId, newValues: { result: 'success' } })
    return NextResponse.json({ ok: true })
  } catch (err) {
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'backup.restore', resource: 'company_backups',
      resourceId: backupId, companyId, newValues: { result: 'failed', error: (err as Error).message } })
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
