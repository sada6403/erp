import type {QueryClient} from './db'

/** Additive compatibility only: never rewrites receipt quantities or costs. */
export async function ensureBatchSyncSchema(client:Pick<QueryClient,'query'>){
 await client.query(`CREATE TABLE IF NOT EXISTS product_batch_identities (
  id VARCHAR(191) NOT NULL PRIMARY KEY,product_id CHAR(36) NOT NULL,
  batch_no VARCHAR(191) COLLATE utf8mb4_bin NOT NULL,expiry_date VARCHAR(10) NOT NULL DEFAULT '',
  mfg_date VARCHAR(10) NULL,needs_review BOOLEAN NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_physical_batch(product_id,batch_no,expiry_date),
  INDEX idx_batch_identity_updated(updated_at,id)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`)
 await client.query(`CREATE TABLE IF NOT EXISTS purchase_returns (
  id VARCHAR(191) PRIMARY KEY,purchase_id VARCHAR(191) NOT NULL,branch_id VARCHAR(191) NOT NULL,supplier_id VARCHAR(191) NOT NULL,
  return_number VARCHAR(191) NOT NULL,return_date DATE NOT NULL,reason TEXT NOT NULL,total_amount DECIMAL(14,2) NOT NULL DEFAULT 0,created_by VARCHAR(191) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,synced_at DATETIME NULL,
  INDEX idx_purchase_returns_purchase(purchase_id),INDEX idx_purchase_returns_updated(updated_at))`)
 await client.query(`CREATE TABLE IF NOT EXISTS purchase_return_items (
  id VARCHAR(191) PRIMARY KEY,purchase_return_id VARCHAR(191) NOT NULL,purchase_item_id VARCHAR(191) NOT NULL,batch_id VARCHAR(191) NOT NULL,product_id VARCHAR(191) NOT NULL,
  quantity DECIMAL(18,6) NOT NULL,unit_cost DECIMAL(18,6) NOT NULL,line_total DECIMAL(14,2) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,synced_at DATETIME NULL,
  INDEX idx_purchase_return_items_parent(purchase_return_id),INDEX idx_purchase_return_items_updated(updated_at))`)
 // Same definition as database/migrate-008-keywords.up.sql. Desktops sync shared
 // search keywords, so every tenant needs the table, not only migrated ones.
 await client.query(`CREATE TABLE IF NOT EXISTS product_search_keywords (
  id CHAR(36) NOT NULL PRIMARY KEY,product_id CHAR(36) NOT NULL,
  keyword VARCHAR(255) NOT NULL,keyword_normalized VARCHAR(255) NOT NULL,keyword_type VARCHAR(20) NOT NULL,
  script VARCHAR(16) NOT NULL,source VARCHAR(20) NOT NULL,scope_type VARCHAR(16) NOT NULL,scope_key VARCHAR(191) NOT NULL,
  branch_id CHAR(36) NULL,terminal_id CHAR(36) NULL,user_id CHAR(36) NULL,parent_id CHAR(36) NULL,
  review_status VARCHAR(16) NOT NULL DEFAULT 'approved',created_by CHAR(36) NOT NULL,
  created_at DATETIME(3) NOT NULL,updated_at DATETIME(3) NOT NULL,
  version INT NOT NULL DEFAULT 1,is_active BOOLEAN NOT NULL DEFAULT 1,
  UNIQUE KEY uq_keyword_identity(product_id,keyword_normalized,scope_key),
  INDEX idx_keywords_normalized(keyword_normalized),INDEX idx_keywords_product(product_id),
  INDEX idx_keywords_scope(scope_type,scope_key,is_active,review_status),INDEX idx_keywords_updated(updated_at,id),
  CHECK(scope_type IN ('global','branch')),CHECK(terminal_id IS NULL AND user_id IS NULL)
 ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_bin`)
 const {rows}=await client.query<{TABLE_NAME:string;COLUMN_NAME:string}>("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('product_batches','purchase_items','products','purchase_orders','suppliers')")
 const columns:[string,string,string][]=[
  ['product_batches','batch_identity_id','VARCHAR(191) NULL'],
  ['product_batches','mfg_date','VARCHAR(10) NULL'],
  ['product_batches','batch_entry_mode',"VARCHAR(20) NOT NULL DEFAULT 'new'"],
  ['product_batches','batch_warning_ack','BOOLEAN NOT NULL DEFAULT 0'],
  ['purchase_items','mfg_date','VARCHAR(10) NULL'],
  ['purchase_items','paid_quantity','DECIMAL(18,6) NULL'],
  ['purchase_items','free_quantity','DECIMAL(18,6) NOT NULL DEFAULT 0'],
  ['purchase_items','discount_amount','DECIMAL(14,2) NOT NULL DEFAULT 0'],
  ['purchase_items','purchase_unit_cost','DECIMAL(18,6) NULL'],
  ['purchase_items','mrp','DECIMAL(18,6) NULL'],
  ['purchase_items','entry_unit','VARCHAR(50) NULL'],
  ['purchase_items','entry_quantity','DECIMAL(18,6) NULL'],
  ['purchase_items','entry_free_quantity','DECIMAL(18,6) NULL'],
  ['purchase_items','unit_factor','DECIMAL(18,6) NOT NULL DEFAULT 1'],
  ['product_batches','mrp','DECIMAL(18,6) NULL'],
  ['products','inventory_pricing_mode',"VARCHAR(20) NOT NULL DEFAULT 'batch'"],
  ['products','pricing_markup_pct','DECIMAL(12,4) NOT NULL DEFAULT 0'],
  ['product_batches','supplier_returned_quantity','DECIMAL(18,6) NOT NULL DEFAULT 0'],
  ['suppliers','credit_balance','DECIMAL(14,2) NOT NULL DEFAULT 0'],
  ['purchase_orders','returned_amount','DECIMAL(14,2) NOT NULL DEFAULT 0'],
  ['purchase_orders','applied_supplier_credit','DECIMAL(14,2) NOT NULL DEFAULT 0'],
  ['purchase_orders','refund_credit_amount','DECIMAL(14,2) NOT NULL DEFAULT 0'],
 ]
 for(const [table,column,definition] of columns){
  if(!rows.some(row=>row.TABLE_NAME===table)||rows.some(row=>row.TABLE_NAME===table&&row.COLUMN_NAME===column))continue
  try{await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)}
  catch(error){if(!/Duplicate column name/i.test(String(error)))throw error}
 }
}
