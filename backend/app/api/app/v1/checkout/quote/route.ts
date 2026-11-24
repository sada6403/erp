import { appRoute, need } from '@/lib/app/context'
import { only, optStr } from '@/lib/app/http'
import { buildQuote, parseCart } from '@/lib/app/ordersLib'
import type { QuoteResponse } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'user', roles: ['customer'], limiter: 'order' }, async (c): Promise<QuoteResponse> => {
  const { company, body } = need(c)
  const b = await body()
  only(b, ['items', 'branch_id', 'address_id', 'payment_method'])
  return buildQuote(company, parseCart(b.items), optStr(b.branch_id, 'branch_id', 191))
})
