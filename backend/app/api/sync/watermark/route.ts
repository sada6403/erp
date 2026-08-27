import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError, resolveDeviceAuthorization, DeviceAuthorizationError } from '@/lib/auth'
import { syncLimiter } from '@/lib/rateLimit'
import { assertFeature, resolveEntitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Issue 37 (36c) — a cheap, frequent "did anything change" check so a
// branch can notice a product/stock/category edit within a few seconds
// without paying the ~25s cost of the full 59-table pullChanges() cycle on
// every check. Polled every few seconds by SyncService; only when this
// value changes does the client do the (still cheap, now scoped to just
// these 3 tables) targeted pull. The full cycle keeps running unchanged as
// the comprehensive catch-all for every other table and offline catch-up.
export async function GET(request: NextRequest) {
  const limited = syncLimiter(request)
  if (limited) return limited

  let company
  try {
    company = await resolveCompany(request)
  } catch (err) {
    if (err instanceof AccountStatusError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    throw err
  }
  if (!company) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await resolveDeviceAuthorization(request, company.id)
  } catch (err) {
    if (err instanceof DeviceAuthorizationError) {
      return NextResponse.json({ error: err.message, code: err.code }, { status: 403 })
    }
    throw err
  }

  const entitlements = await resolveEntitlements({ companyId: company.id })
  if (!assertFeature({ company_id: company.id, portal: 'admin', permissions: {} }, 'sync.cloud', entitlements)) {
    return NextResponse.json({ error: 'Feature disabled: sync.cloud' }, { status: 403 })
  }

  try {
    // A plain GREATEST(MAX(a), MAX(b), MAX(c)) returns NULL in MySQL the
    // moment any single table is empty (NULL propagates through GREATEST)
    // — wrapping each MAX in its own row and re-aggregating avoids that.
    const { rows } = await company.tp.query(
      `SELECT MAX(ts) as watermark FROM (
         SELECT MAX(updated_at) as ts FROM products
         UNION ALL
         SELECT MAX(updated_at) as ts FROM stocks
         UNION ALL
         SELECT MAX(updated_at) as ts FROM categories
       ) x`
    )
    const watermark = (rows[0] as { watermark: string | null } | undefined)?.watermark ?? null
    return NextResponse.json({ watermark })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Watermark query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
