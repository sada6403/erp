import { appRoute, need } from '@/lib/app/context'
import { parsePeriod, requireScope, visible, visitReport } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Visit counts, GPS gaps and follow-up compliance for the caller's subtree (or one person inside it).
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, req } = need(c)
  const scope = await requireScope(company, user)
  const q = req.nextUrl.searchParams
  const only = q.get('staff_id')
  if (only) visible(scope, only)
  return visitReport(company, scope, parsePeriod(q.get('period')), only)
})
