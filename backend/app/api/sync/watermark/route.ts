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
// these frequently changing tables) targeted pull. The full cycle keeps running unchanged as
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
    // Return a stable component for every tracked table, including empty ones.
    const { rows } = await company.tp.query<Record<string, unknown>>(
      `SELECT
         (SELECT MAX(updated_at) FROM products) AS products,
         (SELECT MAX(updated_at) FROM stocks) AS stocks,
         (SELECT MAX(updated_at) FROM categories) AS categories,
         (SELECT MAX(updated_at) FROM stock_transfers) AS stock_transfers,
         (SELECT MAX(updated_at) FROM branch_transfers) AS branch_transfers,
         (SELECT MAX(updated_at) FROM branch_transfer_items) AS branch_transfer_items`
    )
    // A global MAX can be held ahead by one table (or a future-dated row),
    // hiding later changes in every other table. Keep each table's maximum
    // in the opaque watermark so any transfer change triggers a client pull.
    const watermark = rows[0] ? JSON.stringify(rows[0]) : null
    return NextResponse.json({ watermark })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Watermark query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
