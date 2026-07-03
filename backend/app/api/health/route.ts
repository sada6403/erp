import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, isAuthorized, resolveCompany } from '@/lib/auth'
import { db } from '@/lib/db'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    try {
      const company = await resolveCompany(request)
      if (!company) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }
    } catch (error) {
      if (error instanceof AccountStatusError) {
        return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
      }
      throw error
    }
  }

  try {
    await db.query('SELECT 1')
    return NextResponse.json({ status: 'ok', database: 'connected' })
  } catch (error) {
    console.error('[health]', error)
    return NextResponse.json({ status: 'error', database: 'unavailable' }, { status: 503 })
  }
}
