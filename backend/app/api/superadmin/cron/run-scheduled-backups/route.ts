import { NextRequest, NextResponse } from 'next/server'
import { requireCronSecret } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { createBackup } from '@/lib/backup'

// POST /api/superadmin/cron/run-scheduled-backups
// Called from a VPS crontab (x-cron-secret header, no human session available)
export async function POST(req: NextRequest) {
  const auth = requireCronSecret(req)
  if ('error' in auth) return auth.error

  const { rows: due } = await pool.query(`
    SELECT company_id, frequency FROM company_backup_schedules
    WHERE enabled = 1
      AND (
        last_run_at IS NULL
        OR (frequency = 'daily'  AND last_run_at < DATE_SUB(NOW(), INTERVAL 1 DAY))
        OR (frequency = 'weekly' AND last_run_at < DATE_SUB(NOW(), INTERVAL 7 DAY))
      )
  `)

  const results: { companyId: string; backupId?: string; error?: string }[] = []

  for (const row of due as Record<string, string>[]) {
    try {
      const backupId = await createBackup({ companyId: row.company_id, backupType: 'scheduled', createdBy: null })
      await pool.query(`UPDATE company_backup_schedules SET last_run_at = NOW() WHERE company_id = ?`, [row.company_id])
      results.push({ companyId: row.company_id, backupId })
    } catch (err) {
      results.push({ companyId: row.company_id, error: (err as Error).message })
    }
  }

  return NextResponse.json({ processed: results.length, results })
}
