import { appRoute, need } from '@/lib/app/context'
import { requireSmartBuy } from '@/lib/app/smartbuyLib'
import type { WalletResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Read-only in v1.0 (no wallet spending / no wallet writes).
export const GET = appRoute({ auth: 'user', roles: ['smartbuy'] }, async (c): Promise<WalletResponse> => {
  const { company, user } = need(c)
  const customerId = await requireSmartBuy(company, user)
  const { rows } = await company.tp.query<{ balance: string }>(`SELECT balance FROM smartbuy_wallet WHERE customer_id = ? LIMIT 1`, [customerId])
  return { balance: Number(rows[0]?.balance) || 0, currency: 'LKR' }
})
