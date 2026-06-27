import { getDb } from '../database'
import { randomUUID } from 'crypto'

export async function enqueuSync(
  table: string,
  recordId: string,
  operation: 'INSERT' | 'UPDATE' | 'DELETE',
  payload: Record<string, unknown>
): Promise<void> {
  try {
    const db = getDb()
    db.prepare(`
      INSERT INTO sync_queue (id, table_name, record_id, operation, payload)
      VALUES (?, ?, ?, ?, ?)
    `).run(randomUUID(), table, recordId, operation, JSON.stringify(payload))
  } catch {
    // Non-blocking: sync queue failure shouldn't interrupt main flow
  }
}
