import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin, auditLog } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { deleteTenant } from '@/lib/tenant'

export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  const body = await req.json() as { action: string; olderThanDays?: number }

  // ── Clear old audit logs ──────────────────────────────────────────────────
  if (body.action === 'clearAuditLogs') {
    const days = Math.max(7, Number(body.olderThanDays) || 90)
    const { rows } = await pool.query(
      `SELECT COUNT(*) as cnt FROM saas_audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    )
    const count = Number((rows[0] as Record<string, number>).cnt)
    await pool.query(
      `DELETE FROM saas_audit_logs WHERE created_at < DATE_SUB(NOW(), INTERVAL ? DAY)`,
      [days]
    )
    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'danger.clearAuditLogs', newValues: { days, deleted: count } })
    return NextResponse.json({ ok: true, deleted: count })
  }

  // ── Purge all cancelled companies ─────────────────────────────────────────
  if (body.action === 'purgeCancelledCompanies') {
    const { rows } = await pool.query(
      `SELECT id, name FROM companies WHERE status = 'cancelled'`
    )
    const companies = rows as Record<string, string>[]
    let purged = 0
    const errors: string[] = []

    for (const company of companies) {
      try {
        await deleteTenant(company.id)
        purged++
      } catch (err) {
        errors.push(`${company.name}: ${(err as Error).message}`)
      }
    }

    await auditLog({ portal: 'superadmin', actorType: 'superadmin', actorId: auth.payload.sub,
      actorName: auth.payload.name, action: 'danger.purgeCancelledCompanies', newValues: { purged, errors } })

    return NextResponse.json({ ok: true, purged, errors })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
