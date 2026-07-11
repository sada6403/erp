import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'
import { assertTable, quoteIdentifier } from '@/lib/sync'
import { syncLimiter } from '@/lib/rateLimit'
import { assertFeature, resolveEntitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const table = request.nextUrl.searchParams.get('table')
    const since = request.nextUrl.searchParams.get('since')
    assertTable(table)
    if (!since || Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'A valid since timestamp is required' }, { status: 400 })
    }

    const { rows: data } = await company.tp.query(
      `SELECT * FROM ${quoteIdentifier(table)} WHERE updated_at > ? ORDER BY updated_at ASC LIMIT 5000`,
      [since]
    )
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Change query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
