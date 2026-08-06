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
    // Session/device identifier for the acting user. This is a local
    // Electron desktop app, not a networked multi-client server, so there
    // is no meaningful per-request network IP to capture — this is the
    // closest equivalent (the device's own license/activation identifier,
    // store.get('device_id') in electron/ipc/auth.ts) and is written into
    // the audit_logs.ip_address column, which existed in the schema but was
    // never populated by any caller before this fix. Optional and additive
    // — every existing call site keeps working unchanged.
    ipAddress?: string | null
  }
): string {
  const id = randomUUID()
  const oldValues = params.oldValues !== undefined ? JSON.stringify(params.oldValues) : null
  const newValues = params.newValues !== undefined ? JSON.stringify(params.newValues) : null
  const ipAddress = params.ipAddress ?? null

  db.prepare(`
    INSERT INTO audit_logs (id, user_id, branch_id, action, table_name, record_id, old_values, new_values, ip_address)
    VALUES (?,?,?,?,?,?,?,?,?)
  `).run(
    id, params.userId ?? null, params.branchId ?? null, params.action,
    params.tableName ?? null, params.recordId ?? null, oldValues, newValues, ipAddress
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
    ip_address: ipAddress,
  })

  return id
}
