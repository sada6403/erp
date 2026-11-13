import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { collectionsToday } from '@/lib/app/collectionsLib'
import type { CollectionsTodayResponse } from '@/lib/app/contracts/collections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<CollectionsTodayResponse> => {
  const { company, user } = need(c)
  return collectionsToday(company, requireAgent(user))
})
