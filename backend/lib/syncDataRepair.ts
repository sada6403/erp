import { createHash } from 'crypto'
import type { QueryClient } from './db'

// Repairs only relationships whose intent is unambiguous. Historical users keep
// their original branch ID via an inactive placeholder. Stock rows whose product
// or branch no longer exists are archived and tombstoned; inventing a balance or
// silently attaching them to another product/branch would corrupt inventory.
export async function repairOrphanedSyncData(client: QueryClient): Promise<void> {
  await client.query(`CREATE TABLE IF NOT EXISTS sync_orphan_record_archive (
    table_name VARCHAR(191) NOT NULL,
    record_id VARCHAR(191) NOT NULL,
    reason VARCHAR(255) NOT NULL,
    original_record JSON NOT NULL,
    archived_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(table_name,record_id)
  )`)

  await client.query('START TRANSACTION')
  try {
    const { rows: missingBranches } = await client.query<{ branch_id: string }>(`
      SELECT DISTINCT u.branch_id
      FROM users u LEFT JOIN branches b ON b.id=u.branch_id
      WHERE u.branch_id IS NOT NULL AND b.id IS NULL
      FOR UPDATE`)
    for (const { branch_id: branchId } of missingBranches) {
      const suffix = createHash('sha256').update(branchId).digest('hex').slice(0, 12).toUpperCase()
      await client.query(`INSERT INTO branches(id,name,code,is_active)
        VALUES (?,? ,?,0) ON DUPLICATE KEY UPDATE id=VALUES(id)`, [
        branchId, `Recovered historical branch (${branchId})`, `RECOVERED-${suffix}`,
      ])
    }

    const { rows: orphanStocks } = await client.query<Record<string, unknown>>(`
      SELECT s.* FROM stocks s
      LEFT JOIN products p ON p.id=s.product_id
      LEFT JOIN branches b ON b.id=s.branch_id
      WHERE p.id IS NULL OR b.id IS NULL
      FOR UPDATE`)
    for (const row of orphanStocks) {
      const missing: string[] = []
      const product = await client.query('SELECT id FROM products WHERE id=? LIMIT 1', [row.product_id])
      const branch = await client.query('SELECT id FROM branches WHERE id=? LIMIT 1', [row.branch_id])
      if (!product.rows.length) missing.push('product')
      if (!branch.rows.length) missing.push('branch')
      const reason = `Missing ${missing.join(' and ')} reference`
      await client.query(`INSERT IGNORE INTO sync_orphan_record_archive
        (table_name,record_id,reason,original_record) VALUES ('stocks',?,?,?)`,
        [row.id, reason, JSON.stringify(row)])
      await client.query(`INSERT INTO sync_deletions(id,table_name,record_id)
        SELECT UUID(),'stocks',? WHERE NOT EXISTS (
          SELECT 1 FROM sync_deletions WHERE table_name='stocks' AND record_id=?)`, [row.id, row.id])
      await client.query('DELETE FROM stocks WHERE id=?', [row.id])
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
