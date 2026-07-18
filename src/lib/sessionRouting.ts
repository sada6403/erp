import type { AuthUser } from '@/types'

export type SessionRoleKind =
  | 'owner'
  | 'branchManager'
  | 'subBranchManager'
  | 'cashier'
  | 'storeKeeper'
  | 'accountant'

type SessionProfile = {
  kind: SessionRoleKind
  portal: string
  scopeLevel: string
  permissions: Record<string, boolean>
}

function readPermissions(user?: AuthUser | null): Record<string, boolean> {
  return ((user?.role?.permissions ?? user?.permissions ?? {}) as Record<string, boolean>) || {}
}

export function getSessionProfile(user?: AuthUser | null): SessionProfile {
  const permissions = readPermissions(user)
  const portal = String(user?.portal || '').toLowerCase()
  const scopeLevel = String(user?.scope?.level || '').toLowerCase()

  if (permissions.all || scopeLevel === 'owner' || portal === 'superadmin') {
    return { kind: 'owner', portal, scopeLevel, permissions }
  }
  if (portal === 'pos') {
    return { kind: 'cashier', portal, scopeLevel, permissions }
  }
  if (scopeLevel === 'branch') {
    return { kind: 'branchManager', portal, scopeLevel, permissions }
  }
  if (scopeLevel === 'subbranch') {
    if (permissions.reports && !permissions.inventory && !permissions.pos) return { kind: 'accountant', portal, scopeLevel, permissions }
    if (permissions.inventory && !permissions.reports && !permissions.pos) return { kind: 'storeKeeper', portal, scopeLevel, permissions }
    if (permissions.pos && !permissions.inventory && !permissions.reports) return { kind: 'cashier', portal, scopeLevel, permissions }
    return { kind: 'subBranchManager', portal, scopeLevel, permissions }
  }
  if (permissions.reports && !permissions.inventory && !permissions.pos) return { kind: 'accountant', portal, scopeLevel, permissions }
  if (permissions.inventory && !permissions.reports && !permissions.pos) return { kind: 'storeKeeper', portal, scopeLevel, permissions }
  if (permissions.pos && !permissions.inventory && !permissions.reports) return { kind: 'cashier', portal, scopeLevel, permissions }
  return { kind: 'branchManager', portal, scopeLevel, permissions }
}

export function getLandingRoute(user?: AuthUser | null): string {
  const profile = getSessionProfile(user)
  switch (profile.kind) {
    case 'cashier':
      return '/pos'
    case 'accountant':
      return '/admin/reports'
    case 'storeKeeper':
      return '/admin/stock-intelligence'
    default:
      return '/admin'
  }
}

export function getHomeLabel(kind: SessionRoleKind): string {
  switch (kind) {
    case 'cashier':
      return 'Billing'
    case 'accountant':
      return 'Reports'
    case 'storeKeeper':
      return 'Stock'
    default:
      return 'Dashboard'
  }
}
