import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { only } from '@/lib/app/http'
import { requireAgent } from '@/lib/app/agentLib'
import { createCollection } from '@/lib/app/collectionsLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// An agent records cash taken from a member assigned to them. Works offline: the app re-sends with the same client_event_id.
export const POST = appRoute({ auth: 'user', roles: ['agent'] }, async c => {
  const { company, user, body } = need(c)
  const agentId = requireAgent(user)
  const b = await body()
  only(b, ['client_event_id', 'member_id', 'amount', 'receipt_number', 'collected_at', 'notes'])
  const { collection, created } = await createCollection(company, user, agentId, b)
  return NextResponse.json({ collection, duplicate: !created }, { status: created ? 201 : 200 })
})
