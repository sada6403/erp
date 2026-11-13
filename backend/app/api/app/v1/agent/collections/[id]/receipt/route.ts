import { appRoute, need } from '@/lib/app/context'
import { requireAgent } from '@/lib/app/agentLib'
import { receiptFor } from '@/lib/app/collectionsLib'
import type { ReceiptDto } from '@/lib/app/contracts/collections'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['agent'] }, async (c): Promise<ReceiptDto> => {
  const { company, user, params } = need(c)
  return receiptFor(company, requireAgent(user), params.id)
})
