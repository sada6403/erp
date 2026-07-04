import { getDb } from '../database'
import { randomUUID } from 'crypto'

function wakeSyncService(): void {
  import('./syncService')
    .then(({ getSyncService }) => getSyncService().runSoon())
    .catch(() => undefined)
}

export async function enqueuSync(
  table: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const db = getDb()
    const existing = db.prepare(`
      SELECT id FROM sync_queue
      WHERE table_name = ? AND record_id = ? AND status IN ('pending','processing','failed')
      ORDER BY created_at DESC
      LIMIT 1
    `).get(table, recordId) as { id: string } | undefined

    if (existing) {
      db.prepare(`
        UPDATE sync_queue
        SET operation = ?,
            payload = ?,
            status = 'pending',
            attempts = 0,
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
  } catch {
    // Non-blocking: sync queue failure shouldn't interrupt main flow
  }
}
