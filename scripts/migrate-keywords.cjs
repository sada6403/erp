// Use Electron's SQLite ABI. Explicit staging copy only; no app bootstrap.
const fs=require('fs')
const path=require('path')
const SQLite=require('better-sqlite3')
const {migrateKeywords}=require('../dist-electron/services/keywordMigration')
const args=process.argv.slice(2)
const value=flag=>{const i=args.indexOf(flag);return i>=0?args[i+1]:undefined}
async function main(){
  if(!args.includes('--staging-copy'))throw new Error('Explicit --staging-copy required; never point this at production')
  const file=value('--db'),backup=value('--backup-dir'),direction=value('--direction')||'up'
  if(!file||!backup||!['up','down'].includes(direction))throw new Error('Use --db <staging.db> --backup-dir <directory> --direction up|down --staging-copy')
  const db=new SQLite(path.resolve(file),{fileMustExist:true})
  try{db.pragma('foreign_keys=ON');const result=await migrateKeywords(db,path.resolve(backup),fs.readFileSync(path.join(__dirname,`../database/migrations/keywords.${direction}.sql`),'utf8'),direction);console.log(result?`Migration applied; verified backup: ${result}`:'Already applied; no changes')}finally{db.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
