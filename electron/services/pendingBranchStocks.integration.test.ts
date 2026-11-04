import { afterEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
vi.mock('./stockSync', () => ({ syncStockRow: vi.fn().mockResolvedValue(undefined) }))
import { applyPendingBranchStocks, getPendingBranchStocksSummary, recordPendingBranchStock } from './pendingBranchStocks'

const db = new Database(':memory:')
db.exec(`
  CREATE TABLE products (id TEXT PRIMARY KEY, name TEXT);
  CREATE TABLE branches (id TEXT PRIMARY KEY);
  CREATE TABLE stocks (id TEXT PRIMARY KEY, product_id TEXT, branch_id TEXT, quantity INTEGER, updated_at TEXT);
  CREATE TABLE stock_movements (id TEXT, product_id TEXT, variant_id TEXT, from_branch_id TEXT, to_branch_id TEXT,
    quantity INTEGER, movement_type TEXT, reference_order_id TEXT, reference_transfer_id TEXT,
    reference_branch_transfer_id TEXT, notes TEXT, created_by TEXT, status TEXT);
  INSERT INTO products VALUES ('p1', 'BED');
  INSERT INTO branches VALUES ('b1');
`)
afterEach(() => {
  db.exec('DELETE FROM stocks; DELETE FROM stock_movements; DELETE FROM pending_branch_stocks;')
})
describe('pending furniture branch stock', () => {
  it('stages missing branch stock and applies it exactly once with a movement', () => {
    recordPendingBranchStock(db, { branchName: 'CHAVAKACHERY', productId: 'p1', quantity: 6 })
    expect(getPendingBranchStocksSummary(db)[0]).toMatchObject({ item_count: 1, total_qty: 6 })
    expect(applyPendingBranchStocks(db, 'b1', ' chavakachery ')).toEqual({ appliedCount: 1, totalQty: 6 })
    expect(applyPendingBranchStocks(db, 'b1', 'CHAVAKACHERY')).toEqual({ appliedCount: 0, totalQty: 0 })
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 6 })
    expect(db.prepare('SELECT COUNT(*) AS count FROM stock_movements').get()).toEqual({ count: 1 })
    expect(getPendingBranchStocksSummary(db)).toEqual([])
  })
  it('reimport replaces pending quantity and applies to existing stock', () => {
    recordPendingBranchStock(db, { branchName: 'Jaffna', productId: 'p1', quantity: 3 })
    recordPendingBranchStock(db, { branchName: ' JAFFNA ', productId: 'p1', quantity: 8 })
    db.prepare('INSERT INTO stocks VALUES (?, ?, ?, ?, NULL)').run('s1', 'p1', 'b1', 2)
    expect(getPendingBranchStocksSummary(db)).toHaveLength(1)
    expect(applyPendingBranchStocks(db, 'b1', 'jaffna')).toEqual({ appliedCount: 1, totalQty: 8 })
    expect(db.prepare('SELECT quantity FROM stocks').get()).toEqual({ quantity: 10 })
  })
  it('keeps pending stock intact if recording the movement fails', () => {
    recordPendingBranchStock(db, { branchName: 'Jaffna', productId: 'p1', quantity: 8 })
    db.exec(`CREATE TRIGGER reject_qa_movement BEFORE INSERT ON stock_movements
      BEGIN SELECT RAISE(ABORT, 'QA movement failure'); END;`)
    try {
      expect(() => applyPendingBranchStocks(db, 'b1', 'Jaffna')).toThrow('QA movement failure')
      expect(db.prepare('SELECT COUNT(*) AS count FROM stocks').get()).toEqual({ count: 0 })
      expect(getPendingBranchStocksSummary(db)[0]).toMatchObject({ item_count: 1, total_qty: 8 })
    } finally {
      db.exec('DROP TRIGGER reject_qa_movement')
    }
  })
})
