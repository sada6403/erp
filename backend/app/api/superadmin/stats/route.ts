import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { pool } from '@/lib/db'

export async function GET(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  try {
    async function safeQuery<T>(sql: string, fallback: T): Promise<T> {
      try {
        const { rows } = await pool.query(sql)
        return rows as T
      } catch {
        return fallback
      }
    }

    const [
      statusRows,
      revenueRows,
      deviceRows,
      syncRows,
      recentRows,
      expiringRows,
      newThisMonthRows,
    ] = await Promise.all([
      safeQuery(`SELECT status, COUNT(*) as count FROM companies GROUP BY status`, []),
      safeQuery(`
        SELECT COALESCE(SUM(p.monthly_price), 0) as mrr
        FROM company_subscriptions cs
        JOIN packages p ON p.id = cs.package_id
        WHERE cs.status = 'active'
      `, [{ mrr: 0 }]),
      safeQuery(`
        SELECT COUNT(*) as total, SUM(status = 'active') as active_count
        FROM pos_devices
      `, [{ total: 0, active_count: 0 }]),
      safeQuery(`
        SELECT COUNT(*) as total,
               SUM(status = 'success') as success_count,
               SUM(status = 'failed')  as failed_count
        FROM sync_logs
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR)
      `, [{ total: 0, success_count: 0, failed_count: 0 }]),
      safeQuery(`
        SELECT c.id, c.name, c.slug, c.email, c.status, c.created_at,
               p.name as package_name, cs.ends_at as sub_ends_at
        FROM companies c
        LEFT JOIN company_subscriptions cs ON cs.company_id = c.id AND cs.status IN ('active','trial')
        LEFT JOIN packages p ON p.id = cs.package_id
        ORDER BY c.created_at DESC
        LIMIT 5
      `, []),
      safeQuery(`
        SELECT id, name, slug, email, trial_ends_at, status
        FROM companies
        WHERE status = 'trial'
          AND trial_ends_at BETWEEN NOW() AND DATE_ADD(NOW(), INTERVAL 7 DAY)
        ORDER BY trial_ends_at ASC
        LIMIT 10
      `, []),
      safeQuery(`
        SELECT COUNT(*) as count FROM companies
        WHERE MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW())
      `, [{ count: 0 }]),
    ])

    // Build status map
    const statusMap: Record<string, number> = {}
    for (const r of statusRows as { status: string; count: number }[]) {
      statusMap[r.status] = Number(r.count)
    }

    const devices   = deviceRows[0]    as { total: number; active_count: number }
    const syncs     = syncRows[0]      as { total: number; success_count: number; failed_count: number }
    const revenue   = revenueRows[0]   as { mrr: number }
    const newMonth  = newThisMonthRows[0] as { count: number }

    return NextResponse.json({
      companies: {
        total:     Object.values(statusMap).reduce((a, b) => a + b, 0),
        active:    statusMap.active    ?? 0,
        trial:     statusMap.trial     ?? 0,
        suspended: statusMap.suspended ?? 0,
        cancelled: statusMap.cancelled ?? 0,
        newThisMonth: Number(newMonth.count),
      },
      revenue: {
        mrr: Number(revenue.mrr ?? 0),
      },
      devices: {
        total:  Number(devices.total        ?? 0),
        active: Number(devices.active_count ?? 0),
      },
      sync: {
        last24h:  Number(syncs.total         ?? 0),
        success:  Number(syncs.success_count ?? 0),
        failed:   Number(syncs.failed_count  ?? 0),
      },
      recentCompanies: recentRows,
      expiringTrials:  expiringRows,
    })
  } catch (err) {
    console.error('[stats GET]', err)
    return NextResponse.json({ error: (err as Error).message }, { status: 500 })
  }
}
