import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError, oneOf, only, optStr, readJson } from '@/lib/app/http'
import { decideJoinRequest } from '@/lib/app/joinLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const company = await resolveAdminCompany(req)
    const { id } = await ctx.params
    const b = await readJson(req)
    only(b, ['decision', 'reason', 'decided_by'])
    const decision = oneOf(b.decision, 'decision', ['approve', 'reject'] as const)
    const out = await decideJoinRequest(company, id, decision, optStr(b.reason, 'reason', 300), optStr(b.decided_by, 'decided_by', 100))
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
