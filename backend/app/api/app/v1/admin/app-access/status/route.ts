import { NextRequest, NextResponse } from 'next/server'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { fail, handleError, only, oneOf, reqStr } from '@/lib/app/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const body = await req.json().catch(() => ({})) as Record<string, unknown>
    only(body, ['user_id', 'status'])
    const userId = reqStr(body.user_id, 'user_id', 1, 191)
    const status = oneOf(body.status, 'status', ['active', 'disabled'] as const)
    const r = await company.tp.query(`UPDATE app_users SET status = ?, failed_logins = 0, locked_until = NULL WHERE id = ? AND deleted_at IS NULL`, [status, userId])
    if (Number((r.rows as unknown as { affectedRows?: number }).affectedRows) === 0) fail(404, 'NOT_FOUND', 'User not found')
    if (status === 'disabled') {
      await company.tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [userId]).catch(() => undefined)
    }
    return NextResponse.json({ ok: true })
  } catch (err) {
    return handleError(err)
  }
}
