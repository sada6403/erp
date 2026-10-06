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
    const archiveAndDelete = async (
      table: 'stocks' | 'invoice_items' | 'stock_movements',
      row: Record<string, unknown>,
      reason: string
    ) => {
      await client.query(`INSERT IGNORE INTO sync_orphan_record_archive
        (table_name,record_id,reason,original_record) VALUES (?,?,?,?)`,
        [table, row.id, reason, JSON.stringify(row)])
      await client.query(`INSERT INTO sync_deletions(id,table_name,record_id)
        SELECT UUID(),?,? WHERE NOT EXISTS (
          SELECT 1 FROM sync_deletions WHERE table_name=? AND record_id=?)`,
        [table, row.id, table, row.id])
      await client.query(`DELETE FROM \`${table}\` WHERE id=?`, [row.id])
    }

    const ensureHistoricalBranch = async (branchId: string) => {
      const suffix = createHash('sha256').update(branchId).digest('hex').slice(0, 12).toUpperCase()
      await client.query(`INSERT INTO branches(id,name,code,is_active)
        VALUES (?,?,?,0) ON DUPLICATE KEY UPDATE id=VALUES(id)`, [
        branchId, `Recovered historical branch (${branchId})`, `RECOVERED-${suffix}`,
      ])
    }

    const { rows: missingBranches } = await client.query<{ branch_id: string }>(`
      SELECT DISTINCT u.branch_id
      FROM users u LEFT JOIN branches b ON b.id=u.branch_id
      WHERE u.branch_id IS NOT NULL AND b.id IS NULL
      FOR UPDATE`)
    for (const { branch_id: branchId } of missingBranches) {
      await ensureHistoricalBranch(branchId)
    }

    // Audit and financial records must retain their original actor/branch IDs.
    // Restore inactive, no-permission placeholders instead of dropping the FK,
    // reassigning history to a live account, or inventing credentials.
    const { rows: referencedBranches } = await client.query<{ branch_id: string }>(`
      SELECT DISTINCT refs.branch_id FROM (
        SELECT branch_id FROM audit_logs WHERE branch_id IS NOT NULL
        UNION ALL SELECT branch_id FROM invoices WHERE branch_id IS NOT NULL
      ) refs LEFT JOIN branches b ON b.id=refs.branch_id
      WHERE b.id IS NULL`)
    for (const { branch_id: branchId } of referencedBranches) {
      await ensureHistoricalBranch(branchId)
    }

    const historicalRoleId = '00000000-0000-4000-8000-000000000001'
    await client.query(`INSERT INTO roles(id,name,permissions,is_system)
      VALUES (?,'Recovered Historical User',JSON_OBJECT(),1)
      ON DUPLICATE KEY UPDATE id=VALUES(id)`, [historicalRoleId])
    const { rows: referencedUsers } = await client.query<{ user_id: string; branch_id: string | null }>(`
      SELECT refs.user_id, MAX(refs.branch_id) AS branch_id FROM (
        SELECT cashier_id AS user_id, branch_id FROM invoices WHERE cashier_id IS NOT NULL
        UNION ALL SELECT approved_by, branch_id FROM invoices WHERE approved_by IS NOT NULL
        UNION ALL SELECT p.received_by, i.branch_id FROM payments p
          LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.received_by IS NOT NULL
        UNION ALL SELECT user_id, branch_id FROM audit_logs WHERE user_id IS NOT NULL
      ) refs LEFT JOIN users u ON u.id=refs.user_id
      WHERE u.id IS NULL GROUP BY refs.user_id`)
    for (const { user_id: userId, branch_id: branchId } of referencedUsers) {
      const suffix = createHash('sha256').update(userId).digest('hex').slice(0, 24)
      await client.query(`INSERT IGNORE INTO users
        (id,branch_id,role_id,name,email,password_hash,is_active)
        VALUES (?,?,?,?,?,'',0)`, [
        userId, branchId, historicalRoleId,
        `Recovered historical user (${userId})`, `recovered-${suffix}@invalid.local`,
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
      await archiveAndDelete('stocks', row, reason)
    }

    // A stale device can reconnect immediately after Clear All Data and push
    // child rows whose products/invoices were intentionally removed. Archive
    // the exact payload, publish a tombstone, and remove only unusable rows.
    const { rows: orphanInvoiceItems } = await client.query<Record<string, unknown>>(`
      SELECT ii.* FROM invoice_items ii
      LEFT JOIN invoices i ON i.id=ii.invoice_id
      LEFT JOIN products p ON p.id=ii.product_id
      WHERE i.id IS NULL OR p.id IS NULL
      FOR UPDATE`)
    for (const row of orphanInvoiceItems) {
      const missing: string[] = []
      const invoice = await client.query('SELECT id FROM invoices WHERE id=? LIMIT 1', [row.invoice_id])
      const product = await client.query('SELECT id FROM products WHERE id=? LIMIT 1', [row.product_id])
      if (!invoice.rows.length) missing.push('invoice')
      if (!product.rows.length) missing.push('product')
      await archiveAndDelete('invoice_items', row, `Missing ${missing.join(' and ')} reference`)
    }

    const { rows: orphanStockMovements } = await client.query<Record<string, unknown>>(`
      SELECT sm.* FROM stock_movements sm
      LEFT JOIN products p ON p.id=sm.product_id
      WHERE p.id IS NULL
      FOR UPDATE`)
    for (const row of orphanStockMovements) {
      await archiveAndDelete('stock_movements', row, 'Missing product reference')
    }
    await client.query('COMMIT')
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  }
}
