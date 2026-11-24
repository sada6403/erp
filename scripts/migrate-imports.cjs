// Explicit staging copy only; no Electron application/database bootstrap.
const fs=require('fs')
const path=require('path')
const Database=require('better-sqlite3')
const {migrateImports}=require('../dist-electron/services/importMigration')
const args=process.argv.slice(2)
const value=flag=>{const index=args.indexOf(flag);return index>=0?args[index+1]:undefined}
async function main(){
 if(!args.includes('--staging-copy'))throw new Error('Use --staging-copy; production migration is not enabled by this command')
 const file=value('--db'),directory=value('--backup-dir'),direction=value('--direction')||'up'
 if(!file||!directory||!['up','down'].includes(direction))throw new Error('Use --db <staging.db> --backup-dir <directory> --direction up|down --staging-copy')
 const db=new Database(path.resolve(file),{fileMustExist:true})
 try {const backup=await migrateImports(db,path.resolve(directory),fs.readFileSync(path.join(__dirname,`../database/migrations/imports.${direction}.sql`),'utf8'),direction);console.log(backup?`Migration applied after verified backup: ${backup}`:'Already applied; no changes')}finally{db.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
