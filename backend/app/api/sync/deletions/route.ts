import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'
import { syncLimiter } from '@/lib/rateLimit'
import { assertFeature, resolveEntitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mirrors GET /api/sync/changes exactly, but reads the deletion tombstone
// log (sync_deletions, written by applySyncOperation's DELETE branch in
// lib/sync.ts) instead of a live table — this is what lets a device that
// already pulled a now-deleted row (e.g. a deleted branch) learn it should
// remove it locally, since the changes endpoint alone can never report a
// deletion (a deleted row simply isn't in its `WHERE updated_at > since`
// result set anymore).
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

  const entitlements = await resolveEntitlements({ companyId: company.id })
  if (!assertFeature({ company_id: company.id, portal: 'admin', permissions: {} }, 'sync.cloud', entitlements)) {
    return NextResponse.json({ error: 'Feature disabled: sync.cloud' }, { status: 403 })
  }

  try {
    const since = request.nextUrl.searchParams.get('since')
    if (!since || Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'A valid since timestamp is required' }, { status: 400 })
    }

    const { rows: data } = await company.tp.query(
      `SELECT table_name, record_id, deleted_at FROM sync_deletions WHERE deleted_at > ? ORDER BY deleted_at ASC LIMIT 5000`,
      [since]
    )
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deletion query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
