import { appRoute } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { getModules } from '@/lib/app/settings'
import { freq } from '@/lib/app/smartbuyLib'
import type { OpenSchemesResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ company }): Promise<OpenSchemesResponse> => {
  if (!(await getModules(company)).smartbuy) fail(403, 'MODULE_DISABLED', 'Smart Buy is not available.')
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT s.*, (SELECT COUNT(*) FROM chit_members m WHERE m.scheme_id = s.id) AS joined FROM chit_schemes s
      WHERE s.status = 'active' ORDER BY s.name LIMIT 100`)
  return { items: rows.map(s => ({
    id: String(s.id), name: String(s.name), contribution_amount: Number(s.contribution_amount), frequency: freq(s.frequency),
    cycle_count: Number(s.cycle_count), chit_value: Number(s.chit_value), member_count: Number(s.member_count), status: String(s.status),
  })) }
})
