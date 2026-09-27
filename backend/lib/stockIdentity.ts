import type { QueryClient } from './db'

export function duplicateStockGroups(rows: Record<string, unknown>[]): Record<string, unknown>[][] {
  const groups = new Map<string, Record<string, unknown>[]>()
  for (const row of rows) {
    const key = JSON.stringify([row.product_id, row.branch_id, row.warehouse_id ?? null])
    groups.set(key, [...(groups.get(key) || []), row])
  }
  return [...groups.values()].filter(group => group.length > 1)
}

export function identicalStockBalances(rows: Record<string, unknown>[]): boolean {
  const normalize = (row: Record<string, unknown>) => JSON.stringify(Object.keys(row).sort()
    .filter(key => !['id', 'created_at', 'updated_at', 'synced_at', 'sync_warehouse_key'].includes(key))
    .map(key => [key, ['quantity', 'damaged_qty'].includes(key) ? Number(row[key] ?? 0) : row[key]]))
  return rows.every(row => normalize(row) === normalize(rows[0]))
}

// Preserves a complete archive and never sums duplicates or chooses between
// different balances. Ambiguous groups stay intact and block conflicting writes.
export async function repairIdenticalStocks(client: QueryClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS sync_stock_duplicate_archive (
    original_id VARCHAR(191) PRIMARY KEY, canonical_id VARCHAR(191) NOT NULL,
    original_record JSON NOT NULL, archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP)`)
  await client.query('START TRANSACTION')
  try {
    const { rows } = await client.query('SELECT * FROM stocks ORDER BY id FOR UPDATE')
    for (const group of duplicateStockGroups(rows)) {
      if (!identicalStockBalances(group)) continue
      const canonical = group[0]
      for (const row of group) {
        await client.query(`INSERT IGNORE INTO sync_stock_duplicate_archive
          (original_id,canonical_id,original_record) VALUES (?,?,?)`, [row.id, canonical.id, JSON.stringify(row)])
      }
      for (const row of group.slice(1)) {
        await client.query(`INSERT INTO sync_deletions(id,table_name,record_id)
          SELECT UUID(),'stocks',? WHERE NOT EXISTS (
            SELECT 1 FROM sync_deletions WHERE table_name='stocks' AND record_id=?)`, [row.id, row.id])
        await client.query('DELETE FROM stocks WHERE id=?', [row.id])
      }
      await client.query('UPDATE stocks SET updated_at=CURRENT_TIMESTAMP WHERE id=?', [canonical.id])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
  const { rows: duplicates } = await client.query(`SELECT product_id FROM stocks
    GROUP BY product_id,branch_id,COALESCE(warehouse_id,'') HAVING COUNT(*) > 1 LIMIT 1`)
  if (!duplicates.length) {
    try {
      await client.query(`ALTER TABLE stocks ADD COLUMN sync_warehouse_key VARCHAR(191)
        GENERATED ALWAYS AS (COALESCE(warehouse_id,'')) STORED`)
    } catch (error) {
      if (!/Duplicate column name/i.test(String(error))) throw error
    }
    try {
      await client.query('CREATE UNIQUE INDEX idx_stocks_sync_identity ON stocks(product_id,branch_id,sync_warehouse_key)')
    } catch (error) {
      if (!/Duplicate key name/i.test(String(error))) throw error
    }
  }
}
