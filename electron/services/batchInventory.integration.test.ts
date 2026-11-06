import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { reduceSaleBatchQuantity, quoteBatchPrice, allocateSaleBatches, cancelReturnedSaleBatches, createReceiptBatch, restoreReturnedSaleBatches, reverseInvoiceBatchAllocations } from './batchInventory'

describe('supermarket batch inventory ledger', () => {
  let db: Database.Database
  beforeEach(() => {
    db = new Database(':memory:')
    db.pragma('foreign_keys = ON')
    db.exec(`
      CREATE TABLE branches (id TEXT PRIMARY KEY);
      CREATE TABLE products (id TEXT PRIMARY KEY);
      CREATE TABLE purchase_orders (id TEXT PRIMARY KEY);
      CREATE TABLE purchase_items (id TEXT PRIMARY KEY);
      CREATE TABLE invoices (id TEXT PRIMARY KEY);
      CREATE TABLE invoice_items (id TEXT PRIMARY KEY);
      CREATE TABLE returns (id TEXT PRIMARY KEY);
      CREATE TABLE return_items (id TEXT PRIMARY KEY);
      CREATE TABLE stocks (id TEXT PRIMARY KEY, product_id TEXT, branch_id TEXT, warehouse_id TEXT, quantity REAL, damaged_qty REAL DEFAULT 0);
      CREATE TABLE product_batches (
        id TEXT PRIMARY KEY, product_id TEXT NOT NULL, branch_id TEXT, batch_number TEXT,
        serial_number TEXT, expiry_date TEXT, mfg_date TEXT, quantity REAL NOT NULL DEFAULT 0,
        cost_price REAL NOT NULL DEFAULT 0, selling_price REAL, po_id TEXT, purchase_item_id TEXT,
        purchase_date TEXT, original_quantity REAL NOT NULL DEFAULT 0, sold_quantity REAL NOT NULL DEFAULT 0,
        returned_quantity REAL NOT NULL DEFAULT 0, damaged_quantity REAL NOT NULL DEFAULT 0,
        historical_cost_known INTEGER NOT NULL DEFAULT 1, status TEXT NOT NULL DEFAULT 'available',
        notes TEXT, created_by TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      CREATE TABLE sale_batch_allocations (
        id TEXT PRIMARY KEY, invoice_id TEXT NOT NULL, invoice_item_id TEXT NOT NULL,
        product_id TEXT NOT NULL, batch_id TEXT NOT NULL, branch_id TEXT NOT NULL,
        quantity REAL NOT NULL, returned_quantity REAL NOT NULL DEFAULT 0,
        unit_cost REAL NOT NULL, unit_selling_price REAL NOT NULL, cost_known INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      CREATE TABLE return_batch_allocations (
        id TEXT PRIMARY KEY, return_id TEXT NOT NULL, return_item_id TEXT NOT NULL,
        sale_allocation_id TEXT NOT NULL, batch_id TEXT NOT NULL, quantity REAL NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), synced_at TEXT
      );
      INSERT INTO branches VALUES ('branch'); INSERT INTO products VALUES ('rice');
      INSERT INTO purchase_orders VALUES ('po1'); INSERT INTO purchase_orders VALUES ('po2');
      INSERT INTO purchase_items VALUES ('pi1'); INSERT INTO purchase_items VALUES ('pi2');
      INSERT INTO invoices VALUES ('inv'); INSERT INTO invoice_items VALUES ('item');
      INSERT INTO returns VALUES ('ret'); INSERT INTO return_items VALUES ('ret-item');
      INSERT INTO stocks VALUES ('stock','rice','branch',NULL,15,0);
    `)
  })
  afterEach(() => db.close())

  it('passes the mandatory Rice FIFO and financial calculation', () => {
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 5, unitCost: 150, sellingPrice: 250, purchaseDate: '2026-11-05' })
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po2', purchaseItemId: 'pi2', quantity: 10, unitCost: 200, sellingPrice: 250, purchaseDate: '2026-11-06' })
    const inventory = db.prepare('SELECT SUM(quantity * cost_price) cost, SUM(quantity) quantity FROM product_batches').get() as { cost: number; quantity: number }
    expect(inventory).toEqual({ cost: 2750, quantity: 15 })

    const allocations = db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 7, unitSellingPrice: 250 }))()
    expect(allocations.map(row => [row.quantity, row.unit_cost])).toEqual([[5, 150], [2, 200]])
    const cogs = allocations.reduce((sum, row) => sum + row.quantity * row.unit_cost, 0)
    expect(cogs).toBe(1150)
    expect(7 * 250 - cogs).toBe(600)
    const remaining = db.prepare('SELECT SUM(quantity) quantity, SUM(quantity * cost_price) cost, SUM(quantity * COALESCE(selling_price,0)) sales FROM product_batches').get() as { quantity: number; cost: number; sales: number }
    expect(remaining).toEqual({ quantity: 8, cost: 1600, sales: 2000 })
    expect(remaining.sales - remaining.cost).toBe(400)
  })

  it('rejects overselling and reverses the exact original cost layers', () => {
    db.prepare('UPDATE stocks SET quantity=5').run()
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 5, unitCost: 150, purchaseDate: '2026-11-05' })
    expect(() => db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 16, unitSellingPrice: 250 }))()).toThrow(/Insufficient batch stock/)
    const allocations = db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 3, unitSellingPrice: 250 }))()
    expect(allocations).toHaveLength(1)
    db.transaction(() => reverseInvoiceBatchAllocations(db, 'inv'))()
    expect((db.prepare('SELECT quantity, sold_quantity FROM product_batches WHERE id=?').get(allocations[0].batch_id) as { quantity: number; sold_quantity: number })).toEqual({ quantity: 5, sold_quantity: 0 })
  })

  it('restores a partial return to its original cost allocation and can cancel it', () => {
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 5, unitCost: 150, purchaseDate: '2026-11-05' })
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po2', purchaseItemId: 'pi2', quantity: 10, unitCost: 200, purchaseDate: '2026-11-06' })
    db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 7, unitSellingPrice: 250 }))()
    const restored = db.transaction(() => restoreReturnedSaleBatches(db, { returnId: 'ret', returnItemId: 'ret-item', invoiceItemId: 'item', quantity: 1 }))()
    expect(restored).toHaveLength(1)
    expect((db.prepare('SELECT quantity FROM product_batches WHERE id=?').get(restored[0].batch_id) as { quantity: number }).quantity).toBe(9)
    db.transaction(() => cancelReturnedSaleBatches(db, 'ret'))()
    expect((db.prepare('SELECT quantity FROM product_batches WHERE id=?').get(restored[0].batch_id) as { quantity: number }).quantity).toBe(8)
  })
  it('prices a sale spanning batches and supports the common price without changing purchase costs', () => {
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 5, unitCost: 150, sellingPrice: 250, purchaseDate: '2026-11-05' })
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po2', purchaseItemId: 'pi2', quantity: 10, unitCost: 200, sellingPrice: 300, purchaseDate: '2026-11-06' })
    expect(quoteBatchPrice(db, 'rice', 'branch', 10, 400)).toBe(275)
    db.prepare('UPDATE product_batches SET selling_price=NULL').run()
    expect(quoteBatchPrice(db, 'rice', 'branch', 10, 400)).toBe(400)
    expect((db.prepare('SELECT SUM(quantity*cost_price) cost FROM product_batches').get() as { cost: number }).cost).toBe(2750)
  })

  it('deducts fractional quantities and preserves discounted sale revenue', () => {
    db.prepare('UPDATE stocks SET quantity=1.5').run()
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 1.5, unitCost: 150, purchaseDate: '2026-11-05' })
    const rows = db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 0.75, unitSellingPrice: 225 }))()
    expect(rows[0].quantity).toBe(0.75)
    expect(rows[0].quantity*(rows[0].unit_selling_price-rows[0].unit_cost)).toBe(56.25)
  })

  it('keeps invoice quantity corrections and batch stock consistent', () => {
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po1', purchaseItemId: 'pi1', quantity: 5, unitCost: 150, purchaseDate: '2026-11-05' })
    createReceiptBatch(db, { productId: 'rice', branchId: 'branch', purchaseId: 'po2', purchaseItemId: 'pi2', quantity: 10, unitCost: 200, purchaseDate: '2026-11-06' })
    db.transaction(() => allocateSaleBatches(db, { invoiceId: 'inv', invoiceItemId: 'item', productId: 'rice', branchId: 'branch', quantity: 7, unitSellingPrice: 250 }))()
    db.transaction(() => reduceSaleBatchQuantity(db, 'item', 3))()
    const stock = db.prepare('SELECT SUM(quantity) quantity, SUM(quantity*cost_price) cost FROM product_batches').get()
    expect(stock).toEqual({ quantity: 11, cost: 2150 })
    const sold = db.prepare('SELECT SUM(quantity-returned_quantity) quantity FROM sale_batch_allocations').get()
    expect(sold).toEqual({ quantity: 4 })
  })

})
