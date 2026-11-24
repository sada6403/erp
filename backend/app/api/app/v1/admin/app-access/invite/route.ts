import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { resolveAdminCompany } from '@/lib/app/adminLib'
import { AppHttpError, fail, handleError, optStr, parseJson, readJson } from '@/lib/app/http'
import { flag } from '@/lib/app/settings'
import { generateTempPassword, hashPassword, normalizePhone, toWhatsAppNumber } from '@/lib/app/security'
import type { AppRole } from '@/lib/app/contracts/common'
import type { InviteResponse, InviteResultDto, InviteTarget } from '@/lib/app/contracts/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TEMP_DAYS = 7

export async function POST(req: NextRequest) {
  try {
    const company = await resolveAdminCompany(req)
    const body = await readJson(req)
    const targets = Array.isArray(body.targets) ? (body.targets as InviteTarget[]) : []
    if (!targets.length || targets.length > 100) fail(400, 'VALIDATION', 'targets must have 1-100 entries')
    const link = optStr(body.download_link, 'download_link', 300)
    const sentBy = optStr(body.sent_by, 'sent_by', 100)
    const tp = company.tp
    const results: InviteResultDto[] = []

    for (const t of targets) {
      const target: InviteTarget = t.agent_id ? { agent_id: String(t.agent_id) } : { customer_id: String(t.customer_id || '') }
      let name = '', rawPhone: string | null = null
      let agentId: string | null = null, customerId: string | null = null
      let agentCode: string | null = null
      const roles: AppRole[] = []
      if (target.agent_id) {
        const r = await tp.query<Record<string, unknown>>(`SELECT id, code, name, phone FROM agents WHERE id = ?`, [target.agent_id])
        if (!r.rows[0]) { results.push({ target, ok: false, skipped_reason: 'NOT_FOUND' }); continue }
        name = String(r.rows[0].name); rawPhone = r.rows[0].phone ? String(r.rows[0].phone) : null
        agentId = String(r.rows[0].id); agentCode = String(r.rows[0].code); roles.push('agent')
      } else {
        const r = await tp.query<Record<string, unknown>>(`SELECT id, name, phone FROM customers WHERE id = ?`, [target.customer_id])
        if (!r.rows[0]) { results.push({ target, ok: false, skipped_reason: 'NOT_FOUND' }); continue }
        name = String(r.rows[0].name); rawPhone = r.rows[0].phone ? String(r.rows[0].phone) : null
        customerId = String(r.rows[0].id); roles.push('customer')
        const m = await tp.query(`SELECT 1 FROM chit_members WHERE customer_id = ? LIMIT 1`, [customerId])
        if (m.rows[0]) roles.push('smartbuy')
      }
      const phone = rawPhone ? normalizePhone(rawPhone) : null
      if (!phone) { results.push({ target, ok: false, name, skipped_reason: 'NO_VALID_PHONE' }); continue }

      // member_no: paper reference code, else generated NP-<n>
      let memberNo: string | null = null
      if (customerId) {
        const pr = await tp.query<Record<string, unknown>>(
          `SELECT paper_reference_code FROM chit_members WHERE customer_id = ? AND paper_reference_code IS NOT NULL AND paper_reference_code <> '' LIMIT 1`, [customerId])
        memberNo = pr.rows[0] ? String(pr.rows[0].paper_reference_code).toUpperCase() : null
      }

      const temp = generateTempPassword()
      const hash = await hashPassword(temp)
      const existing = await tp.query<Record<string, unknown>>(`SELECT id, roles, member_no FROM app_users WHERE phone = ? AND deleted_at IS NULL LIMIT 1`, [phone])
      let userId: string
      if (existing.rows[0]) {
        userId = String(existing.rows[0].id)
        const merged = Array.from(new Set([...parseJson<AppRole[]>(existing.rows[0].roles, []), ...roles]))
        memberNo = memberNo || (existing.rows[0].member_no ? String(existing.rows[0].member_no) : null)
        await tp.query(
          `UPDATE app_users SET name = ?, password_hash = ?, must_change_password = 1, temp_password_expires_at = DATE_ADD(NOW(), INTERVAL ${TEMP_DAYS} DAY),
             roles = ?, customer_id = COALESCE(?, customer_id), agent_id = COALESCE(?, agent_id), member_no = ?, status = 'active', failed_logins = 0, locked_until = NULL
           WHERE id = ?`, [name, hash, JSON.stringify(merged), customerId, agentId, memberNo, userId])
        roles.splice(0, roles.length, ...merged)
      } else {
        userId = randomUUID()
        if (!memberNo && customerId) {
          const n = await tp.query<Record<string, unknown>>(`SELECT COUNT(*) AS n FROM app_users WHERE member_no LIKE 'NP-%'`)
          let seq = Number(n.rows[0]?.n || 0) + 1
          for (;;) {
            const cand = `NP-${seq}`
            const dup = await tp.query(`SELECT 1 FROM app_users WHERE member_no = ? LIMIT 1`, [cand])
            if (!dup.rows[0]) { memberNo = cand; break }
            seq++
          }
        }
        await tp.query(
          `INSERT INTO app_users (id, phone, member_no, name, password_hash, must_change_password, temp_password_expires_at, customer_id, agent_id, roles, status, created_by_source)
           VALUES (?, ?, ?, ?, ?, 1, DATE_ADD(NOW(), INTERVAL ${TEMP_DAYS} DAY), ?, ?, ?, 'active', 'invite')`,
          [userId, phone, memberNo, name, hash, customerId, agentId, JSON.stringify(roles)])
      }

      // Pending "forgot password" requests for this user are now handled.
      await tp.query(`UPDATE app_password_reset_requests SET status = 'resolved', resolved_at = NOW(), resolved_by = ? WHERE user_id = ? AND status = 'pending'`, [sentBy, userId])
      await tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [userId]).catch(() => undefined)

      const loginIds = [phone, ...(memberNo ? [memberNo] : []), ...(agentCode ? [agentCode] : [])]
      const message =
        `Hello ${name}, your ${company.name} app account is ready.\n` +
        (link ? `Download: ${link}\n` : '') +
        `Login: ${loginIds.join(' or ')}\nTemporary password: ${temp}\n` +
        `You will be asked to set a new password at first login (valid ${TEMP_DAYS} days).`
      const dispatchId = randomUUID()
      // Cloud API sending stays behind a flag and is NOT implemented in this run: click-to-chat only.
      const channel = flag(process.env.WHATSAPP_CLOUD_API_ENABLED) ? 'whatsapp_api' : 'whatsapp_click'
      await tp.query(
        `INSERT INTO app_credential_dispatches (id, user_id, channel, status, sent_by) VALUES (?, ?, 'whatsapp_click', 'prepared', ?)`,
        [dispatchId, userId, sentBy])
      results.push({
        target, ok: true, user_id: userId, name, phone, login_ids: loginIds, roles, message,
        whatsapp_url: `https://wa.me/${toWhatsAppNumber(phone)}?text=${encodeURIComponent(message)}`, dispatch_id: dispatchId,
      })
      void channel
    }
    const res: InviteResponse = { results, channel: 'whatsapp_click' }
    return NextResponse.json(res, { headers: { 'Cache-Control': 'no-store' } })
  } catch (err) {
    return err instanceof AppHttpError ? handleError(err) : handleError(err)
  }
}
