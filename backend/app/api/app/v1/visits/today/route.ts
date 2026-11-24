import { appRoute, need } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { visitsToday } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user } = need(c)
  if (!user.agentId) fail(403, 'FORBIDDEN', 'Not allowed for this account')
  return visitsToday(company, user.agentId)
})
