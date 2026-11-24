import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError } from '@/lib/app/http'
import { adminJoinList } from '@/lib/app/joinLib'
import type { AdminJoinRequestsResponse } from '@/lib/app/contracts/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const out: AdminJoinRequestsResponse = { items: await adminJoinList(company, req.nextUrl.searchParams.get('status')) }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
