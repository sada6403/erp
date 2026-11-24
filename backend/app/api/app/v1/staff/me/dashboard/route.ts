import { appRoute, need } from '@/lib/app/context'
import { parsePeriod, performanceFor, requireScope, visitsToday } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// 403 FORBIDDEN for an account that is not on the sales hierarchy: the app uses that to hide the Team area.
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, req } = need(c)
  const scope = await requireScope(company, user)
  const period = parsePeriod(req.nextUrl.searchParams.get('period'))
  const [me] = await performanceFor(company, scope.org, [scope.staffId], period)
  const today = await visitsToday(company, scope.staffId)
  return {
    level: scope.level, period, performance: me, team_size: scope.subtree.length,
    visits_today: today.visits.length, follow_ups_due: today.follow_ups.length,
  }
})
