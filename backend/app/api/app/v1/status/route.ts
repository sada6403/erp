import { appRoute } from '@/lib/app/context'
import { getSettings, getModules, flag } from '@/lib/app/settings'
import type { StatusResponse } from '@/lib/app/contracts/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'none' }, async ({ company }): Promise<StatusResponse> => {
  const s = await getSettings(company)
  const modules = await getModules(company)
  const freeOver = s.delivery_free_over !== '' ? Number(s.delivery_free_over) : NaN
  return {
    ordering_enabled: flag(s.ordering_enabled),
    maintenance_message: s.maintenance_message || null,
    min_app_version: s.min_app_version,
    latest_version: s.latest_version,
    latest_version_critical: flag(s.latest_version_critical),
    apk_url: s.apk_url || null,
    server_time: new Date().toISOString(),
    company: { name: company.name, currency: 'LKR' },
    modules,
    delivery: { flat_fee: Number(s.delivery_flat_fee) || 0, free_over: Number.isFinite(freeOver) && freeOver > 0 ? freeOver : null },
    bank_transfer: { enabled: flag(s.bank_transfer_enabled), instructions: s.bank_transfer_instructions || null },
  }
})
