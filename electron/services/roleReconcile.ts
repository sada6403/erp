import type Database from 'better-sqlite3'

// Same root problem as electron/services/branchReconcile.ts, for `roles`
// instead of `branches`: the desktop app always seeds the 5 default roles
// locally with fixed, hardcoded UUIDs (see LOCAL_DEFAULT_ROLE_IDS below),
// before it's ever connected to the cloud (offline-first — the app must be
// usable standalone). The cloud independently generates a random UUID()
// for each tenant's default roles at company-creation time
// (backend/lib/tenant.ts's DEFAULT_ROLES_SQL). These are two different rows
// with two different ids for what is meant to be the same role — and
// unlike branches, this can silently misassign a real user's permissions
// (Issue 31's incident) rather than just create a duplicate row.
//
// Re-points every local reference from a placeholder default-role id to the
// real cloud role id for the same role name, so the local role BECOMES that
// role instead of coexisting alongside it. Only ever touches the 5 known
// default role names — a company's custom roles have no fixed local
// placeholder to begin with, so they're never in scope here and are never
// at risk of being merged/duplicated by this function.
export const LOCAL_DEFAULT_ROLE_IDS: Record<string, string> = {
  'Company Admin':   '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d',
  'Branch Manager':  '4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e',
  'Cashier':         '5c8d0e1f-3a4b-6c5d-0e1f-3a4b5c8d0e1f',
  'Warehouse Staff': '6d9e1f2a-4b5c-7d6e-1f2a-4b5c6d9e1f2a',
  'Delivery Staff':  '7e0f2a3b-5c6d-8e7f-2a3b-5c6d7e0f2a3b',
}

// role_id-style columns discovered dynamically via SQLite's own schema
// introspection (not a hand-maintained list) — same rationale as
// branchReconcile.ts: new tables with a role_id column shouldn't require
// remembering to update a list here too.
function findRoleIdColumns(db: Database.Database): { table: string; column: string }[] {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  const referencingCols: { table: string; column: string }[] = []
  for (const { name } of tables) {
    if (name === 'roles' || name.startsWith('sqlite_')) continue
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
    for (const col of cols) {
      if (col.name === 'role_id' || col.name.endsWith('_role_id')) {
        referencingCols.push({ table: name, column: col.name })
      }
    }
  }
  return referencingCols
}

// cloudRolesByName: role name -> the real cloud role id for this tenant,
// for whichever of the 5 default roles the cloud actually returned (a
// tenant may not have all 5 rows back yet on a very first pull).
export function reconcileLocalDefaultRoles(db: Database.Database, cloudRolesByName: Record<string, string>): void {
  const referencingCols = findRoleIdColumns(db)

  for (const [roleName, localPlaceholderId] of Object.entries(LOCAL_DEFAULT_ROLE_IDS)) {
    const cloudRoleId = cloudRolesByName[roleName]
    if (!cloudRoleId || cloudRoleId === localPlaceholderId) continue

    const localRow = db.prepare('SELECT id FROM roles WHERE id = ?').get(localPlaceholderId)
    if (!localRow) continue // already reconciled, or this default role was never seeded locally

    const cloudRowAlreadyPresent = db.prepare('SELECT id FROM roles WHERE id = ?').get(cloudRoleId)

    db.pragma('foreign_keys = OFF')
    try {
      db.transaction(() => {
        for (const { table, column } of referencingCols) {
          db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(cloudRoleId, localPlaceholderId)
        }
        // Any writes made offline before the cloud's real role id was known
        // are still sitting in sync_queue with the placeholder id baked into
        // their JSON payload — a plain substring swap is enough here too
        // (same technique as branchReconcile.ts), it can't collide with
        // anything else in the JSON.
        db.prepare(`
          UPDATE sync_queue SET payload = REPLACE(payload, ?, ?)
          WHERE payload LIKE '%' || ? || '%'
        `).run(localPlaceholderId, cloudRoleId, localPlaceholderId)

        if (cloudRowAlreadyPresent) {
          // The cloud role was already synced in under its own id (e.g. a
          // re-activation, or a prior partial pull) — every reference now
          // points at that real row, so the placeholder row is redundant.
          db.prepare('DELETE FROM roles WHERE id = ?').run(localPlaceholderId)
        } else {
          db.prepare('UPDATE roles SET id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(cloudRoleId, localPlaceholderId)
        }
      })()
    } finally {
      db.pragma('foreign_keys = ON')
    }
  }
}
