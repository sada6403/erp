import { timingSafeEqual } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { runNotificationWorkerAll } from '@/lib/app/notify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Cron (every minute): x-cron-secret must equal CRON_SECRET. In non-production with no CRON_SECRET set, open for local dev.
// Push is a dry-run (log only) unless APP_PUSH_ENABLED=1.
async function run(req: NextRequest) {
  const expected = process.env.CRON_SECRET
  if (expected) {
    const got = req.headers.get('x-cron-secret') || ''
    const a = Buffer.from(expected), b = Buffer.from(got)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
    }
  } else if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }, { status: 401 })
  }
  return NextResponse.json({ results: await runNotificationWorkerAll() })
}
export const POST = run
export const GET = run
