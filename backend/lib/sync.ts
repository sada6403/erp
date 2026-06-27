import { randomUUID } from 'crypto'
import type { PoolClient } from 'pg'

export const ALLOWED_TABLES = new Set([
  'branches',
  'warehouses',
  'roles',
  'users',
  'categories',
  'suppliers',
  'products',
  'stocks',
  'stock_transfers',
  'customers',
  'invoices',
  'invoice_items',
  'payments',
  'installments',
  'installment_payments',
  'deliveries',
  'audit_logs',
  'customer_orders',
  'customer_order_items',
])

const RELATED_KEYS: Record<string, Set<string>> = {
  invoice_items: new Set(['invoice_id']),
  payments: new Set(['invoice_id']),
  installment_payments: new Set(['installment_id']),
  customer_order_items: new Set(['order_id']),
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

export function quoteIdentifier(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

async function getColumns(client: PoolClient, table: string): Promise<Set<string>> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1`,
    [table]
  )
  return new Set(result.rows.map(row => row.column_name))
}

function normalizeValue(value: unknown): unknown {
  if (value === undefined) return null
  return value
}

export async function applySyncOperation(
  client: PoolClient,
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

  if (input.table === 'stocks' && !record.id) {
    const existing = await client.query<{ id: string }>(
      `SELECT id FROM stocks
        WHERE product_id = $1
          AND branch_id = $2
          AND warehouse_id IS NOT DISTINCT FROM $3
        LIMIT 1`,
      [record.product_id, record.branch_id, record.warehouse_id ?? null]
    )
    record.id = existing.rows[0]?.id || randomUUID()
    if (!existing.rows[0] && operation === 'UPDATE') operation = 'INSERT'
  }

  if (operation === 'DELETE') {
    await client.query(
      `DELETE FROM ${quoteIdentifier(input.table)} WHERE id = $1`,
      [input.recordId]
    )
    return
  }

  if (!record.id && operation === 'INSERT') record.id = input.recordId
  const keys = Object.keys(record)
  if (keys.length === 0) throw new Error('No valid columns were supplied')

  if (operation === 'INSERT') {
    const values = keys.map(key => record[key])
    const updateKeys = keys.filter(key => key !== 'id' && key !== 'created_at')
    const updateSql = updateKeys.length
      ? updateKeys.map(key => `${quoteIdentifier(key)} = EXCLUDED.${quoteIdentifier(key)}`).join(', ')
      : 'id = EXCLUDED.id'

    await client.query(
      `INSERT INTO ${quoteIdentifier(input.table)}
        (${keys.map(quoteIdentifier).join(', ')})
       VALUES (${keys.map((_, index) => `$${index + 1}`).join(', ')})
       ON CONFLICT (id) DO UPDATE SET ${updateSql}`,
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
          SET ${updateKeys.map((key, index) => `${quoteIdentifier(key)} = $${index + 1}`).join(', ')}
        WHERE id = $${updateKeys.length + 1}`,
      [...values, targetId]
    )
    return
  }

  throw new Error('Unsupported sync operation')
}
