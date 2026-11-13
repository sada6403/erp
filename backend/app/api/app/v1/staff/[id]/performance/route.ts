import { appRoute, need } from '@/lib/app/context'
import { parsePeriod, performanceFor, requireScope, visible } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Self or a descendant; any other id (peer, boss, other branch) answers 404.
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, req, params } = need(c)
  const scope = await requireScope(company, user)
  visible(scope, params.id)
  const period = parsePeriod(req.nextUrl.searchParams.get('period'))
  const [p] = await performanceFor(company, scope.org, [params.id], period)
  return p
})
