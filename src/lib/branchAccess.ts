import type { AuthUser } from '@/types'

export const DEFAULT_MAIN_BRANCH_ID = 'b1111111-1111-4111-8111-111111111111'

export function isCompanyAdmin(user: AuthUser | null | undefined): boolean {
  return Boolean(user?.role?.permissions?.all || user?.permissions?.all)
}

export function isMainBranchRecord(branch: { id?: unknown; code?: unknown; name?: unknown } | null | undefined): boolean {
  if (!branch) return false
  const id = String(branch.id || '')
  const code = String(branch.code || '').trim().toUpperCase()
  const name = String(branch.name || '').trim().toLowerCase()
  return id === DEFAULT_MAIN_BRANCH_ID || code === 'MAIN' || code === 'CMB' ||
    name.includes('main') || name.includes('colombo') || name.includes('head office') || name.includes('hq')
}

export function canManageAllBranchStock(user: AuthUser | null | undefined): boolean {
  if (isCompanyAdmin(user)) return true
  const branch = user?.branch || (user?.branch_id ? { id: user.branch_id } : undefined)
  return isMainBranchRecord(branch) && Boolean(user?.role?.permissions?.inventory || user?.permissions?.inventory)
}

/** Main-branch inventory controllers may correct stock for any selected branch. */
export function canManuallyEditBranchStock(
  user: AuthUser | null | undefined,
  branch: { id?: unknown; code?: unknown; name?: unknown } | null | undefined,
): boolean {
  return Boolean(branch) && canManageAllBranchStock(user)
}

export function canManageProcurement(user: AuthUser | null | undefined): boolean {
  return canManageAllBranchStock(user)
}
