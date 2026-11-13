import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { fail, only } from '@/lib/app/http'
import { createVisit } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Any agent can log a visit (works offline: the app re-sends with the same client_event_id, the server answers with the stored row).
export const POST = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, body } = need(c)
  if (!user.agentId) fail(403, 'FORBIDDEN', 'Not allowed for this account')
  const b = await body()
  only(b, ['client_event_id', 'customer_id', 'prospect_name', 'prospect_phone', 'lat', 'lng', 'visited_at', 'outcome', 'reason', 'follow_up_at', 'notes'])
  const { visit, created } = await createVisit(company, user.agentId, b)
  return NextResponse.json({ visit, duplicate: !created }, { status: created ? 201 : 200 })
})
