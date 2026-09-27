import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError, resolveDeviceAuthorization, DeviceAuthorizationError } from '@/lib/auth'
import { assertTable, quoteIdentifier } from '@/lib/sync'
import { syncLimiter } from '@/lib/rateLimit'
import { assertFeature, resolveEntitlements } from '@/lib/entitlements'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type ChangeRequest = { table?: unknown; since?: unknown }

export async function POST(request: NextRequest) {
  const limited = syncLimiter(request)
  if (limited) return limited

  let company
  try {
    company = await resolveCompany(request)
  } catch (error) {
    if (error instanceof AccountStatusError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }
  if (!company) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await resolveDeviceAuthorization(request, company.id)
  } catch (error) {
    if (error instanceof DeviceAuthorizationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }

  const entitlements = await resolveEntitlements({ companyId: company.id })
  if (!assertFeature({ company_id: company.id, portal: 'admin', permissions: {} }, 'sync.cloud', entitlements)) {
    return NextResponse.json({ error: 'Feature disabled: sync.cloud' }, { status: 403 })
  }

  try {
    const body = await request.json() as { requests?: ChangeRequest[] }
    if (!Array.isArray(body.requests) || body.requests.length === 0 || body.requests.length > 100) {
      return NextResponse.json({ error: 'Between 1 and 100 table requests are required' }, { status: 400 })
    }

    const normalized = body.requests.map(item => {
      assertTable(item.table)
      if (typeof item.since !== 'string' || Number.isNaN(Date.parse(item.since))) {
        throw new Error(`A valid since timestamp is required for ${item.table}`)
      }
      return { table: item.table, since: item.since }
    })

    // Capture the upper bound before reading. Empty tables can advance to this
    // server-owned checkpoint without skipping a write that arrives mid-query.
    const { rows: clockRows } = await company.tp.query<{ checkpoint: string }>('SELECT CURRENT_TIMESTAMP(3) AS checkpoint')
    const checkpoint = clockRows[0]?.checkpoint
    if (!checkpoint) throw new Error('Could not create a synchronization checkpoint')

    const tables: Record<string, {
      data?: Record<string, unknown>[]
      checkpoint?: string
      truncated?: boolean
      error?: string
    }> = {}

    for (const item of normalized) {
      try {
        const sqlTime = new Date(item.since).toISOString().slice(0, 23).replace('T', ' ')
        const { rows: data } = await company.tp.query<Record<string, unknown>>(
          `SELECT * FROM ${quoteIdentifier(item.table)}
            WHERE updated_at > ? AND updated_at <= ?
            ORDER BY updated_at ASC, id ASC LIMIT 5000`,
          [sqlTime, checkpoint]
        )
        tables[item.table] = { data, checkpoint, truncated: data.length === 5000 }
      } catch (error) {
        tables[item.table] = { error: error instanceof Error ? error.message : String(error) }
      }
    }

    return NextResponse.json({ tables })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Batch change query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
