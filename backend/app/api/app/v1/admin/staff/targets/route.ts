import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError, only, readJson, reqStr } from '@/lib/app/http'
import { loadOrg, readTargetBody, setTarget, targetHistory } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const staffId = req.nextUrl.searchParams.get('staff_id')
    if (!staffId) fail(400, 'VALIDATION', 'staff_id is required')
    return NextResponse.json({ items: await targetHistory(company, staffId) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return handleError(err) }
}

// Closes the active row for (person, month) and adds a new one: history is never overwritten.
export async function POST(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const b = await readJson(req)
    only(b, ['staff_id', 'period', 'amount', 'registrations_target'])
    const staffId = reqStr(b.staff_id, 'staff_id', 1, 191)
    if (!(await loadOrg(company)).byStaff.has(staffId)) fail(404, 'NOT_FOUND', 'Not found')
    const t = readTargetBody(b)
    return NextResponse.json({ ok: true, ...(await setTarget(company, null, staffId, t.period, t.amount, t.regs)) })
  } catch (err) { return handleError(err) }
}
