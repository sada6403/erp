import type Database from 'better-sqlite3'
import SQLite from 'better-sqlite3'
import {randomUUID} from 'crypto'
import fs from 'fs'
import path from 'path'
const pending=new WeakMap<Database.Database,Promise<string|undefined>>()
export function importsInstalled(db:Database.Database){return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='import_jobs'").get())}
export function migrateImports(db:Database.Database,backupDir:string,sql:string,direction:'up'|'down'='up'):Promise<string|undefined>{
 if(pending.has(db))return pending.get(db)!
 const task=(async()=>{
  if(db.inTransaction)throw new Error('Import migration cannot run during a transaction')
  const exists=importsInstalled(db)
  if(direction==='up'&&exists||direction==='down'&&!exists)return undefined
  if(direction==='down')for(const table of ['import_jobs','import_job_rows','import_mapping_templates'])if((db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as {n:number}).n)throw new Error('Disable bulk import instead; populated import history cannot be dropped')
  fs.mkdirSync(backupDir,{recursive:true});const backup=path.join(backupDir,`pre-imports-${direction}-${randomUUID()}.db`)
  await db.backup(backup);const copy=new SQLite(backup,{readonly:true,fileMustExist:true})
  try{if(copy.pragma('integrity_check',{simple:true})!=='ok')throw new Error('Import backup verification failed')}finally{copy.close()}
  db.transaction(()=>db.exec(sql)).immediate();return backup
 })();pending.set(db,task);void task.finally(()=>pending.delete(db)).catch(()=>{});return task
}
