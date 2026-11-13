import { appRoute, need } from '@/lib/app/context'
import { parsePeriod, requireScope, staffDetail, visible } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Sales, collections and visits of one person inside the caller's scope; anything outside it answers 404.
export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, req, params } = need(c)
  const scope = await requireScope(company, user)
  visible(scope, params.id)
  return staffDetail(company, scope, params.id, parsePeriod(req.nextUrl.searchParams.get('period')))
})
