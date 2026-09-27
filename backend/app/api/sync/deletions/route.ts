import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError, resolveDeviceAuthorization, DeviceAuthorizationError } from '@/lib/auth'
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
    const since = request.nextUrl.searchParams.get('since')
    if (!since || Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'A valid since timestamp is required' }, { status: 400 })
    }

    const afterId = request.nextUrl.searchParams.get('afterId')
    const sqlTime = new Date(since).toISOString().slice(0, 23).replace('T', ' ')
    const { rows: data } = await company.tp.query<Record<string, unknown>>(
      `SELECT id, table_name, record_id, deleted_at FROM sync_deletions WHERE ${afterId === null ? 'deleted_at > ?' : '(deleted_at > ? OR (deleted_at = ? AND id > ?))'} ORDER BY deleted_at ASC, id ASC LIMIT 5000`,
      afterId === null ? [sqlTime] : [sqlTime, sqlTime, afterId]
    )
    const last = data[data.length - 1]
    return NextResponse.json({ data, nextCursor: data.length === 5000 && last
      ? { since: last.deleted_at, afterId: String(last.id) } : null })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Deletion query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
