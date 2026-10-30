import type Database from 'better-sqlite3'

/**
 * Reconciles incoming product records from cloud sync that share the same SKU
 * as an existing local product record but have a different ID.
 *
 * In SQLite, products.sku has a UNIQUE constraint. If an offline or draft product
 * was created locally with the same SKU as a canonical cloud product, a raw
 * INSERT ... ON CONFLICT(id) fails with `UNIQUE constraint failed: products.sku`.
 *
 * This function re-points all local relational dependencies (sales, stocks, orders)
 * to the canonical incoming cloud ID, cleans up the conflicting local product,
 * and clears the collision so the cloud product can be inserted cleanly.
 */
export function reconcileIncomingProduct(
  db: Database.Database,
  incomingProductId: string,
  incomingSku: unknown
): void {
  const sku = String(incomingSku || '').trim()
  if (!incomingProductId || !sku) return

  const existing = db.prepare(`
    SELECT id, name, is_active FROM products
    WHERE UPPER(TRIM(sku)) = UPPER(TRIM(?))
    LIMIT 1
  `).get(sku) as { id: string; name: string; is_active: number } | undefined

  if (!existing || existing.id === incomingProductId) return

  console.warn(
    `[SyncService] Product SKU collision detected: local product ${existing.id} ("${existing.name}") ` +
    `shares SKU "${sku}" with incoming cloud product ${incomingProductId}. ` +
    `Reconciling references and replacing with canonical cloud product.`
  )

  db.pragma('foreign_keys = OFF')
  try {
    db.transaction(() => {
      // 1. Re-link foreign key references from standard child tables
      const foreignKeyTables = [
        'invoice_items',
        'stock_movements',
        'customer_order_items',
        'purchase_items',
        'product_variants',
        'product_variant_stocks',
        'product_batches',
        'chit_schemes',
      ]
      for (const table of foreignKeyTables) {
        try {
          db.prepare(`UPDATE "${table}" SET product_id = ? WHERE product_id = ?`)
            .run(incomingProductId, existing.id)
        } catch {
          // Table may not exist in some migrations
        }
      }

      // stock_count_items: handle UNIQUE(session_id, product_id)
      try {
        const countItems = db.prepare(`SELECT id, session_id FROM stock_count_items WHERE product_id = ?`).all(existing.id) as Array<{ id: string; session_id: string }>
        for (const item of countItems) {
          const target = db.prepare(`SELECT id FROM stock_count_items WHERE session_id = ? AND product_id = ?`).get(item.session_id, incomingProductId)
          if (target) {
            db.prepare(`DELETE FROM stock_count_items WHERE id = ?`).run(item.id)
          } else {
            db.prepare(`UPDATE stock_count_items SET product_id = ? WHERE id = ?`).run(incomingProductId, item.id)
          }
        }
      } catch {}

      // 2. Stocks: handle UNIQUE(product_id, branch_id, warehouse_id)
      try {
        const localStocks = db.prepare(`SELECT * FROM stocks WHERE product_id = ?`).all(existing.id) as Array<{
          id: string
          branch_id: string
          warehouse_id: string | null
          quantity: number
          damaged_qty: number
        }>
        for (const ls of localStocks) {
          const targetStock = db.prepare(`
            SELECT id FROM stocks WHERE product_id = ? AND branch_id = ? AND warehouse_id IS ?
          `).get(incomingProductId, ls.branch_id, ls.warehouse_id) as { id: string } | undefined
          if (targetStock) {
            db.prepare(`DELETE FROM stocks WHERE id = ?`).run(ls.id)
          } else {
            db.prepare(`UPDATE stocks SET product_id = ? WHERE id = ?`).run(incomingProductId, ls.id)
          }
        }
      } catch {}

      // 3. Audit logs
      try {
        db.prepare(`UPDATE audit_logs SET record_id = ? WHERE record_id = ? AND (table_name = 'products' OR table_name IS NULL)`)
          .run(incomingProductId, existing.id)
      } catch {}

      // 4. Pending sync deletions
      try {
        db.prepare(`DELETE FROM pending_sync_deletions WHERE record_id = ? AND table_name = 'products'`)
          .run(existing.id)
      } catch {}

      // 5. Sync queue: re-map references and mark local row synced so it won't push back
      try {
        db.prepare(`UPDATE sync_queue SET payload = REPLACE(payload, ?, ?) WHERE payload LIKE '%' || ? || '%'`)
          .run(existing.id, incomingProductId, existing.id)
        db.prepare(`UPDATE sync_queue SET status = 'synced', synced_at = datetime('now'), last_error = NULL
          WHERE table_name = 'products' AND record_id = ? AND status != 'synced'`).run(existing.id)
      } catch {}

      // 6. Delete the conflicting local product so the incoming canonical cloud product can insert cleanly
      db.prepare(`DELETE FROM products WHERE id = ?`).run(existing.id)
    })()
  } finally {
    db.pragma('foreign_keys = ON')
  }
}
