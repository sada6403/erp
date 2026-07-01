import { NextRequest, NextResponse } from 'next/server'
import { requireSuperAdmin } from '@/lib/rbac'
import { pool } from '@/lib/db'
import { sendTrialExpiryWarning } from '@/lib/email'

// POST /api/superadmin/cron/trial-expiry
// Call from a cron job (e.g. daily at 9am) or manually from the portal
export async function POST(req: NextRequest) {
  const auth = requireSuperAdmin(req)
  if ('error' in auth) return auth.error

  // Find trials expiring in 7 days or 1 day that haven't been notified yet
  const { rows: expiring } = await pool.query(`
    SELECT c.id, c.name as company_name, c.email as company_email,
           u.name as admin_name, u.email as admin_email,
           s.ends_at,
           DATEDIFF(s.ends_at, CURDATE()) as days_left
    FROM company_subscriptions s
    JOIN companies c ON c.id = s.company_id
    LEFT JOIN users u ON u.company_id = c.id AND u.role = 'Company Admin' LIMIT 1
    WHERE s.status = 'trial'
      AND s.ends_at IS NOT NULL
      AND DATEDIFF(s.ends_at, CURDATE()) IN (7, 3, 1)
      AND c.status = 'active'
  `)

  const results: { company: string; daysLeft: number; sent: boolean; error?: string }[] = []

  for (const row of expiring as Record<string, unknown>[]) {
    const daysLeft = Number(row.days_left)
    const email    = (row.admin_email || row.company_email) as string
    const name     = (row.admin_name  || row.company_name) as string

    if (!email) { results.push({ company: row.company_name as string, daysLeft, sent: false, error: 'no email' }); continue }

    const r = await sendTrialExpiryWarning({
      companyName: row.company_name as string,
      adminEmail:  email,
      adminName:   name,
      daysLeft,
      endsAt:      row.ends_at as string,
    })

    results.push({ company: row.company_name as string, daysLeft, sent: r.ok, error: r.error })
  }

  return NextResponse.json({ processed: results.length, results })
}
