// resolveAppCompany (x-app-key) + requireAppUser (JWT portal:'app') + route wrapper.
import { NextRequest, NextResponse } from 'next/server'
import jwt from 'jsonwebtoken'
import { createHmac } from 'crypto'
import { pool, tenantPool } from '../db'
import { ensureTenantCompatibility } from '../auth'
import { rateLimit } from '../rateLimit'
import type { AppRole } from './contracts/common'
import { AppHttpError, fail, handleError, originOf, parseJson, readJson } from './http'

export type AppCompany = {
  id: string
  dbSchema: string
  name: string
  slug: string
  tp: ReturnType<typeof tenantPool>
}

export type AppUserCtx = {
  userId: string
  roles: AppRole[]
  customerId: string | null
  agentId: string | null
  name: string
  phone: string | null
  email: string | null
  emailVerifiedAt: unknown
  phoneVerified: boolean
  language: 'en' | 'ta' | 'si'
  mustChangePassword: boolean
  memberNo: string | null
  agentCode: string | null
  passwordHash: string
  notificationSettings: Record<string, unknown>
}

// App tokens are signed with a secret derived from JWT_SECRET so that an app token can
// never validate as an admin/pos/superadmin token (and vice versa).
function appSecret(): string {
  return createHmac('sha256', process.env.JWT_SECRET || 'change-me-in-production').update('app-access-v1').digest('hex')
}
export function appSecretFor(purpose: string): string {
  return createHmac('sha256', process.env.JWT_SECRET || 'change-me-in-production').update(purpose).digest('hex')
}

export const ACCESS_TTL_SECONDS = 15 * 60

export function signAppAccessToken(p: { userId: string; companyId: string; roles: AppRole[]; customerId: string | null; agentId: string | null }): string {
  return jwt.sign(
    { sub: p.userId, portal: 'app', company_id: p.companyId, roles: p.roles, customer_id: p.customerId, agent_id: p.agentId },
    appSecret(),
    { expiresIn: ACCESS_TTL_SECONDS }
  )
}

export async function resolveAppCompany(req: NextRequest): Promise<AppCompany> {
  // NEVER accepts x-api-key (the POS sync key).
  const key = req.headers.get('x-app-key')
  if (!key || key.length > 80) fail(401, 'APP_KEY_INVALID', 'Unknown app')
  const { rows } = await pool.query(
    `SELECT id, db_schema, name, slug, status FROM companies
      WHERE app_key = ? OR (previous_app_key = ? AND previous_app_key_expires_at > NOW())
      LIMIT 1`,
    [key, key]
  )
  if (!rows.length) fail(401, 'APP_KEY_INVALID', 'Unknown app')
  const c = rows[0] as Record<string, string>
  if (c.status === 'suspended' || c.status === 'cancelled') fail(403, 'COMPANY_SUSPENDED', 'This service is unavailable. Contact your branch.')
  if (!['active', 'trial'].includes(c.status)) fail(401, 'APP_KEY_INVALID', 'Unknown app')
  await ensureTenantCompatibility(c.db_schema)
  return { id: c.id, dbSchema: c.db_schema, name: c.name, slug: c.slug, tp: tenantPool(c.db_schema) }
}

type TenantQuery = Pick<AppCompany['tp'], 'query'>

/**
 * True when the POS has deactivated the agent record behind an app user. Such a user keeps no agent access;
 * if agent was their only role the whole account is treated as disabled.
 */
export async function agentDeactivated(tp: TenantQuery, agentId: unknown): Promise<boolean> {
  if (!agentId) return false
  const { rows } = await tp.query<{ status: string | null }>(`SELECT status FROM agents WHERE id = ? LIMIT 1`, [String(agentId)])
  return !!rows[0] && String(rows[0].status ?? 'active') !== 'active'
}

export async function requireAppUser(
  req: NextRequest,
  company: AppCompany,
  roles?: AppRole[],
  opts: { allowPasswordChangePending?: boolean } = {}
): Promise<AppUserCtx> {
  const header = req.headers.get('authorization') || ''
  const m = /^Bearer\s+(.+)$/i.exec(header)
  if (!m) fail(401, 'UNAUTHORIZED', 'Sign in required')
  let payload: jwt.JwtPayload
  try {
    payload = jwt.verify(m[1], appSecret()) as jwt.JwtPayload
  } catch (e) {
    if (e instanceof jwt.TokenExpiredError) fail(401, 'TOKEN_EXPIRED', 'Session expired')
    fail(401, 'UNAUTHORIZED', 'Sign in required')
  }
  if (payload.portal !== 'app' || payload.company_id !== company.id || typeof payload.sub !== 'string') {
    fail(401, 'UNAUTHORIZED', 'Sign in required')
  }
  // Roles and ownership ids are re-read from the DB on every request (the token is only an identity).
  const { rows } = await company.tp.query(
    `SELECT u.*, a.code AS agent_code FROM app_users u
       LEFT JOIN agents a ON a.id = u.agent_id
      WHERE u.id = ? AND u.deleted_at IS NULL LIMIT 1`,
    [payload.sub]
  )
  const u = rows[0] as Record<string, unknown> | undefined
  if (!u) fail(401, 'UNAUTHORIZED', 'Sign in required')
  if (u.status === 'disabled') fail(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact your branch.')
  if (u.status === 'locked') fail(403, 'ACCOUNT_LOCKED', 'This account is locked.')
  let userRoles = parseJson<AppRole[]>(u.roles, [])
  let agentId: string | null = u.agent_id ? String(u.agent_id) : null
  if (agentId && await agentDeactivated(company.tp, agentId)) {
    userRoles = userRoles.filter(r => r !== 'agent')
    agentId = null
    if (!userRoles.length) fail(403, 'ACCOUNT_DISABLED', 'This account is disabled. Contact your branch.')
  }
  const mustChange = Number(u.must_change_password) === 1
  if (mustChange && !opts.allowPasswordChangePending) fail(403, 'PASSWORD_CHANGE_REQUIRED', 'Please set a new password first.')
  if (roles && !roles.some(r => userRoles.includes(r))) fail(403, 'FORBIDDEN', 'Not allowed for this account')
  const lang = String(u.language || 'en')
  return {
    userId: String(u.id),
    roles: userRoles,
    customerId: u.customer_id ? String(u.customer_id) : null,
    agentId,
    name: String(u.name),
    phone: u.phone ? String(u.phone) : null,
    email: u.email ? String(u.email) : null,
    emailVerifiedAt: u.email_verified_at ?? null,
    phoneVerified: Number(u.phone_verified) === 1,
    language: (['en', 'ta', 'si'].includes(lang) ? lang : 'en') as 'en' | 'ta' | 'si',
    mustChangePassword: mustChange,
    memberNo: u.member_no ? String(u.member_no) : null,
    agentCode: u.agent_code ? String(u.agent_code) : null,
    passwordHash: String(u.password_hash),
    notificationSettings: parseJson<Record<string, unknown>>(u.notification_settings, {}),
  }
}

// ── Rate limits (reuse rateLimit.ts) ────────────────────────────────────
export const appLimiters = {
  auth: rateLimit({ limit: 30, windowMs: 15 * 60 * 1000, keyPrefix: 'app-auth' }),
  general: rateLimit({ limit: 300, windowMs: 60 * 1000, keyPrefix: 'app' }),
  order: rateLimit({ limit: 20, windowMs: 10 * 60 * 1000, keyPrefix: 'app-order' }),
  otp: rateLimit({ limit: 15, windowMs: 10 * 60 * 1000, keyPrefix: 'app-otp' }),
}

export type RouteCtx = {
  req: NextRequest
  company: AppCompany
  user: AppUserCtx
  params: Record<string, string>
  origin: string
  body: () => Promise<Record<string, unknown>>
}
export type PublicRouteCtx = Omit<RouteCtx, 'user'> & { user: AppUserCtx | null }

type Opts = {
  /** 'none' = App Key only (public); 'optional' = token used if present; otherwise required */
  auth?: 'none' | 'optional' | 'user'
  roles?: AppRole[]
  limiter?: keyof typeof appLimiters
  allowPasswordChangePending?: boolean
}

/** Standard pipeline: rate limit -> App Key -> JWT/role -> handler. Errors map to {error:{code,message}}. */
export function appRoute(
  opts: Opts,
  handler: (c: PublicRouteCtx) => Promise<NextResponse | Response | object>
) {
  return async (req: NextRequest, routeCtx: { params: Promise<Record<string, string>> }): Promise<NextResponse | Response> => {
    try {
      const limited = appLimiters[opts.limiter ?? 'general'](req)
      if (limited) {
        const retry = limited.headers.get('Retry-After') ?? '60'
        return new NextResponse(
          JSON.stringify({ error: { code: 'RATE_LIMITED', message: 'Too many requests. Try again later.' } }),
          { status: 429, headers: { 'content-type': 'application/json', 'Retry-After': retry } }
        )
      }
      const company = await resolveAppCompany(req)
      let user: AppUserCtx | null = null
      const mode = opts.auth ?? 'user'
      if (mode === 'user') {
        user = await requireAppUser(req, company, opts.roles, { allowPasswordChangePending: opts.allowPasswordChangePending })
      } else if (mode === 'optional' && req.headers.get('authorization')) {
        try { user = await requireAppUser(req, company, undefined, { allowPasswordChangePending: true }) } catch { user = null }
      }
      const params = routeCtx?.params ? await routeCtx.params : {}
      let cached: Record<string, unknown> | null = null
      const out = await handler({
        req, company, user, params, origin: originOf(req),
        body: async () => (cached ??= await readJson(req)),
      })
      if (out instanceof Response) return out
      return NextResponse.json(out)
    } catch (err) {
      if (err instanceof AppHttpError) return handleError(err)
      return handleError(err)
    }
  }
}

/** For handlers where the user is guaranteed (auth: 'user'). */
export function need(c: PublicRouteCtx): RouteCtx {
  if (!c.user) throw new AppHttpError(401, 'UNAUTHORIZED', 'Sign in required')
  return c as RouteCtx
}
