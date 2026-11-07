// Passwords, phone normalisation, login identifier resolution, refresh tokens, user mapping.
import bcrypt from 'bcryptjs'
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto'
import type { AppCompany, AppUserCtx } from './context'
import { ACCESS_TTL_SECONDS, signAppAccessToken, appSecretFor } from './context'
import type { AppRole } from './contracts/common'
import type { AuthTokens, AuthUser } from './contracts/auth'
import { fail, parseJson } from './http'

const TEMP_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
export const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const MAX_FAILED_LOGINS = 5
export const LOCK_MINUTES = 15

export function generateTempPassword(): string {
  let s = ''
  for (let i = 0; i < 10; i++) s += TEMP_ALPHABET[randomInt(TEMP_ALPHABET.length)]
  return s
}

export function hashPassword(p: string): Promise<string> {
  return bcrypt.hash(p, 10)
}
export function verifyPassword(p: string, hash: string): Promise<boolean> {
  return bcrypt.compare(p, hash)
}
// Dummy hash so unknown identifiers cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', 10)
export function burnPasswordCheck(p: string): Promise<boolean> {
  return bcrypt.compare(p, DUMMY_HASH)
}

export function assertPasswordPolicy(p: unknown, field = 'password'): string {
  if (typeof p !== 'string' || p.length < 8 || p.length > 100) fail(400, 'VALIDATION', `${field} must be 8-100 characters`)
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) fail(400, 'VALIDATION', `${field} must contain a letter and a number`)
  return p
}

export function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex')
}

/** Sri Lankan mobile -> 07XXXXXXXX, or null. */
export function normalizePhone(raw: string): string | null {
  let d = String(raw || '').replace(/[^\d+]/g, '')
  d = d.replace(/^\+/, '')
  if (d.startsWith('0094')) d = d.slice(4)
  else if (d.startsWith('94') && d.length === 11) d = d.slice(2)
  if (d.length === 9) d = '0' + d
  return /^07\d{8}$/.test(d) ? d : null
}
export function toWhatsAppNumber(phone: string): string {
  return '94' + phone.slice(1)
}
export function maskPhone(p: string | null): string | null {
  if (!p) return null
  return p.length >= 8 ? p.slice(0, 3) + '****' + p.slice(-3) : '****'
}

/** Resolve phone / member number / agent code to ONE app_users row. */
export async function findUserByIdentifier(company: AppCompany, identifier: string): Promise<Record<string, unknown> | null> {
  const raw = String(identifier || '').trim()
  if (!raw || raw.length > 64) return null
  const tp = company.tp
  const phone = normalizePhone(raw)
  if (phone) {
    const { rows } = await tp.query(`SELECT * FROM app_users WHERE phone = ? AND deleted_at IS NULL LIMIT 1`, [phone])
    return (rows[0] as Record<string, unknown>) ?? null
  }
  const code = raw.replace(/\s+/g, '').toUpperCase()
  let r = await tp.query(`SELECT * FROM app_users WHERE UPPER(member_no) = ? AND deleted_at IS NULL LIMIT 1`, [code])
  if (r.rows[0]) return r.rows[0] as Record<string, unknown>
  r = await tp.query(
    `SELECT u.* FROM app_users u JOIN agents a ON a.id = u.agent_id
      WHERE UPPER(a.code) = ? AND u.deleted_at IS NULL LIMIT 1`, [code])
  if (r.rows[0]) return r.rows[0] as Record<string, unknown>
  r = await tp.query(
    `SELECT u.* FROM app_users u JOIN chit_members m ON m.customer_id = u.customer_id
      WHERE UPPER(m.paper_reference_code) = ? AND u.deleted_at IS NULL LIMIT 1`, [code])
  return (r.rows[0] as Record<string, unknown>) ?? null
}

export async function agentCodeOf(company: AppCompany, agentId: unknown): Promise<string | null> {
  if (!agentId) return null
  const { rows } = await company.tp.query(`SELECT code FROM agents WHERE id = ? LIMIT 1`, [agentId])
  return rows[0] ? String((rows[0] as Record<string, unknown>).code) : null
}

export function toAuthUser(row: Record<string, unknown>, agentCode: string | null): AuthUser {
  const lang = String(row.language || 'en')
  return {
    id: String(row.id),
    name: String(row.name),
    phone: row.phone ? String(row.phone) : null,
    email: row.email ? String(row.email) : null,
    email_verified: !!row.email_verified_at,
    roles: parseJson<AppRole[]>(row.roles, []),
    member_no: row.member_no ? String(row.member_no) : null,
    agent_code: agentCode,
    language: (['en', 'ta', 'si'].includes(lang) ? lang : 'en') as 'en' | 'ta' | 'si',
    must_change_password: Number(row.must_change_password) === 1,
    phone_verified: Number(row.phone_verified) === 1,
  }
}
export function ctxToAuthUser(u: AppUserCtx): AuthUser {
  return {
    id: u.userId, name: u.name, phone: u.phone, email: u.email, email_verified: !!u.emailVerifiedAt,
    roles: u.roles, member_no: u.memberNo, agent_code: u.agentCode, language: u.language,
    must_change_password: u.mustChangePassword, phone_verified: u.phoneVerified,
  }
}

/** Issue access JWT + a new rotating refresh token (new family unless one is given). */
export async function issueTokens(
  company: AppCompany,
  row: Record<string, unknown>,
  opts: { deviceId?: string | null; familyId?: string } = {}
): Promise<AuthTokens> {
  const userId = String(row.id)
  const access = signAppAccessToken({
    userId, companyId: company.id,
    roles: parseJson<AppRole[]>(row.roles, []),
    customerId: row.customer_id ? String(row.customer_id) : null,
    agentId: row.agent_id ? String(row.agent_id) : null,
  })
  const raw = 'rt_' + randomBytes(48).toString('hex')
  const id = randomUUID()
  await company.tp.query(
    `INSERT INTO app_refresh_tokens (id, user_id, token_hash, device_id, family_id, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, userId, sha256(raw), opts.deviceId ?? null, opts.familyId ?? randomUUID(), new Date(Date.now() + REFRESH_TTL_MS)]
  )
  return { access_token: access, refresh_token: raw, expires_in: ACCESS_TTL_SECONDS }
}

export async function revokeAllUserTokens(company: AppCompany, userId: string): Promise<void> {
  await company.tp.query(`UPDATE app_refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [userId])
}

/** Deterministic 4-digit delivery OTP for an order (no plaintext stored). */
export function deliveryOtp(orderId: string): string {
  const h = createHash('sha256').update(appSecretFor('delivery-otp') + ':' + orderId).digest()
  return String(h.readUInt32BE(0) % 10000).padStart(4, '0')
}
export function deliveryOtpHash(orderId: string): string {
  const salt = randomBytes(8).toString('hex')
  return `${salt}$${sha256(salt + deliveryOtp(orderId))}`
}
export function verifyDeliveryOtp(orderId: string, input: string): boolean {
  return /^\d{4}$/.test(input) && input === deliveryOtp(orderId)
}
