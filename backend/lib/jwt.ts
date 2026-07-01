import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { randomUUID } from 'crypto'
import { pool } from './db'

const ACCESS_SECRET  = process.env.JWT_SECRET         || 'change-me-in-production'
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'change-refresh-in-production'
const ACCESS_TTL     = '15m'
const REFRESH_TTL_MS = 30 * 24 * 60 * 60 * 1000

export type Portal = 'superadmin' | 'admin' | 'pos'

export interface TokenPayload {
  sub:          string
  portal:       Portal
  company_id:   string | null
  name:         string
  email:        string
  role?:        string
  permissions?: Record<string, unknown>
  iat?:         number
  exp?:         number
}

export function signAccessToken(payload: Omit<TokenPayload, 'iat' | 'exp'>): string {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL })
}

export async function issueRefreshToken(
  payload: Omit<TokenPayload, 'iat' | 'exp'>,
  meta: { ip?: string; userAgent?: string }
): Promise<string> {
  const raw  = crypto.randomBytes(64).toString('hex')
  const hash = crypto.createHash('sha256').update(raw).digest('hex')
  const exp  = new Date(Date.now() + REFRESH_TTL_MS)

  await pool.query(
    `INSERT INTO refresh_tokens (id, token_hash, portal, user_id, company_id, ip_address, user_agent, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [randomUUID(), hash, payload.portal, payload.sub, payload.company_id, meta.ip ?? null, meta.userAgent ?? null, exp]
  )

  return jwt.sign({ raw }, REFRESH_SECRET, { expiresIn: '30d' })
}

export async function rotateRefreshToken(
  refreshJwt: string,
  meta: { ip?: string; userAgent?: string }
): Promise<{ accessToken: string; refreshToken: string; payload: TokenPayload } | null> {
  let decoded: { raw: string }
  try {
    decoded = jwt.verify(refreshJwt, REFRESH_SECRET) as { raw: string }
  } catch {
    return null
  }

  const hash = crypto.createHash('sha256').update(decoded.raw).digest('hex')
  const { rows } = await pool.query(
    `SELECT * FROM refresh_tokens WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > NOW()`,
    [hash]
  )
  if (!rows.length) return null

  const stored = rows[0] as Record<string, string>
  await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?`, [hash])

  let tokenPayload: TokenPayload | null = null

  if (stored.portal === 'superadmin') {
    const { rows: sa } = await pool.query(
      `SELECT id, name, email FROM superadmins WHERE id = ?`, [stored.user_id]
    )
    if (!sa.length) return null
    const s = sa[0] as Record<string, string>
    tokenPayload = { sub: s.id, portal: 'superadmin', company_id: null, name: s.name, email: s.email }

  } else if (stored.portal === 'admin') {
    // Query inside tenant database
    const { rows: companies } = await pool.query(
      `SELECT db_schema FROM companies WHERE id = ?`, [stored.company_id]
    )
    if (!companies.length) return null
    const { tenantPool } = await import('./db')
    const tp = tenantPool((companies[0] as Record<string, string>).db_schema)
    const { rows: admin } = await tp.query(
      `SELECT u.*, r.name as role_name, r.permissions FROM users u
       JOIN roles r ON r.id = u.role_id WHERE u.id = ?`,
      [stored.user_id]
    )
    if (!admin.length) return null
    const u = admin[0] as Record<string, unknown>
    const perms = typeof u.permissions === 'string' ? JSON.parse(u.permissions as string) : u.permissions
    tokenPayload = {
      sub: u.id as string, portal: 'admin', company_id: stored.company_id,
      name: u.name as string, email: u.email as string,
      role: u.role_name as string, permissions: perms,
    }
  }

  if (!tokenPayload) return null

  const accessToken  = signAccessToken(tokenPayload)
  const refreshToken = await issueRefreshToken(tokenPayload, meta)
  return { accessToken, refreshToken, payload: tokenPayload }
}

export function verifyAccessToken(token: string): TokenPayload | null {
  try {
    return jwt.verify(token, ACCESS_SECRET) as TokenPayload
  } catch {
    return null
  }
}

export async function revokeAllTokens(portal: Portal, userId: string): Promise<void> {
  await pool.query(
    `UPDATE refresh_tokens SET revoked_at = NOW() WHERE portal = ? AND user_id = ? AND revoked_at IS NULL`,
    [portal, userId]
  )
}
