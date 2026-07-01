import type { NextRequest } from 'next/server'
import { verifyAccessToken, type TokenPayload, type Portal } from './jwt'
import { NextResponse } from 'next/server'

// ─── Extract bearer token from Authorization header ───────────────────────────
export function extractToken(req: NextRequest): string | null {
  const header = req.headers.get('authorization') || ''
  if (!header.startsWith('Bearer ')) return null
  return header.slice(7)
}

// ─── Authenticate and return payload, or 401 response ───────────────────────
export function authenticate(req: NextRequest): { payload: TokenPayload } | { error: NextResponse } {
  const token = extractToken(req)
  if (!token) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const payload = verifyAccessToken(token)
  if (!payload) return { error: NextResponse.json({ error: 'Token invalid or expired' }, { status: 401 }) }
  return { payload }
}

// ─── Require specific portal type ─────────────────────────────────────────────
export function requirePortal(
  req: NextRequest, portals: Portal[]
): { payload: TokenPayload } | { error: NextResponse } {
  const result = authenticate(req)
  if ('error' in result) return result
  if (!portals.includes(result.payload.portal)) {
    return { error: NextResponse.json({ error: 'Forbidden: wrong portal' }, { status: 403 }) }
  }
  return result
}

// ─── Require superadmin ───────────────────────────────────────────────────────
export function requireSuperAdmin(req: NextRequest): { payload: TokenPayload } | { error: NextResponse } {
  return requirePortal(req, ['superadmin'])
}

// ─── Require company admin or superadmin ─────────────────────────────────────
export function requireAdmin(req: NextRequest): { payload: TokenPayload } | { error: NextResponse } {
  return requirePortal(req, ['admin', 'superadmin'])
}

// ─── Check permission within a company admin session ─────────────────────────
export function hasPermission(payload: TokenPayload, permission: string): boolean {
  if (payload.portal === 'superadmin') return true
  const perms = payload.permissions || {}
  return Boolean((perms as Record<string,unknown>).all) || Boolean((perms as Record<string,unknown>)[permission])
}

// ─── Require specific permission ──────────────────────────────────────────────
export function requirePermission(
  req: NextRequest,
  permission: string
): { payload: TokenPayload } | { error: NextResponse } {
  const result = requireAdmin(req)
  if ('error' in result) return result
  if (!hasPermission(result.payload, permission)) {
    return { error: NextResponse.json({ error: `Forbidden: requires ${permission} permission` }, { status: 403 }) }
  }
  return result
}

// ─── RBAC role definitions ────────────────────────────────────────────────────
export const ROLES = {
  SUPER_ADMIN:      { name: 'Super Admin',     permissions: { all: true } },
  COMPANY_ADMIN:    { name: 'Company Admin',   permissions: { all: true } },
  BRANCH_MANAGER:   { name: 'Branch Manager',  permissions: { pos: true, inventory: true, reports: true, customers: true, employees: true } },
  CASHIER:          { name: 'Cashier',          permissions: { pos: true, customers: true } },
  WAREHOUSE_STAFF:  { name: 'Warehouse Staff',  permissions: { inventory: true, transfers: true } },
  DELIVERY_STAFF:   { name: 'Delivery Staff',   permissions: { deliveries: true } },
} as const

export type RoleName = keyof typeof ROLES

// ─── Audit log helper ────────────────────────────────────────────────────────
import { pool } from './db'
import { randomUUID } from 'crypto'

export async function auditLog(params: {
  portal: string; actorType: string; actorId: string; actorName?: string
  companyId?: string | null; action: string; resource?: string; resourceId?: string
  oldValues?: unknown; newValues?: unknown; ip?: string; userAgent?: string
}) {
  try {
    await pool.query(
      `INSERT INTO saas_audit_logs
         (id, portal, actor_type, actor_id, actor_name, company_id, action,
          resource, resource_id, old_values, new_values, ip_address, user_agent)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        randomUUID(),
        params.portal, params.actorType, params.actorId, params.actorName ?? null,
        params.companyId ?? null, params.action, params.resource ?? null,
        params.resourceId ?? null,
        params.oldValues ? JSON.stringify(params.oldValues) : null,
        params.newValues ? JSON.stringify(params.newValues) : null,
        params.ip ?? null, params.userAgent ?? null,
      ]
    )
  } catch { /* non-blocking */ }
}
