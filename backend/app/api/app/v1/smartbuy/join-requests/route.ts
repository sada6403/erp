import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { intParam } from '@/lib/app/http'
import { joinDto, submitJoinRequest } from '@/lib/app/joinLib'
import { readMultipart, savePrivateImage } from '@/lib/app/privateFiles'
import type { JoinRequestsResponse } from '@/lib/app/contracts/smartbuy'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The submitter's own requests only (token decides; never an id from the client).
export const GET = appRoute({ auth: 'user', roles: ['agent', 'customer'] }, async (c): Promise<JoinRequestsResponse> => {
  const { company, user, req } = need(c)
  const sp = req.nextUrl.searchParams
  const limit = intParam(sp.get('limit'), 30, 1, 100)
  const offset = intParam(sp.get('cursor'), 0, 0, 100000)
  const { rows } = await company.tp.query<Record<string, unknown>>(
    `SELECT j.*, s.name AS scheme_name FROM smartbuy_join_requests j LEFT JOIN chit_schemes s ON s.id = j.scheme_id
      WHERE j.submitted_by_user_id = ? ORDER BY j.created_at DESC LIMIT ${limit + 1} OFFSET ${offset}`, [user.userId])
  return { items: rows.slice(0, limit).map(joinDto), next_cursor: rows.length > limit ? String(offset + limit) : null }
})

export const POST = appRoute({ auth: 'user', roles: ['agent', 'customer'], limiter: 'order' }, async (c) => {
  const { company, user, req } = need(c)
  const { fields, files } = await readMultipart(req)
  const res = await submitJoinRequest(company, user, fields, () => savePrivateImage(files.nic_front, 'nic_front'), () => savePrivateImage(files.nic_back, 'nic_back'))
  return NextResponse.json(res.dto, { status: res.created ? 201 : 200 })
})
