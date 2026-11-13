import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError, only, readJson } from '@/lib/app/http'
import { adminAssign, adminAssignments, adminUnassign } from '@/lib/app/staffLib'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POS desktop (company key): the hierarchy page. Every change is audited and history is kept (old row is closed).
export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    return NextResponse.json(await adminAssignments(company), { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) { return handleError(err) }
}

export async function POST(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const b = await readJson(req)
    only(b, ['staff_id', 'level_key', 'reports_to_staff_id', 'scope_type', 'scope_id'])
    return NextResponse.json({ ok: true, ...(await adminAssign(company, null, b)) })
  } catch (err) { return handleError(err) }
}

export async function DELETE(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const staffId = req.nextUrl.searchParams.get('staff_id')
    if (!staffId) fail(400, 'VALIDATION', 'staff_id is required')
    await adminUnassign(company, null, staffId)
    return NextResponse.json({ ok: true })
  } catch (err) { return handleError(err) }
}
