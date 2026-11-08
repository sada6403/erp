// Explicit test-environment migration, never runs during app startup/build.
import mysql from 'mysql2/promise'
import { readFile, mkdir, stat } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { spawn } from 'node:child_process'
import { pipeline } from 'node:stream/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.env.MANAGEMENT_ENV !== 'test') throw new Error('Set MANAGEMENT_ENV=test and use a dedicated test database. Production migration is not enabled.')
const database = process.env.MANAGEMENT_TEST_DATABASE
if (!database || !/^[a-zA-Z0-9_]+$/.test(database) || !database.toLowerCase().includes('test')) throw new Error('MANAGEMENT_TEST_DATABASE must name a test database')
const backupDir = process.env.MANAGEMENT_BACKUP_DIR
if (!backupDir || !path.isAbsolute(backupDir)) throw new Error('MANAGEMENT_BACKUP_DIR must be an absolute backup directory')
const cfg = {host:process.env.MYSQL_HOST || '127.0.0.1',port:Number(process.env.MYSQL_PORT || 3306),user:process.env.MYSQL_USER || 'root',password:process.env.MYSQL_PASSWORD || '',database}
await mkdir(backupDir,{recursive:true})
const destination = path.join(backupDir,`${database}-${Date.now()}.sql`)
const dump = spawn(process.env.MYSQLDUMP_BIN || 'mysqldump',[`--host=${cfg.host}`,`--port=${cfg.port}`,`--user=${cfg.user}`,'--single-transaction','--routines','--triggers',database],{env:{...process.env,MYSQL_PWD:cfg.password},windowsHide:true})
// Do not log CLI stderr because vendor tools may include connection details.
dump.stderr.resume()
const closed = new Promise((resolve,reject)=>{dump.on('error',reject);dump.on('close',code=>code===0?resolve():reject(new Error('Backup failed; migration was not applied')))})
await Promise.all([pipeline(dump.stdout,createWriteStream(destination,{flags:'wx'})),closed])
if ((await stat(destination)).size===0) throw new Error('Empty backup; migration was not applied')
const connection = await mysql.createConnection(cfg)
try {
 const sql = await readFile(fileURLToPath(new URL('../database/migrate-007-management.sql',import.meta.url)),'utf8')
 for (const statement of sql.split(';').map(s=>s.trim()).filter(Boolean)) await connection.query(statement)
 await connection.query("INSERT INTO management_settings (id,value) VALUES ('enabled','true') ON DUPLICATE KEY UPDATE value='true'")
 console.log('Management test migration applied. Backup:',destination)
} finally { await connection.end() }
