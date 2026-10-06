import type Database from 'better-sqlite3'

export const LOCAL_SEED_BRANCH_ID = 'b1111111-1111-4111-8111-111111111111'

function mergeLocalBranch(
  db: Database.Database,
  sourceBranchId: string,
  targetBranchId: string
): void {
  if (!sourceBranchId || !targetBranchId || sourceBranchId === targetBranchId) return
  if (!db.prepare('SELECT id FROM branches WHERE id=?').get(sourceBranchId)) return
  const targetExists = Boolean(db.prepare('SELECT id FROM branches WHERE id=?').get(targetBranchId))

  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as { name: string }[]
  for (const { name } of tables) {
    if (name === 'branches' || name.startsWith('sqlite_')) continue
    const columns = db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]
    for (const column of columns) {
      if (column.name === 'branch_id' || column.name.endsWith('_branch_id')) {
        db.prepare(`UPDATE "${name}" SET "${column.name}"=? WHERE "${column.name}"=?`)
          .run(targetBranchId, sourceBranchId)
      }
    }
  }

  db.prepare(`UPDATE sync_queue SET payload=REPLACE(payload, ?, ?)
    WHERE payload LIKE '%' || ? || '%'`).run(sourceBranchId, targetBranchId, sourceBranchId)
  // The redundant branch-create must never be replayed after the local rows
  // are merged. The canonical row already exists in the cloud.
  db.prepare(`UPDATE sync_queue SET status='synced', synced_at=datetime('now'), last_error=NULL
    WHERE table_name='branches' AND record_id=? AND status!='synced'`).run(sourceBranchId)

  if (targetExists) db.prepare('DELETE FROM branches WHERE id=?').run(sourceBranchId)
  else db.prepare(`UPDATE branches SET id=?, updated_at=datetime('now') WHERE id=?`)
    .run(targetBranchId, sourceBranchId)
}

// Re-points the always-seeded offline Main Branch onto the real branch chosen
// during cloud activation. Safe to call on every sync; it becomes a no-op once
// the placeholder has been merged.
export function reconcileLocalMainBranch(db: Database.Database, cloudBranchId: string): void {
  if (!cloudBranchId || cloudBranchId === LOCAL_SEED_BRANCH_ID) return
  if (!db.prepare('SELECT id FROM branches WHERE id=?').get(LOCAL_SEED_BRANCH_ID)) return

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => mergeLocalBranch(db, LOCAL_SEED_BRANCH_ID, cloudBranchId))()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

// Repairs accidental double-submit rows by case-insensitive branch code. The
// device-assigned branch wins, then a row whose create reached cloud, then the
// oldest row. Every local branch reference follows the surviving identity.
export function reconcileDuplicateBranchCodes(
  db: Database.Database,
  preferredBranchId?: string | null
): void {
  const groups = db.prepare(`
    SELECT UPPER(TRIM(code)) AS normalized_code
    FROM branches
    WHERE code IS NOT NULL AND TRIM(code)!=''
    GROUP BY UPPER(TRIM(code)) HAVING COUNT(*) > 1
  `).all() as { normalized_code: string }[]

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      for (const group of groups) {
        const rows = db.prepare(`
          SELECT b.id, b.created_at,
            EXISTS(SELECT 1 FROM sync_queue q
              WHERE q.table_name='branches' AND q.record_id=b.id AND q.status='synced') AS cloud_synced
          FROM branches b WHERE UPPER(TRIM(b.code))=?
          ORDER BY CASE WHEN b.id=? THEN 0 ELSE 1 END,
                   cloud_synced DESC, b.created_at ASC, b.id ASC
        `).all(group.normalized_code, preferredBranchId || '') as Array<{ id: string }>
        const targetId = rows[0]?.id
        if (!targetId) continue
        for (const duplicate of rows.slice(1)) mergeLocalBranch(db, duplicate.id, targetId)
      }
    })()
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_branches_code_ci
      ON branches(UPPER(TRIM(code))) WHERE code IS NOT NULL AND TRIM(code)!=''`)
  } finally {
    db.pragma('foreign_keys = ON')
  }
}

export function ensureLocalBranchIdentity(
  db: Database.Database,
  configuredBranchId?: string | null
): void {
  if (configuredBranchId) reconcileLocalMainBranch(db, configuredBranchId)
  reconcileDuplicateBranchCodes(db, configuredBranchId)
}

export function reconcileIncomingBranch(
  db: Database.Database,
  incomingBranchId: string,
  incomingCode: unknown
): void {
  const code = String(incomingCode || '').trim()
  if (!incomingBranchId || !code) return
  const existing = db.prepare(`SELECT id FROM branches
    WHERE UPPER(TRIM(code))=UPPER(TRIM(?)) LIMIT 1`).get(code) as { id: string } | undefined
  if (!existing || existing.id === incomingBranchId) return

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => mergeLocalBranch(db, existing.id, incomingBranchId))()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
