import { getDb } from '../database'
import { randomUUID } from 'crypto'

function wakeSyncService(): void {
  import('./syncService')
    .then(({ getSyncService }) => getSyncService().runSoon())
    .catch(() => undefined)
}

// Enqueue the full users row (cloud-safe columns only) so credential changes
// (password_hash / pin_hash) always reach the cloud without clobbering other
// pending fields of the same record. `operation` must be 'INSERT' at the
// call site that just created the row — the backend's UPDATE path also
// self-heals a mislabeled 'UPDATE' into an INSERT when the row doesn't exist
// yet (backend/lib/sync.ts), but labeling it correctly here keeps the queued
// operation truthful and avoids relying on that fallback alone.
export async function enqueueUserRow(userId: string, operation: 'INSERT' | 'UPDATE' = 'UPDATE'): Promise<void> {
  try {
    const db = getDb()
    const row = db.prepare(`
      SELECT id, branch_id, role_id, name, email, password_hash, pin_hash,
             is_active, last_login_at, created_at, updated_at
      FROM users WHERE id = ?
    `).get(userId) as Record<string, unknown> | undefined
    if (!row) return
    await enqueuSync('users', userId, operation, row)
  } catch {
    // Non-blocking: sync queue failure shouldn't interrupt main flow
  }
}

export async function enqueuSync(
  table: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const db = getDb()
    if (table === 'stocks' && operation !== 'DELETE' && !payload._base_stock) {
      const baseline = db.prepare('SELECT quantity, damaged_qty FROM sync_stock_baselines WHERE record_id=?').get(recordId)
      if (baseline) payload = { ...payload, _base_stock: baseline }
    }
    const existing = db.prepare(`
      SELECT id, operation, payload, status FROM sync_queue
      WHERE table_name = ? AND record_id = ? AND status IN ('pending','processing','failed')
      ORDER BY created_at DESC, rowid DESC
      LIMIT 1
    `).get(table, recordId) as { id: string; operation: string; payload: string; status: string } | undefined

    // Preserve an unsent create and all fields when an offline edit coalesces.
    // A processing event is immutable: its acknowledgement must not consume a newer edit.
    if (existing) {
      payload = { ...JSON.parse(existing.payload), ...payload }
      if (existing.operation === 'INSERT' && operation !== 'DELETE') operation = 'INSERT'
    }

    if (existing && existing.status !== 'processing') {
      db.prepare(`
        UPDATE sync_queue
        SET operation = ?,
            payload = ?,
            status = 'pending',
            attempts = 0,
            failure_cycles = 0,
            next_retry_at = NULL,
            last_error = NULL
        WHERE id = ?
      `).run(operation, JSON.stringify(payload), existing.id)
      wakeSyncService()
      return
    }

    db.prepare(`
      INSERT INTO sync_queue (id, table_name, record_id, operation, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), table, recordId, operation, JSON.stringify(payload))
    wakeSyncService()
  } catch (error) {
    console.error('[SyncQueue] Failed to persist change', { table, recordId, operation, error })
    throw error
  }
}
