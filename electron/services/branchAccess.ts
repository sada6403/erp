import type Database from 'better-sqlite3'

export const DEFAULT_MAIN_BRANCH_ID = 'b1111111-1111-4111-8111-111111111111'

export function permissionsFor(user: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!user) return {}
  return ((user.role as Record<string, unknown> | undefined)?.permissions as Record<string, unknown>)
    || (user.permissions as Record<string, unknown>)
    || {}
}

export function isCompanyAdmin(user: Record<string, unknown> | undefined): boolean {
  if (!user) return false
  const roleName = String((user.role as Record<string, unknown> | undefined)?.name || user.role_name || '').toLowerCase()
  return Boolean(permissionsFor(user).all) || roleName === 'company admin' || roleName === 'super admin' || roleName === 'admin' || roleName === 'owner'
}

export function resolveMainBranchId(db: Database.Database): string {
  const branch = db.prepare(`
    SELECT id
    FROM branches
    WHERE is_active = 1 AND (
      id = ?
      OR UPPER(COALESCE(code, '')) IN ('MAIN', 'CMB')
      OR LOWER(name) LIKE '%main%'
      OR LOWER(name) LIKE '%colombo%'
      OR LOWER(name) LIKE '%head office%'
      OR LOWER(name) LIKE '%hq%'
    )
    ORDER BY CASE
      WHEN id = ? THEN 0
      WHEN UPPER(COALESCE(code, '')) IN ('MAIN', 'CMB') THEN 1
      WHEN LOWER(name) LIKE '%main%' OR LOWER(name) LIKE '%colombo%'
        OR LOWER(name) LIKE '%head office%' OR LOWER(name) LIKE '%hq%' THEN 2
      ELSE 3
    END, created_at, name
    LIMIT 1
  `).get(DEFAULT_MAIN_BRANCH_ID, DEFAULT_MAIN_BRANCH_ID) as { id: string } | undefined
  return branch?.id || DEFAULT_MAIN_BRANCH_ID
}

export function isMainBranchUser(db: Database.Database, user: Record<string, unknown> | undefined): boolean {
  if (isCompanyAdmin(user)) return true
  const branchId = String(user?.branch_id || '')
  return Boolean(branchId && branchId === resolveMainBranchId(db))
}

export function canManageAllBranchStock(db: Database.Database, user: Record<string, unknown> | undefined): boolean {
  return isCompanyAdmin(user) || (isMainBranchUser(db, user) && Boolean(permissionsFor(user).inventory))
}

export function canManageProcurement(db: Database.Database, user: Record<string, unknown> | undefined): boolean {
  return canManageAllBranchStock(db, user)
}
