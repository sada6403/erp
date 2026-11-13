import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { appRoute } from '@/lib/app/context'
import { EMAIL_RE, fail, only, optStr, reqStr } from '@/lib/app/http'
import { queueEmail } from '@/lib/app/emailService'
import { assertPasswordPolicy, hashPassword, issueTokens, normalizePhone, toAuthUser } from '@/lib/app/security'
import type { RegisterResponse } from '@/lib/app/contracts/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const POST = appRoute({ auth: 'none', limiter: 'auth' }, async ({ company, body }) => {
  const b = await body()
  only(b, ['name', 'phone', 'password', 'email', 'device_id'])
  const name = reqStr(b.name, 'name', 2, 100)
  const phone = normalizePhone(reqStr(b.phone, 'phone', 7, 20))
  if (!phone) fail(400, 'VALIDATION', 'Enter a valid mobile number (07XXXXXXXX)')
  const password = assertPasswordPolicy(b.password)
  const email = optStr(b.email, 'email', 255)
  if (email && !EMAIL_RE.test(email)) fail(400, 'VALIDATION', 'Enter a valid email')
  const deviceId = optStr(b.device_id, 'device_id', 191)

  const dup = await company.tp.query(`SELECT id FROM app_users WHERE phone = ? LIMIT 1`, [phone])
  if (dup.rows[0]) fail(409, 'CONFLICT', 'This mobile number is already registered. Please sign in.')
  const id = randomUUID()
  try {
    await company.tp.query(
      `INSERT INTO app_users (id, phone, name, password_hash, must_change_password, email, phone_verified, roles, status, created_by_source)
       VALUES (?, ?, ?, ?, 0, ?, 0, ?, 'active', 'self')`,
      [id, phone, name, await hashPassword(password), email, JSON.stringify(['customer'])])
  } catch (e) {
    if (/Duplicate entry/i.test(String(e))) fail(409, 'CONFLICT', 'This mobile number is already registered. Please sign in.')
    throw e
  }
  const { rows } = await company.tp.query<Record<string, unknown>>(`SELECT * FROM app_users WHERE id = ?`, [id])
  if (email) await queueEmail(company.tp, { userId: id, type: 'welcome', entityId: id })
  const tokens = await issueTokens(company, rows[0], { deviceId })
  const out: RegisterResponse = { tokens, user: toAuthUser(rows[0], null), must_change_password: false }
  return NextResponse.json(out, { status: 201 })
})
