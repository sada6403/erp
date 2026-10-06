import { NextRequest, NextResponse } from 'next/server'
import { AccountStatusError, DeviceAuthorizationError, resolveCompany, resolveDeviceAuthorization } from '@/lib/auth'
import { clearTenantBusinessData, verifyClearDataPassword } from '@/lib/clearData'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  let company
  try {
    company = await resolveCompany(request)
  } catch (error) {
    if (error instanceof AccountStatusError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }
  if (!company) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await resolveDeviceAuthorization(request, company.id)
  } catch (error) {
    if (error instanceof DeviceAuthorizationError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 403 })
    }
    throw error
  }

  let body: { password?: string; cleared_by?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }
  if (!body.password) return NextResponse.json({ error: 'password is required' }, { status: 400 })

  const verified = await verifyClearDataPassword(company.id, body.password)
  if (!verified.success) return NextResponse.json(verified)

  try {
    const clearedBy = String(body.cleared_by || '').trim().slice(0, 255) || null
    const clearEventId = await clearTenantBusinessData(company, clearedBy)
    return NextResponse.json({ success: true, clear_event_id: clearEventId })
  } catch (error) {
    console.error('[company/clear-data]', error)
    return NextResponse.json({ error: 'Failed to clear company data. Nothing was deleted.' }, { status: 500 })
  }
}
