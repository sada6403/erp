import { appRoute } from '@/lib/app/context'
import { fail } from '@/lib/app/http'
import { loadCompanyProfile } from '@/lib/companyProfile'
import type { CompanyProfileResponse } from '@/lib/app/contracts/company'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Public company profile for the header, About, Help & Contact and receipts. Edited in POS Settings, no app update needed. */
export const GET = appRoute({ auth: 'none' }, async (c): Promise<CompanyProfileResponse> => {
  const p = await loadCompanyProfile(c.company.id, c.origin)
  if (!p) fail(404, 'NOT_FOUND', 'Company not found')
  return p
})
