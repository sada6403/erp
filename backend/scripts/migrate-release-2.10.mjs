import mysql from 'mysql2/promise'
import {readFile,mkdir,stat} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {spawn} from 'node:child_process'
import {pipeline} from 'node:stream/promises'
import {createHash} from 'node:crypto'
import path from 'node:path'
const database=process.env.RELEASE_DATABASE,backupDir=process.env.RELEASE_BACKUP_DIR
if(!database||!/^[a-zA-Z0-9_]+$/.test(database)||!backupDir||!path.isAbsolute(backupDir))throw new Error('Set RELEASE_DATABASE and absolute RELEASE_BACKUP_DIR')
if(process.env.RELEASE_ENV!=='staging')throw new Error('Set RELEASE_ENV=staging and use an isolated copy; this runner does not authorize production migration')
const direction=process.argv[2]||'up',platform=process.argv.includes('--platform'),table=platform?'superadmins':'users'
if(!['up','down'].includes(direction))throw new Error('Choose up or down')
const cfg={host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'',database,dateStrings:true}
await mkdir(backupDir,{recursive:true});const backup=path.join(backupDir,`${database}-pre-2.10-${Date.now()}.sql`)
const dump=spawn(process.env.MYSQLDUMP_BIN||'mysqldump',[`--host=${cfg.host}`,`--port=${cfg.port}`,`--user=${cfg.user}`,'--single-transaction','--routines','--triggers',database],{env:{...process.env,MYSQL_PWD:cfg.password},windowsHide:true});dump.stderr.resume()
await Promise.all([pipeline(dump.stdout,createWriteStream(backup,{flags:'wx'})),new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('close',code=>code===0?resolve():reject(new Error('Backup failed; migration not started')))})])
if(!(await stat(backup)).size)throw new Error('Empty backup; migration not started')
const db=await mysql.createConnection(cfg)
try{
 const [columns]=await db.query('SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()')
 const has=(t,c)=>columns.some(row=>row.TABLE_NAME===t&&row.COLUMN_NAME===c)
 const [indexes]=await db.query('SELECT TABLE_NAME,INDEX_NAME FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE()')
 const index=(name)=>indexes.some(row=>row.TABLE_NAME===table&&row.INDEX_NAME===name)
 if(direction==='down'){
  for(const name of ['uq_login_id_ci','uq_login_email_ci'])if(index(name))await db.query(`ALTER TABLE ${table} DROP INDEX ${name}`)
  console.log('Compatibility rollback applied; all additive IDs, layers, hashes and batch keys retained. Backup:',backup)
 }else{
  const [duplicates]=await db.query(`SELECT LOWER(TRIM(email)) email,COUNT(*) n FROM ${table} GROUP BY LOWER(TRIM(email)) HAVING COUNT(*)>1`)
  if(duplicates.length)throw new Error('Duplicate emails require review; no identities were overwritten')
  const add=async(t,c,definition)=>{if(!has(t,c))await db.query(`ALTER TABLE ${t} ADD COLUMN ${c} ${definition}`)}
  await add(table,'login_id','VARCHAR(64) NULL');await add(table,'login_id_generated','BOOLEAN NOT NULL DEFAULT 1')
  const [users]=await db.query(`SELECT id,email,login_id FROM ${table} ORDER BY LOWER(email),id`),used=new Set(users.filter(row=>row.login_id).map(row=>row.login_id.toLowerCase()))
  for(const row of users)if(!row.login_id){let base=String(row.email||'').trim().toLowerCase().split('@')[0].replace(/[^a-z0-9._-]/g,'').replace(/^[^a-z0-9]+/,'').slice(0,48)||'user';if(base.length<2)base+='user';let id=base,n=1;while(used.has(id))id=base+ ++n;used.add(id);await db.query(`UPDATE ${table} SET login_id=?,login_id_generated=1 WHERE id=?`,[id,row.id])}
  await add(table,'login_id_ci','VARCHAR(64) GENERATED ALWAYS AS (LOWER(TRIM(login_id))) STORED')
  await add(table,'login_email_ci','VARCHAR(255) GENERATED ALWAYS AS (LOWER(TRIM(email))) STORED')
  if(!index('uq_login_id_ci'))await db.query(`CREATE UNIQUE INDEX uq_login_id_ci ON ${table}(login_id_ci)`)
  if(!index('uq_login_email_ci'))await db.query(`CREATE UNIQUE INDEX uq_login_email_ci ON ${table}(login_email_ci)`)
  if(!platform){
   await add('users','force_password_change','BOOLEAN NOT NULL DEFAULT 0');await add('users','login_attempts','INT NOT NULL DEFAULT 0');await add('users','locked_until','DATETIME NULL')
   const sql=await readFile(new URL('../database/migrate-009-release-2.10.up.sql',import.meta.url),'utf8')
   for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(value=>value.trim()).filter(Boolean))await db.query(statement)
   await add('product_batches','batch_identity_id','VARCHAR(191) NULL')
   await add('product_batches','mfg_date','VARCHAR(10) NULL')
   await add('product_batches','batch_entry_mode',"VARCHAR(20) NOT NULL DEFAULT 'new'")
   await add('product_batches','batch_warning_ack','BOOLEAN NOT NULL DEFAULT 0')
   await add('purchase_items','mfg_date','VARCHAR(10) NULL')
   const [batches]=await db.query("SELECT * FROM product_batches WHERE TRIM(COALESCE(batch_number,''))!='' ORDER BY created_at,id")
   for(const batch of batches){const no=String(batch.batch_number).normalize('NFC').trim(),expiry=String(batch.expiry_date||''),mfg=batch.mfg_date||null;if(no.length>191)throw new Error('Legacy batch number exceeds 191 characters; review staging before deployment');const id=createHash('sha256').update(JSON.stringify([batch.product_id,no,expiry])).digest('hex').slice(0,32);await db.query('INSERT IGNORE INTO product_batch_identities(id,product_id,batch_no,expiry_date,mfg_date,created_at,updated_at) VALUES(?,?,?,?,?,NOW(),NOW())',[id,batch.product_id,no,expiry,mfg]);await db.query('UPDATE product_batch_identities SET needs_review=1 WHERE id=? AND NOT(mfg_date <=> ?)',[id,mfg]);await db.query('UPDATE product_batches SET batch_identity_id=? WHERE id=?',[id,batch.id])}
  }
  console.log('Release migration complete. Review generated User IDs and needs_review batch identities. Backup:',backup)
 }
}finally{await db.end()}
