import type Database from 'better-sqlite3'
import { enqueuSync } from './syncQueue'

// Every stock-mutating flow (sales, transfers, purchases, counts, returns,
// imports) already writes to the local `stocks` table and logs a
// `stock_movements` audit row, but historically only the audit row was ever
// pushed to the cloud — not the resulting quantity itself. Call this right
// after any `stocks.quantity` write so the row's current truth actually syncs.
export async function syncStockRow(
  db: Database.Database,
  productId: string,
  branchId: string,
  warehouseId: string | null = null
): Promise<void> {
  const row = db.prepare(`
    SELECT * FROM stocks WHERE product_id = ? AND branch_id = ? AND warehouse_id IS ?
  `).get(productId, branchId, warehouseId) as Record<string, unknown> | undefined
  if (row) await enqueuSync('stocks', String(row.id), 'UPDATE', row)
}

// Same idea for customers.outstanding_due, which several invoice flows
// mutate directly without ever enqueuing the customer row for sync.
export async function syncCustomerRow(db: Database.Database, customerId: string): Promise<void> {
  const row = db.prepare(`SELECT * FROM customers WHERE id = ?`).get(customerId) as Record<string, unknown> | undefined
  if (row) await enqueuSync('customers', String(row.id), 'UPDATE', row)
}
