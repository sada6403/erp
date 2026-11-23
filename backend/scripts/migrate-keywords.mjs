// Explicit test database only. No startup/build migration or production target.
import mysql from 'mysql2/promise'
import {readFile,mkdir,stat} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {spawn} from 'node:child_process'
import {pipeline} from 'node:stream/promises'
import path from 'node:path'
if(process.env.KEYWORDS_ENV!=='test')throw new Error('Set KEYWORDS_ENV=test; production migration is not enabled')
const database=process.env.KEYWORDS_TEST_DATABASE
if(!database||!/^[a-zA-Z0-9_]+$/.test(database)||!database.toLowerCase().includes('test'))throw new Error('Use a dedicated test database')
const backupDir=process.env.KEYWORDS_BACKUP_DIR
if(!backupDir||!path.isAbsolute(backupDir))throw new Error('Provide absolute KEYWORDS_BACKUP_DIR')
const direction=process.argv[2]||'up'
if(!['up','down'].includes(direction))throw new Error('Choose up or down')
const cfg={host:process.env.MYSQL_HOST||'127.0.0.1',port:Number(process.env.MYSQL_PORT||3306),user:process.env.MYSQL_USER||'root',password:process.env.MYSQL_PASSWORD||'',database}
await mkdir(backupDir,{recursive:true})
const destination=path.join(backupDir,`${database}-keywords-${direction}-${Date.now()}.sql`)
const dump=spawn(process.env.MYSQLDUMP_BIN||'mysqldump',[`--host=${cfg.host}`,`--port=${cfg.port}`,`--user=${cfg.user}`,'--single-transaction','--routines','--triggers',database],{env:{...process.env,MYSQL_PWD:cfg.password},windowsHide:true})
dump.stderr.resume()
const closed=new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('close',code=>code===0?resolve():reject(new Error('Backup failed; migration was not applied')))})
await Promise.all([pipeline(dump.stdout,createWriteStream(destination,{flags:'wx'})),closed])
if(!(await stat(destination)).size)throw new Error('Empty backup; migration was not applied')
const conn=await mysql.createConnection(cfg)
try {
  if(direction==='down') {
    const [tables]=await conn.query("SHOW TABLES LIKE 'product_search_keywords'")
    if(tables.length) {const [rows]=await conn.query('SELECT COUNT(*) AS n FROM product_search_keywords');if(Number(rows[0].n))throw new Error('Disable feature instead: populated keywords cannot be dropped')}
  }
  const sql=await readFile(new URL(`../database/migrate-008-keywords.${direction}.sql`,import.meta.url),'utf8')
  for(const statement of sql.replace(/^\s*--.*$/gm,'').split(';').map(value=>value.trim()).filter(Boolean))await conn.query(statement)
  console.log('Keywords test migration applied. Verify restore on a separate test database. Backup:',destination)
}finally{await conn.end()}
