import type Database from 'better-sqlite3'

// The desktop app always seeds a placeholder "Main Branch" locally on first
// boot, before it's ever connected to the cloud (offline-first — the app
// must be usable standalone). The cloud independently seeds its own Main
// Branch for the tenant when the company is created (backend/lib/tenant.ts).
// These are two different rows with two different ids for what is meant to
// be the same physical branch. Without reconciliation, activating against
// the cloud (electron/ipc/activation.ts) would pull the cloud's branch down
// via the very next sync as a brand-new second row — an "auto-created
// branch" the admin never asked for.
export const LOCAL_SEED_BRANCH_ID = 'b1111111-1111-4111-8111-111111111111'

// Re-points every local reference from the placeholder id to the real cloud
// branch id the admin picked during activation, so the local branch BECOMES
// that branch instead of coexisting alongside it. Every table/column
// referencing branches(id) is discovered dynamically via SQLite's own schema
// introspection (not a hand-maintained list) — this app has 30+ tables with a
// branch_id-style column (branch_id, from_branch_id, to_branch_id, ...) and a
// static list would silently go stale as new ones are added.
export function reconcileLocalMainBranch(db: Database.Database, cloudBranchId: string): void {
  if (!cloudBranchId || cloudBranchId === LOCAL_SEED_BRANCH_ID) return

  const localRow = db.prepare('SELECT id FROM branches WHERE id = ?').get(LOCAL_SEED_BRANCH_ID)
  if (!localRow) return // already reconciled (or a fresh DB that never seeded it)

  const cloudRowAlreadyPresent = db.prepare('SELECT id FROM branches WHERE id = ?').get(cloudBranchId)

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  const referencingCols: { table: string; column: string }[] = []
  for (const { name } of tables) {
    if (name === 'branches' || name.startsWith('sqlite_')) continue
    const cols = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
    for (const col of cols) {
      if (col.name === 'branch_id' || col.name.endsWith('_branch_id')) {
        referencingCols.push({ table: name, column: col.name })
      }
    }
  }

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const { table, column } of referencingCols) {
        db.prepare(`UPDATE "${table}" SET "${column}" = ? WHERE "${column}" = ?`).run(cloudBranchId, LOCAL_SEED_BRANCH_ID)
      }
      // Any writes made offline before this device ever activated are still
      // sitting in sync_queue with the placeholder id baked into their JSON
      // payload (branch_id/from_branch_id/to_branch_id, depending on table) —
      // those haven't reached the cloud yet, so a plain substring swap of the
      // UUID is enough; it can't collide with anything else in the JSON.
      db.prepare(`
        UPDATE sync_queue SET payload = REPLACE(payload, ?, ?)
        WHERE payload LIKE '%' || ? || '%'
      `).run(LOCAL_SEED_BRANCH_ID, cloudBranchId, LOCAL_SEED_BRANCH_ID)
      if (cloudRowAlreadyPresent) {
        // The cloud branch was already synced in under its own id (e.g. a
        // re-activation) — every reference now points at that real row, so
        // the placeholder row is redundant. Safe to remove: everything that
        // used to point at it has just been repointed above.
        db.prepare('DELETE FROM branches WHERE id = ?').run(LOCAL_SEED_BRANCH_ID)
      } else {
        db.prepare('UPDATE branches SET id = ?, updated_at = datetime(\'now\') WHERE id = ?').run(cloudBranchId, LOCAL_SEED_BRANCH_ID)
      }
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
