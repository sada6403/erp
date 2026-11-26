import type Database from 'better-sqlite3'

/** Nullable/defaulted additions only; legacy stock and invoice amounts stay unchanged. */
export function migrateSupermarketPurchases(db:Database.Database){
 const additions:Record<string,Record<string,string>>={
  purchase_items:{paid_quantity:'REAL',free_quantity:'REAL NOT NULL DEFAULT 0',discount_amount:'REAL NOT NULL DEFAULT 0',purchase_unit_cost:'REAL',mrp:'REAL',entry_unit:'TEXT',entry_quantity:'REAL',entry_free_quantity:'REAL',unit_factor:'REAL NOT NULL DEFAULT 1'},
  product_batches:{mrp:'REAL',supplier_returned_quantity:'REAL NOT NULL DEFAULT 0'},
  products:{inventory_pricing_mode:"TEXT NOT NULL DEFAULT 'batch'",pricing_markup_pct:'REAL NOT NULL DEFAULT 0'},
  purchase_orders:{paid_amount:'REAL NOT NULL DEFAULT 0',outstanding_amount:'REAL NOT NULL DEFAULT 0',payment_status:"TEXT NOT NULL DEFAULT 'unpaid'",returned_amount:'REAL NOT NULL DEFAULT 0',applied_supplier_credit:'REAL NOT NULL DEFAULT 0',refund_credit_amount:'REAL NOT NULL DEFAULT 0',updated_at:'TEXT'},
  suppliers:{due_balance:'REAL NOT NULL DEFAULT 0',credit_balance:'REAL NOT NULL DEFAULT 0',updated_at:'TEXT'},
 }
 for(const [table,columns] of Object.entries(additions)){
  const existing=new Set((db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).map(row=>row.name))
  if(!existing.size)continue
  for(const [column,type] of Object.entries(columns))if(!existing.has(column))db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`)
 }
 db.exec(`CREATE TABLE IF NOT EXISTS purchase_returns(
  id TEXT PRIMARY KEY,purchase_id TEXT NOT NULL REFERENCES purchase_orders(id),branch_id TEXT NOT NULL REFERENCES branches(id),supplier_id TEXT NOT NULL REFERENCES suppliers(id),
  return_number TEXT NOT NULL,return_date TEXT NOT NULL,reason TEXT NOT NULL,total_amount REAL NOT NULL DEFAULT 0,created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),synced_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_purchase_returns_purchase ON purchase_returns(purchase_id);
 CREATE TABLE IF NOT EXISTS purchase_return_items(
  id TEXT PRIMARY KEY,purchase_return_id TEXT NOT NULL REFERENCES purchase_returns(id),purchase_item_id TEXT NOT NULL REFERENCES purchase_items(id),batch_id TEXT NOT NULL REFERENCES product_batches(id),
  product_id TEXT NOT NULL REFERENCES products(id),quantity REAL NOT NULL,unit_cost REAL NOT NULL,line_total REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),synced_at TEXT);
 CREATE INDEX IF NOT EXISTS idx_purchase_return_items_parent ON purchase_return_items(purchase_return_id);
 CREATE TABLE IF NOT EXISTS product_barcodes(
  id TEXT PRIMARY KEY,product_id TEXT NOT NULL REFERENCES products(id),barcode TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),updated_at TEXT NOT NULL DEFAULT (datetime('now')),synced_at TEXT);
 CREATE UNIQUE INDEX IF NOT EXISTS uq_product_barcodes_barcode ON product_barcodes(barcode);
 CREATE INDEX IF NOT EXISTS idx_product_barcodes_product ON product_barcodes(product_id);`)
}
