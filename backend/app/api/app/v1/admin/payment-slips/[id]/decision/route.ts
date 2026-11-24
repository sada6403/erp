import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError, oneOf, only, optStr, readJson } from '@/lib/app/http'
import { decideSlip } from '@/lib/app/slipLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  try {
    const company = await resolveAdminCompany(req)
    const { id } = await ctx.params
    const b = await readJson(req)
    only(b, ['decision', 'reason', 'reviewed_by'])
    const decision = oneOf(b.decision, 'decision', ['verify', 'reject'] as const)
    const out = await decideSlip(company, id, decision, optStr(b.reason, 'reason', 300), optStr(b.reviewed_by, 'reviewed_by', 100))
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
