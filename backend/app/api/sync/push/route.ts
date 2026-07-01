import { NextRequest, NextResponse } from 'next/server'
import { resolveCompany, AccountStatusError } from '@/lib/auth'
import { withTransaction } from '@/lib/db'
import { applySyncOperation } from '@/lib/sync'
import mysql from 'mysql2/promise'
import { syncLimiter } from '@/lib/rateLimit'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
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
    const body = await request.json() as {
      table?: unknown; operation?: unknown; recordId?: unknown; record?: unknown
    }
    if (
      typeof body.table !== 'string' || typeof body.operation !== 'string' ||
      typeof body.recordId !== 'string' || !body.record ||
      typeof body.record !== 'object' || Array.isArray(body.record)
    ) {
      return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400 })
    }

    // Use a connection from the company's tenant pool
    const conn = await (company.tp as unknown as { connect: () => Promise<{ query: (sql: string, vals?: unknown[]) => Promise<{ rows: unknown[] }>; release: () => void }> }).connect()
    try {
      await applySyncOperation(conn, {
        table:     body.table as string,
        operation: body.operation as string,
        recordId:  body.recordId as string,
        record:    body.record as Record<string, unknown>,
      })
    } finally {
      conn.release()
    }

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync push failed'
    console.error('[sync/push]', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
