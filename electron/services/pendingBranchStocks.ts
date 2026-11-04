import type Database from 'better-sqlite3'
import crypto from 'crypto'
import { insertStockMovement } from './stockMovement'
import { syncStockRow } from './stockSync'

export interface PendingBranchStockRecord {
  id: string
  branch_name: string
  product_id: string
  quantity: number
  stock_date?: string | null
  sale_price?: number | null
  status: 'pending' | 'applied' | 'dismissed'
  notes?: string | null
  created_at: string
  applied_at?: string | null
  applied_branch_id?: string | null
}

export interface PendingBranchSummary {
  branch_name: string
  item_count: number
  total_qty: number
  first_seen: string
  last_seen: string
}

/**
 * Initializes the pending_branch_stocks table and indexes if they do not already exist.
 */
export function initPendingBranchStocksTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS pending_branch_stocks (
      id                TEXT PRIMARY KEY,
      branch_name       TEXT NOT NULL,
      product_id        TEXT NOT NULL REFERENCES products(id),
      quantity          INTEGER NOT NULL DEFAULT 0,
      stock_date        TEXT,
      sale_price        REAL,
      status            TEXT NOT NULL DEFAULT 'pending',
      notes             TEXT,
      created_at        TEXT NOT NULL DEFAULT (datetime('now')),
      applied_at        TEXT,
      applied_branch_id TEXT REFERENCES branches(id)
    );
    CREATE INDEX IF NOT EXISTS idx_pending_branch_stocks_name
      ON pending_branch_stocks(branch_name, status);
    CREATE INDEX IF NOT EXISTS idx_pending_branch_stocks_prod
      ON pending_branch_stocks(product_id);
  `)
}

/**
 * Parses a flexible date representation (DD/MM/YYYY, YYYY-MM-DD, Excel serial, ISO) into SQLite datetime format.
 */
export function parseDateFlex(val: unknown): string {
  if (!val) return new Date().toISOString().replace('T', ' ').substring(0, 19)
  if (val instanceof Date) {
    return isNaN(val.getTime())
      ? new Date().toISOString().replace('T', ' ').substring(0, 19)
      : val.toISOString().replace('T', ' ').substring(0, 19)
  }
  if (typeof val === 'number') {
    const d = new Date(Math.round((val - 25569) * 86400 * 1000))
    if (!isNaN(d.getTime())) return d.toISOString().replace('T', ' ').substring(0, 19)
  }
  const str = String(val).trim()
  if (!str) return new Date().toISOString().replace('T', ' ').substring(0, 19)

  // Handle DD/MM/YYYY or DD-MM-YYYY format
  const dmy = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:\s+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?$/)
  if (dmy) {
    const day = dmy[1].padStart(2, '0')
    const month = dmy[2].padStart(2, '0')
    const year = dmy[3]
    const hour = (dmy[4] || '00').padStart(2, '0')
    const min = (dmy[5] || '00').padStart(2, '0')
    const sec = (dmy[6] || '00').padStart(2, '0')
    return `${year}-${month}-${day} ${hour}:${min}:${sec}`
  }

  const parsed = new Date(str)
  if (!isNaN(parsed.getTime())) {
    return parsed.toISOString().replace('T', ' ').substring(0, 19)
  }
  return new Date().toISOString().replace('T', ' ').substring(0, 19)
}

/**
 * Records a pending stock row for a branch that does not yet exist.
 * If a pending record already exists for the same branch and product, it updates the quantity.
 */
export function recordPendingBranchStock(
  db: Database.Database,
  data: {
    branchName: string
    productId: string
    quantity: number
    stockDate?: string | null
    salePrice?: number | null
    notes?: string | null
  }
): { isNew: boolean; id: string } {
  initPendingBranchStocksTable(db)
  const branchName = data.branchName.trim()
  if (!branchName) throw new Error('Branch name cannot be empty for pending stock')

  const existing = db.prepare(`
    SELECT id, quantity FROM pending_branch_stocks
    WHERE lower(trim(branch_name)) = lower(trim(?))
      AND product_id = ?
      AND status = 'pending'
    LIMIT 1
  `).get(branchName, data.productId) as { id: string; quantity: number } | undefined

  if (existing) {
    db.prepare(`
      UPDATE pending_branch_stocks
      SET quantity = ?, stock_date = ?, sale_price = ?, notes = ?, created_at = datetime('now')
      WHERE id = ?
    `).run(data.quantity, data.stockDate || null, data.salePrice ?? null, data.notes || null, existing.id)
    return { isNew: false, id: existing.id }
  }

  const id = crypto.randomUUID()
  db.prepare(`
    INSERT INTO pending_branch_stocks (id, branch_name, product_id, quantity, stock_date, sale_price, notes, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))
  `).run(id, branchName, data.productId, data.quantity, data.stockDate || null, data.salePrice ?? null, data.notes || null)

  return { isNew: true, id }
}

/**
 * Retrieves the summary of all pending branch stocks grouped by uncreated/unassigned branch name.
 */
export function getPendingBranchStocksSummary(db: Database.Database): PendingBranchSummary[] {
  initPendingBranchStocksTable(db)
  return db.prepare(`
    SELECT
      branch_name,
      COUNT(DISTINCT product_id) as item_count,
      SUM(quantity) as total_qty,
      MIN(created_at) as first_seen,
      MAX(created_at) as last_seen
    FROM pending_branch_stocks
    WHERE status = 'pending'
    GROUP BY lower(trim(branch_name))
    ORDER BY MAX(created_at) DESC
  `).all() as PendingBranchSummary[]
}

/**
 * Automatically applies all pending stock for a newly created or designated branch.
 * Moves stocks into the 'stocks' table, logs stock movement, and marks pending rows as 'applied'.
 */
export function applyPendingBranchStocks(
  db: Database.Database,
  branchId: string,
  branchName: string,
  userId?: string | null
): { appliedCount: number; totalQty: number } {
  initPendingBranchStocksTable(db)
  const pendingRows = db.prepare(`
    SELECT id, product_id, quantity, stock_date, sale_price
    FROM pending_branch_stocks
    WHERE lower(trim(branch_name)) = lower(trim(?))
      AND status = 'pending'
  `).all(branchName) as { id: string; product_id: string; quantity: number; stock_date?: string; sale_price?: number }[]

  if (!pendingRows || pendingRows.length === 0) {
    return { appliedCount: 0, totalQty: 0 }
  }

  let appliedCount = 0
  let totalQty = 0

  db.transaction(() => {
    for (const row of pendingRows) {
      const prod = db.prepare('SELECT id, name FROM products WHERE id = ?').get(row.product_id) as { id: string; name: string } | undefined
      if (!prod) continue

      const existingStock = db.prepare(`
        SELECT id, quantity FROM stocks WHERE product_id = ? AND branch_id = ?
      `).get(row.product_id, branchId) as { id: string; quantity: number } | undefined

      if (existingStock) {
        db.prepare(`
          UPDATE stocks SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?
        `).run(row.quantity, existingStock.id)
      } else {
        db.prepare(`
          INSERT INTO stocks (id, product_id, branch_id, quantity, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'))
        `).run(crypto.randomUUID(), row.product_id, branchId, row.quantity)
      }

      if (row.quantity > 0) {
        insertStockMovement(db, {
          product_id: row.product_id,
          from_branch_id: null,
          to_branch_id: branchId,
          quantity: row.quantity,
          movement_type: 'ADJUSTMENT',
          notes: `Applied from pending import stock on branch creation (${branchName})`,
          created_by: userId || null,
        })
      }

      db.prepare(`
        UPDATE pending_branch_stocks
        SET status = 'applied', applied_at = datetime('now'), applied_branch_id = ?
        WHERE id = ?
      `).run(branchId, row.id)

      appliedCount++
      totalQty += row.quantity
    }
  })()

  // Async sync cloud row for each applied stock
  for (const row of pendingRows) {
    syncStockRow(db, row.product_id, branchId).catch(() => {})
  }

  return { appliedCount, totalQty }
}

/**
 * Dismisses pending branch stocks for a branch name if the user chooses not to import them.
 */
export function dismissPendingBranchStocks(db: Database.Database, branchName: string): number {
  initPendingBranchStocksTable(db)
  const res = db.prepare(`
    UPDATE pending_branch_stocks
    SET status = 'dismissed', applied_at = datetime('now')
    WHERE lower(trim(branch_name)) = lower(trim(?))
      AND status = 'pending'
  `).run(branchName)
  return res.changes
}
