import { randomUUID } from 'crypto'
import type Database from 'better-sqlite3'
import { enqueuSync } from './syncQueue'

// Central helper for every audit_logs insert. Writing locally without also
// enqueuing the push means every device's activity history stays invisible
// to the cloud (and to every other device) forever — this is the single
// place that must not be forgotten when adding a new call site.
export function logAudit(
  db: Database.Database,
  params: {
    userId?: string | null
    branchId?: string | null
    action: string
    tableName?: string | null
    recordId?: string | null
    oldValues?: unknown
    newValues?: unknown
  }
): string {
  const id = randomUUID()
  const oldValues = params.oldValues !== undefined ? JSON.stringify(params.oldValues) : null
  const newValues = params.newValues !== undefined ? JSON.stringify(params.newValues) : null

  db.prepare(`
    INSERT INTO audit_logs (id, user_id, branch_id, action, table_name, record_id, old_values, new_values)
    VALUES (?,?,?,?,?,?,?,?)
  `).run(
    id, params.userId ?? null, params.branchId ?? null, params.action,
    params.tableName ?? null, params.recordId ?? null, oldValues, newValues
  )

  void enqueuSync('audit_logs', id, 'INSERT', {
    id,
    user_id:    params.userId ?? null,
    branch_id:  params.branchId ?? null,
    action:     params.action,
    table_name: params.tableName ?? null,
    record_id:  params.recordId ?? null,
    old_values: oldValues,
    new_values: newValues,
  })

  return id
}
