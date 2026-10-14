import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { pool } from '@/lib/db'

async function ensureTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS saas_audit_logs (
        id           CHAR(36)      NOT NULL PRIMARY KEY,
        portal       VARCHAR(20)   NOT NULL,
        actor_type   VARCHAR(30)   NOT NULL,
        actor_id     VARCHAR(36)   NOT NULL,
        actor_name   VARCHAR(255)  NULL,
        company_id   CHAR(36)      NULL,
        action       VARCHAR(100)  NOT NULL,
        resource     VARCHAR(100)  NULL,
        resource_id  VARCHAR(36)   NULL,
        old_values   JSON          NULL,
        new_values   JSON          NULL,
        ip_address   VARCHAR(45)   NULL,
        user_agent   TEXT          NULL,
        pc_name      VARCHAR(100)  NULL,
        created_at   DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_al_actor   (actor_type, actor_id),
        INDEX idx_al_company (company_id),
        INDEX idx_al_date    (created_at),
        INDEX idx_al_pc      (pc_name)
      )
    `)
  } catch (e) {
    console.warn('[audit] ensureTable skipped:', (e as Error).message?.slice(0, 80))
  }

  // Auto-migration: ensure pc_name exists for pre-existing tables
  try {
    await pool.query(`ALTER TABLE saas_audit_logs ADD COLUMN pc_name VARCHAR(100) NULL AFTER user_agent`)
  } catch { /* already exists */ }

  try {
    await pool.query(`ALTER TABLE saas_audit_logs ADD INDEX idx_al_pc (pc_name)`)
  } catch { /* index already exists */ }
}

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  await ensureTable()

  const sp     = req.nextUrl.searchParams
  const page   = Math.max(1, Number(sp.get('page')   ?? 1))
  const limit  = Math.min(100, Number(sp.get('limit') ?? 50))
  const offset = (page - 1) * limit

  const conditions: string[] = []
  const args: unknown[] = []

  if (sp.get('company_id')) { conditions.push(`l.company_id = ?`)  ; args.push(sp.get('company_id')) }
  if (sp.get('actor_type')) { conditions.push(`l.actor_type = ?`)  ; args.push(sp.get('actor_type')) }
  if (sp.get('action'))     { conditions.push(`l.action LIKE ?`)   ; args.push(`%${sp.get('action')}%`) }
  if (sp.get('pc_name'))    { conditions.push(`l.pc_name LIKE ?`)  ; args.push(`%${sp.get('pc_name')}%`) }
  if (sp.get('from'))       { conditions.push(`l.created_at >= ?`) ; args.push(sp.get('from')) }
  if (sp.get('to'))         { conditions.push(`l.created_at <= ?`) ; args.push(sp.get('to') + ' 23:59:59') }

  if (sp.get('search')) {
    const s = `%${sp.get('search')}%`
    conditions.push(`(l.action LIKE ? OR l.actor_name LIKE ? OR l.pc_name LIKE ? OR l.ip_address LIKE ? OR l.resource LIKE ?)`)
    args.push(s, s, s, s, s)
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''

  try {
    const { rows: data } = await pool.query(
      `SELECT l.*, c.name as company_name
       FROM saas_audit_logs l
       LEFT JOIN companies c ON c.id = l.company_id
       ${where}
       ORDER BY l.created_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
      args
    )

    const { rows: cnt } = await pool.query(
      `SELECT COUNT(*) as total FROM saas_audit_logs l ${where}`,
      args
    )

    // Also fetch distinct known PC names for filter options
    let distinctPcs: string[] = []
    try {
      const { rows: pcRows } = await pool.query(
        `SELECT DISTINCT pc_name FROM saas_audit_logs WHERE pc_name IS NOT NULL AND pc_name != '' ORDER BY pc_name ASC LIMIT 50`
      )
      distinctPcs = pcRows.map((r: any) => r.pc_name)
    } catch { /* ignore */ }

    return NextResponse.json({
      rows:  data,
      total: Number((cnt[0] as Record<string, number>).total ?? 0),
      page,
      limit,
      distinctPcs,
    })
  } catch (err) {
    const msg = (err as Error).message ?? ''
    console.error('[audit] query error:', msg)
    // Table may not exist yet — return empty rather than 500
    if (msg.includes("doesn't exist") || msg.includes('No such table')) {
      return NextResponse.json({ rows: [], total: 0, page, limit, distinctPcs: [] })
    }
    return NextResponse.json({ error: msg || 'Internal Server Error' }, { status: 500 })
  }
}

