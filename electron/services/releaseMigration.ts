import type Database from 'better-sqlite3'
import SQLite from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import {randomUUID,createHash} from 'crypto'
import {backfillLoginIds} from './loginIdentity'
export async function migrateRelease210(db:Database.Database,directory:string,sql:string) {
 const table=(name:string)=>Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name))
 if(table('release_migration_receipts')&&db.prepare("SELECT 1 FROM release_migration_receipts WHERE version='2.10.0'").get())return
 const conflicts=db.prepare('SELECT LOWER(TRIM(email)) email,COUNT(*) n FROM users GROUP BY LOWER(TRIM(email)) HAVING COUNT(*)>1').all()
 if(conflicts.length)throw new Error('Case-insensitive duplicate emails require admin review before upgrading; no users were changed')
 fs.mkdirSync(directory,{recursive:true});const backup=path.join(directory,`pre-2.10-${randomUUID()}.db`)
 await db.backup(backup);const copy=new SQLite(backup,{readonly:true,fileMustExist:true})
 try{if(copy.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Release backup failed integrity verification')}finally{copy.close()}
 db.transaction(()=>{
  const add=(table:string,name:string,definition:string)=>{if(!(db.prepare(`PRAGMA table_info(${table})`).all() as {name:string}[]).some(row=>row.name===name))db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`)}
  add('users','login_id','TEXT');add('users','login_id_generated','INTEGER NOT NULL DEFAULT 1')
  backfillLoginIds(db);db.exec(sql)
  if(table('product_batches')){
   add('product_batches','batch_identity_id','TEXT REFERENCES product_batch_identities(id)')
   add('product_batches','batch_entry_mode',"TEXT NOT NULL DEFAULT 'new'")
   add('product_batches','batch_warning_ack','INTEGER NOT NULL DEFAULT 0')
   const rows=db.prepare("SELECT * FROM product_batches WHERE TRIM(COALESCE(batch_number,''))!='' ORDER BY created_at,id").all() as Record<string,any>[]
   for(const row of rows){
    const no=String(row.batch_number).normalize('NFC').trim(),expiry=String(row.expiry_date||'')
    const id=createHash('sha256').update(JSON.stringify([row.product_id,no,expiry])).digest('hex').slice(0,32),now=new Date().toISOString()
    const old=db.prepare('SELECT mfg_date FROM product_batch_identities WHERE id=?').get(id) as {mfg_date:string|null}|undefined
    db.prepare('INSERT OR IGNORE INTO product_batch_identities(id,product_id,batch_no,expiry_date,mfg_date,created_at,updated_at) VALUES(?,?,?,?,?,?,?)').run(id,row.product_id,no,expiry,row.mfg_date||null,now,now)
    if(old&&String(old.mfg_date||'')!==String(row.mfg_date||''))db.prepare('UPDATE product_batch_identities SET needs_review=1 WHERE id=?').run(id)
    db.prepare('UPDATE product_batches SET batch_identity_id=? WHERE id=?').run(id,row.id)
   }
  }
  if(table('purchase_items'))add('purchase_items','mfg_date','TEXT')
  db.prepare("INSERT INTO release_migration_receipts VALUES('2.10.0',?,?)").run(backup,new Date().toISOString())
 }).immediate()
 return backup
}
