import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized } from '@/lib/auth'
import { rows } from '@/lib/db'
import { assertRelatedKey, assertTable, quoteIdentifier } from '@/lib/sync'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json() as {
      table?: unknown
      foreignKey?: unknown
      ids?: unknown
    }
    assertTable(body.table)
    assertRelatedKey(body.table, body.foreignKey)
    if (!Array.isArray(body.ids) || body.ids.some(id => typeof id !== 'string')) {
      return NextResponse.json({ error: 'ids must be a string array' }, { status: 400 })
    }
    if (body.ids.length === 0) return NextResponse.json({ data: [] })

    const data = await rows<Record<string, unknown>>(
      `SELECT * FROM ${quoteIdentifier(body.table)}
        WHERE ${quoteIdentifier(body.foreignKey)} = ANY($1::text[])`,
      [body.ids]
    )
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Related-data query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
