import { NextResponse } from 'next/server'
import { appRoute, need } from '@/lib/app/context'
import { readMultipart, savePrivateImage } from '@/lib/app/privateFiles'
import { listOwnSlips, submitSlip } from '@/lib/app/slipLib'
import type { OrderSlipsResponse } from '@/lib/app/contracts/orders'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const GET = appRoute({ auth: 'user', roles: ['customer'] }, async (c): Promise<OrderSlipsResponse> => {
  const { company, user, params } = need(c)
  return { items: await listOwnSlips(company, user, params.id) }
})

export const POST = appRoute({ auth: 'user', roles: ['customer'], limiter: 'order' }, async (c) => {
  const { company, user, params, req } = need(c)
  const { fields, files } = await readMultipart(req)
  const res = await submitSlip(company, user, params.id, fields, () => savePrivateImage(files.slip, 'slip'))
  return NextResponse.json(res.dto, { status: res.created ? 201 : 200 })
})
