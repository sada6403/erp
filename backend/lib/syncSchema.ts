import type { QueryClient } from './db'
import { ALLOWED_TABLES, quoteIdentifier } from './sync'

// This runs after legacy compatibility migrations. A failed contract check must
// prevent the tenant being cached as ready, so subsequent requests can retry.
export async function ensureSyncSchema(client: Pick<QueryClient, 'query'>): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS sync_push_receipts (
    event_id VARCHAR(191) NOT NULL PRIMARY KEY,
    table_name VARCHAR(191) NOT NULL,
    record_id VARCHAR(191) NOT NULL,
    applied_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_sync_receipts_applied (applied_at)
  )`)
  await client.query(`CREATE TABLE IF NOT EXISTS warehouses (
    id VARCHAR(191) NOT NULL PRIMARY KEY, branch_id VARCHAR(191) NOT NULL,
    name VARCHAR(255) NOT NULL, location TEXT NULL, is_active BOOLEAN NOT NULL DEFAULT 1,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    synced_at DATETIME NULL)`)
  const { rows } = await client.query<{ TABLE_NAME: string; COLUMN_NAME: string }>(
    'SELECT TABLE_NAME, COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')
  for (const table of ALLOWED_TABLES) {
    const columns = rows.filter(r => r.TABLE_NAME === table).map(r => r.COLUMN_NAME)
    if (!columns.length) throw new Error(`Sync schema incomplete: missing ${table}`)
    if (!columns.includes('updated_at')) {
      try {
        await client.query(`ALTER TABLE ${quoteIdentifier(table)} ADD COLUMN updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`)
      } catch (error) {
        if (!/Duplicate column name/i.test(String(error))) throw error
      }
    }
  }
}
