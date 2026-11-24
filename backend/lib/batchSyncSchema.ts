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
 const {rows}=await client.query<{TABLE_NAME:string;COLUMN_NAME:string}>("SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('product_batches','purchase_items')")
 const columns:[string,string,string][]=[
  ['product_batches','batch_identity_id','VARCHAR(191) NULL'],
  ['product_batches','mfg_date','VARCHAR(10) NULL'],
  ['product_batches','batch_entry_mode',"VARCHAR(20) NOT NULL DEFAULT 'new'"],
  ['product_batches','batch_warning_ack','BOOLEAN NOT NULL DEFAULT 0'],
  ['purchase_items','mfg_date','VARCHAR(10) NULL'],
 ]
 for(const [table,column,definition] of columns){
  if(!rows.some(row=>row.TABLE_NAME===table)||rows.some(row=>row.TABLE_NAME===table&&row.COLUMN_NAME===column))continue
  try{await client.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`)}
  catch(error){if(!/Duplicate column name/i.test(String(error)))throw error}
 }
}
