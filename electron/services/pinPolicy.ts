import bcrypt from 'bcryptjs'
import type Database from 'better-sqlite3'

// Same heuristic src/pages/admin/UsersPage.tsx already uses client-side to
// decide which login-method fields to show — mirrored here so it becomes a
// real backend rule instead of just a form convenience. Admin-type roles
// (Company Admin, or any role with reports/employees/settings/branches)
// sign in with email+password only; every other role (Cashier, Warehouse
// Staff, Delivery Staff, Agent, Smart Buy Manager, ...) is PIN-only.
export function isAdminTypeRole(permissions: Record<string, unknown>): boolean {
  return Boolean(
    permissions.all || permissions.reports || permissions.employees ||
    permissions.settings || permissions.branches
  )
}

// Shared by every place a login PIN gets set (admin:users:create/update,
// agents:createUserForAgent) so the rule is identical everywhere: 4-6 digits,
// and unique among the other active users of the same branch. A PIN can't be
// checked with a SQL UNIQUE constraint since it's stored bcrypt-hashed (salted
// — same PIN produces a different hash each time), so uniqueness is verified
// by comparing against each existing hash in the branch, same technique
// auth:pinLogin already uses to find a match.
export async function validatePin(
  db: Database.Database,
  pin: string,
  branchId: string | null | undefined,
  excludeUserId?: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!/^\d{4,6}$/.test(pin)) {
    return { ok: false, error: 'PIN must be 4-6 digits' }
  }
  if (!branchId) return { ok: true }

  const rows = db.prepare(`
    SELECT id, pin_hash, pin FROM users
    WHERE branch_id = ? AND is_active = 1 AND id != ?
  `).all(branchId, excludeUserId || '') as { id: string; pin_hash: string | null; pin: string | null }[]

  for (const row of rows) {
    if (row.pin_hash) {
      if (await bcrypt.compare(pin, row.pin_hash)) {
        return { ok: false, error: 'This PIN is already used by another user in this branch' }
      }
    } else if (row.pin && row.pin.trim() === pin) {
      return { ok: false, error: 'This PIN is already used by another user in this branch' }
    }
  }

  return { ok: true }
}
