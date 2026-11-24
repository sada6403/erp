import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { handleError, parseJson, toIso } from '@/lib/app/http'
import type { AppRole } from '@/lib/app/contracts/common'
import type { AppAccessListResponse } from '@/lib/app/contracts/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const { rows } = await company.tp.query<Record<string, unknown>>(
      `SELECT u.id, u.name, u.phone, u.member_no, u.roles, u.status, u.must_change_password, u.last_login_at, a.code AS agent_code,
              (SELECT d.status FROM app_credential_dispatches d WHERE d.user_id = u.id ORDER BY d.created_at DESC LIMIT 1) AS last_dispatch_status,
              (SELECT d.created_at FROM app_credential_dispatches d WHERE d.user_id = u.id ORDER BY d.created_at DESC LIMIT 1) AS last_dispatch_at,
              (SELECT r.id FROM app_password_reset_requests r WHERE r.user_id = u.id AND r.status = 'pending' ORDER BY r.requested_at DESC LIMIT 1) AS pending_reset
         FROM app_users u LEFT JOIN agents a ON a.id = u.agent_id WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 1000`)
    const out: AppAccessListResponse = {
      items: rows.map(u => ({
        user_id: String(u.id), name: String(u.name), phone: u.phone ? String(u.phone) : null, member_no: u.member_no ? String(u.member_no) : null,
        agent_code: u.agent_code ? String(u.agent_code) : null, roles: parseJson<AppRole[]>(u.roles, []),
        status: (['locked', 'disabled'].includes(String(u.status)) ? String(u.status) : 'active') as 'active' | 'locked' | 'disabled',
        must_change_password: Number(u.must_change_password) === 1, last_login_at: toIso(u.last_login_at),
        last_dispatch_status: u.last_dispatch_status ? String(u.last_dispatch_status) : null, last_dispatch_at: toIso(u.last_dispatch_at),
        pending_reset_request_id: u.pending_reset ? String(u.pending_reset) : null,
      })),
    }
    return NextResponse.json(out, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return handleError(err)
  }
}
