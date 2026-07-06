import { randomUUID } from 'crypto'
import type { QueryClient } from './db'

export const ALLOWED_TABLES = new Set([
  'branches', 'warehouses', 'roles', 'users', 'categories', 'suppliers',
  'products', 'stocks', 'stock_movements', 'stock_transfers', 'customers',
  'purchase_orders', 'purchase_items',
  'invoices', 'invoice_items', 'payments', 'installments', 'installment_payments',
  'installment_plans', 'installment_schedule', 'installment_reminders',
  'deliveries', 'audit_logs', 'customer_orders', 'customer_order_items',
])

const RELATED_KEYS: Record<string, Set<string>> = {
  invoice_items:          new Set(['invoice_id']),
  payments:               new Set(['invoice_id']),
  installment_payments:   new Set(['installment_id']),
  installment_schedule:   new Set(['installment_id']),
  installment_reminders:  new Set(['installment_id']),
  customer_order_items:   new Set(['order_id']),
}

export function assertTable(table: unknown): asserts table is string {
  if (typeof table !== 'string' || !ALLOWED_TABLES.has(table)) {
    throw new Error('Unsupported sync table')
  }
}

export function assertRelatedKey(table: string, key: unknown): asserts key is string {
  if (typeof key !== 'string' || !RELATED_KEYS[table]?.has(key)) {
    throw new Error('Unsupported related-data key')
  }
}

// MySQL uses backticks for identifier quoting
export function quoteIdentifier(value: string): string {
  return `\`${value.replace(/`/g, '``')}\``
}

async function getColumns(client: QueryClient, table: string): Promise<Set<string>> {
  const result = await client.query<{ COLUMN_NAME: string }>(
    `SELECT COLUMN_NAME FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
    [table]
  )
  return new Set(result.rows.map(row => row.COLUMN_NAME))
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    return value.slice(0, 19).replace('T', ' ')
  }
  return value
}

async function resolveRoleId(client: QueryClient, record: Record<string, unknown>): Promise<void> {
  if (!record.role_id) return

  const roleId = String(record.role_id)
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM roles WHERE id = ? LIMIT 1`,
    [roleId]
  )
  if (existing.rows[0]) return

  const email = String(record.email || '').toLowerCase()
  const name = String(record.name || '').toLowerCase()
  const localBranchManagerRoleId = '4b7c9d0e-2f3a-5b4c-9d0e-2f3a4b7c9d0e'
  const fallbackRoleName =
    roleId === localBranchManagerRoleId || email.startsWith('manager.') || name.includes('manager')
      ? 'Branch Manager'
      : 'Cashier'

  const fallback = await client.query<{ id: string }>(
    `SELECT id FROM roles WHERE name = ? LIMIT 1`,
    [fallbackRoleName]
  )
  if (fallback.rows[0]?.id) {
    record.role_id = fallback.rows[0].id
    return
  }

  const anyRole = await client.query<{ id: string }>(
    `SELECT id FROM roles ORDER BY is_system DESC, created_at ASC LIMIT 1`
  )
  if (anyRole.rows[0]?.id) record.role_id = anyRole.rows[0].id
}

export async function applySyncOperation(
  client: QueryClient,
  input: {
    table: string
    operation: string
    recordId: string
    record: Record<string, unknown>
  }
): Promise<void> {
  assertTable(input.table)
  const columns = await getColumns(client, input.table)
  let operation = input.operation
  const record = Object.fromEntries(
    Object.entries(input.record)
      .filter(([key]) => columns.has(key))
      .map(([key, value]) => [key, normalizeValue(value)])
  )

  if (input.table === 'users') {
    // Never blank stored credentials: a partial UPDATE (e.g. a PIN or name change)
    // must not overwrite password_hash/pin_hash with an empty value.
    if (!record.password_hash) {
      if (operation === 'INSERT' && columns.has('password_hash')) record.password_hash = ''
      else delete record.password_hash
    }
    if (!record.pin_hash) delete record.pin_hash
    await resolveRoleId(client, record)
  }

  if (input.table === 'stocks' && !record.id) {
    // MySQL NULL-safe equals: <=>
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM stocks
        WHERE product_id = ? AND branch_id = ? AND warehouse_id <=> ?
        LIMIT 1`,
      [record.product_id, record.branch_id, record.warehouse_id ?? null]
    )
    record.id = existing.rows[0]?.id || randomUUID()
    if (!existing.rows[0] && operation === 'UPDATE') operation = 'INSERT'
  }

  if (operation === 'DELETE') {
    await client.query(
      `DELETE FROM ${quoteIdentifier(input.table)} WHERE id = ?`,
      [input.recordId]
    )
    return
  }

  if (!record.id && operation === 'INSERT') record.id = input.recordId
  const keys = Object.keys(record)
  if (keys.length === 0) throw new Error('No valid columns were supplied')

  if (operation === 'INSERT') {
    const values = keys.map(key => record[key])
    // On upsert of an existing user, an empty credential must not replace a real one.
    const updateKeys = keys.filter(key =>
      key !== 'id' && key !== 'created_at'
      && !(input.table === 'users' && (key === 'password_hash' || key === 'pin_hash') && !record[key])
    )

    // MySQL: ON DUPLICATE KEY UPDATE col = VALUES(col)
    const updateSql = updateKeys.length
      ? updateKeys.map(key => `${quoteIdentifier(key)} = VALUES(${quoteIdentifier(key)})`).join(', ')
      : `id = VALUES(id)`

    await client.query(
      `INSERT INTO ${quoteIdentifier(input.table)}
         (${keys.map(quoteIdentifier).join(', ')})
       VALUES (${keys.map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${updateSql}`,
      values
    )
    return
  }

  if (operation === 'UPDATE') {
    const updateKeys = keys.filter(key => key !== 'id' && key !== 'created_at')
    if (updateKeys.length === 0) return
    const values = updateKeys.map(key => record[key])
    const targetId = String(record.id || input.recordId)
    await client.query(
      `UPDATE ${quoteIdentifier(input.table)}
          SET ${updateKeys.map(key => `${quoteIdentifier(key)} = ?`).join(', ')}
        WHERE id = ?`,
      [...values, targetId]
    )
    return
  }

  throw new Error('Unsupported sync operation')
}
