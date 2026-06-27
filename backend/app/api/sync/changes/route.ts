import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized } from '@/lib/auth'
import { rows } from '@/lib/db'
import { assertTable, quoteIdentifier } from '@/lib/sync'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const table = request.nextUrl.searchParams.get('table')
    const since = request.nextUrl.searchParams.get('since')
    assertTable(table)
    if (!since || Number.isNaN(Date.parse(since))) {
      return NextResponse.json({ error: 'A valid since timestamp is required' }, { status: 400 })
    }

    const data = await rows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(table)}
        WHERE updated_at > $1::timestamptz
        ORDER BY updated_at ASC
        LIMIT 5000`,
      [since]
    )
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Change query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
