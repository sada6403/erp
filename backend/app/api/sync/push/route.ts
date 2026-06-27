import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized } from '@/lib/auth'
import { withTransaction } from '@/lib/db'
import { applySyncOperation } from '@/lib/sync'

export const runtime = 'nodejs'

export async function POST(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const body = await request.json() as {
      table?: unknown
      operation?: unknown
      recordId?: unknown
      record?: unknown
    }
    if (
      typeof body.table !== 'string'
      || typeof body.operation !== 'string'
      || typeof body.recordId !== 'string'
      || !body.record
      || typeof body.record !== 'object'
      || Array.isArray(body.record)
    ) {
      return NextResponse.json({ error: 'Invalid sync payload' }, { status: 400 })
    }

    await withTransaction(client => applySyncOperation(client, {
      table: body.table as string,
      operation: body.operation as string,
      recordId: body.recordId as string,
      record: body.record as Record<string, unknown>,
    }))

    return NextResponse.json({ success: true })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Sync push failed'
    console.error('[sync/push]', error)
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
