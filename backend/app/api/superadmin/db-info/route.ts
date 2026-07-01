import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { pool } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    // Connection test
    const start = Date.now()
    await pool.query('SELECT 1')
    const pingMs = Date.now() - start

    // Main DB info from env (never expose password)
    const dbUrl   = process.env.DATABASE_URL ?? ''
    const urlHost = dbUrl ? (() => {
      try { const u = new URL(dbUrl); return `${u.hostname}:${u.port || 3306}` } catch { return 'configured' }
    })() : 'not configured'
    const urlDb = dbUrl ? (() => {
      try { return new URL(dbUrl).pathname.replace('/', '') } catch { return '' }
    })() : ''

    // Company / tenant summary
    const { rows: companySummary } = await pool.query(`
      SELECT
        COUNT(*)                                         AS total_companies,
        SUM(status = 'active')                           AS active,
        SUM(status = 'trial')                            AS trial,
        SUM(status = 'suspended')                        AS suspended,
        SUM(status = 'cancelled')                        AS cancelled
      FROM companies
    `)

    // Tenant database list
    const { rows: tenants } = await pool.query(`
      SELECT c.id, c.name, c.slug, c.status, c.db_schema,
             (SELECT COUNT(*) FROM users u WHERE 1=0) AS note
      FROM companies c
      ORDER BY c.name ASC
      LIMIT 200
    `)

    // Per-tenant size (best effort — may fail on some MySQL setups)
    let tenantSizes: Record<string, number> = {}
    try {
      const { rows: sizes } = await pool.query(`
        SELECT table_schema AS db_name,
               ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) AS size_mb
        FROM information_schema.tables
        WHERE table_schema LIKE 'pos_%'
        GROUP BY table_schema
      `)
      for (const r of sizes as { db_name: string; size_mb: number }[]) {
        tenantSizes[r.db_name] = r.size_mb
      }
    } catch { /* information_schema may not be accessible */ }

    const summary = (companySummary[0] as Record<string, number>)

    return NextResponse.json({
      connection: {
        host:    urlHost,
        database: urlDb,
        type:    'MySQL',
        status:  'connected',
        ping_ms: pingMs,
      },
      stats: {
        total_companies: Number(summary.total_companies ?? 0),
        active:          Number(summary.active          ?? 0),
        trial:           Number(summary.trial           ?? 0),
        suspended:       Number(summary.suspended       ?? 0),
        cancelled:       Number(summary.cancelled       ?? 0),
      },
      tenants: (tenants as Record<string, unknown>[]).map(t => ({
        id:        t.id,
        name:      t.name,
        slug:      t.slug,
        status:    t.status,
        db_schema: t.db_schema,
        size_mb:   tenantSizes[t.db_schema as string] ?? null,
      })),
    })
  } catch (err) {
    return NextResponse.json({
      connection: { host: 'unknown', database: '', type: 'MySQL', status: 'error', ping_ms: null },
      error: (err as Error).message,
      stats: { total_companies: 0, active: 0, trial: 0, suspended: 0, cancelled: 0 },
      tenants: [],
    })
  }
}
