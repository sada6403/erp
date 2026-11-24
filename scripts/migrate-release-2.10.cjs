const fs=require('fs'),path=require('path'),Database=require('better-sqlite3')
const {migrateRelease210}=require('../dist-electron/services/releaseMigration')
const args=process.argv.slice(2),value=flag=>args[args.indexOf(flag)+1]
async function main(){
 if(!args.includes('--staging-copy')||!args.includes('--db')||!args.includes('--backup-dir'))throw new Error('Use --staging-copy --db <copy.db> --backup-dir <directory> [--down]')
 const db=new Database(path.resolve(value('--db')),{fileMustExist:true})
 try{
  if(args.includes('--down')){const backup=path.join(path.resolve(value('--backup-dir')),`pre-rollback-2.10-${Date.now()}.db`);fs.mkdirSync(path.dirname(backup),{recursive:true});await db.backup(backup);db.exec(fs.readFileSync(path.join(__dirname,'../database/migrations/release-2.10.down.sql'),'utf8'));console.log('Non-destructive rollback; IDs/layers/hashes retained. Backup:',backup)}
  else console.log(await migrateRelease210(db,path.resolve(value('--backup-dir')),fs.readFileSync(path.join(__dirname,'../database/migrations/release-2.10.up.sql'),'utf8'))||'Already migrated')
 }finally{db.close()}
}
main().catch(error=>{console.error(error.message);process.exitCode=1})
