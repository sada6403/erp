import { appRoute, need } from '@/lib/app/context'
import { lookupAgentByCode } from '@/lib/app/joinLib'
import type { AgentLookupResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The applicant confirms the agent's NAME before submitting a join request. Display name + branch only; rate limited (guess protection).
export const GET = appRoute({ auth: 'user', roles: ['customer', 'agent'], limiter: 'otp' }, async (c): Promise<AgentLookupResponse> => {
  const { company, req } = need(c)
  return lookupAgentByCode(company, req.nextUrl.searchParams.get('code'))
})
