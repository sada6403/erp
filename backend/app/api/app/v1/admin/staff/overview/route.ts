import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError } from '@/lib/app/http'
import { loadOrg, parsePeriod, performanceFor } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POS desktop: target vs achievement for everyone on the hierarchy (team figures per person).
export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const period = parsePeriod(req.nextUrl.searchParams.get('period'))
    const org = await loadOrg(company)
    const items = await performanceFor(company, org, [...org.byStaff.keys()], period)
    return NextResponse.json({ period, items: items.map(i => ({ ...i, reports_to: org.byStaff.get(i.staff_id)?.reportsTo ?? null })) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return handleError(err) }
}
