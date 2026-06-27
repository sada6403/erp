import { NextRequest, NextResponse } from 'next/server'
import { isAuthorized } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    await db.query('SELECT 1')
    return NextResponse.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('[health]', error)
    return NextResponse.json({ status: 'error', database: 'unavailable' }, { status: 503 })
  }
}
