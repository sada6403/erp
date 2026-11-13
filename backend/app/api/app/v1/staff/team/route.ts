import { appRoute, need } from '@/lib/app/context'
import { parsePeriod, requireScope, teamList } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The caller plus every strict descendant, with target vs achievement. Nothing outside the subtree is ever returned.
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, req } = need(c)
  const scope = await requireScope(company, user)
  const period = parsePeriod(req.nextUrl.searchParams.get('period'))
  return { period, me: scope.staffId, items: await teamList(company, scope, period) }
})
