import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'
import { assertRelatedKey, assertTable, quoteIdentifier } from '@/lib/sync'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
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
    const body = await request.json() as {
      table?: unknown; foreignKey?: unknown; ids?: unknown
    }
    assertTable(body.table)
    assertRelatedKey(body.table, body.foreignKey)
    if (!Array.isArray(body.ids) || body.ids.some(id => typeof id !== 'string')) {
      return NextResponse.json({ error: 'ids must be a string array' }, { status: 400 })
    }
    if (body.ids.length === 0) return NextResponse.json({ data: [] })

    // MySQL: WHERE col IN (?,?,?)
    const placeholders = body.ids.map(() => '?').join(',')
    const { rows: data } = await company.tp.query(
      `SELECT * FROM ${quoteIdentifier(body.table)}
       WHERE ${quoteIdentifier(body.foreignKey as string)} IN (${placeholders})`,
      body.ids
    )
    return NextResponse.json({ data })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Related-data query failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
