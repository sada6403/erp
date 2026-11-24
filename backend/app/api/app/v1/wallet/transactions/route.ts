import { appRoute, need } from '@/lib/app/context'
import { toIso } from '@/lib/app/http'
import { requireSmartBuy } from '@/lib/app/smartbuyLib'
import type { WalletTransactionsResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['smartbuy'] }, async (c): Promise<WalletTransactionsResponse> => {
  const { company, user } = need(c)
  const customerId = await requireSmartBuy(company, user)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT id, transaction_type, amount, balance_after, source, created_at FROM smartbuy_wallet_transactions
      WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`, [customerId])
  return { items: rows.map(t => ({
    id: String(t.id), type: String(t.transaction_type), amount: Number(t.amount), balance_after: Number(t.balance_after),
    source: t.source ? String(t.source) : null, created_at: toIso(t.created_at) as string,
  })) }
})
