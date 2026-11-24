import {describe,it,expect,afterEach} from 'vitest'
import SQLite from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {KeywordService,type KeywordActor} from './keywords'
import {migrateKeywords,keywordTableExists} from './keywordMigration'
const sql=fs.readFileSync(path.join(process.cwd(),'database/migrations/keywords.up.sql'),'utf8')
const dirs:string[]=[];const dbs:SQLite.Database[]=[]
function setup(){const db=new SQLite(':memory:');dbs.push(db);db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE products(id TEXT PRIMARY KEY,name TEXT,sku TEXT,barcode TEXT,branch_id TEXT,is_active INTEGER);INSERT INTO products VALUES('rice','Rice','R',NULL,NULL,1),('milk','Milk','M',NULL,NULL,1);CREATE TABLE sync_queue(id TEXT PRIMARY KEY,table_name TEXT,record_id TEXT,operation TEXT,payload TEXT);CREATE TABLE audit_logs(id TEXT,user_id TEXT,branch_id TEXT,action TEXT,table_name TEXT,record_id TEXT,old_values TEXT,new_values TEXT);`);return db}
const actor:KeywordActor={userId:'u',terminalId:'t',branchId:'b',permissions:{pos:true}}
afterEach(()=>{for(const db of dbs.splice(0))db.close();for(const dir of dirs.splice(0))fs.rmSync(dir,{recursive:true,force:true})})
describe('keyword writes on isolated SQLite',()=>{
  it('supports empty up/down round trips without changing master data',async()=>{
    const db=setup();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-keywords-'));dirs.push(dir)
    const down=fs.readFileSync(path.join(process.cwd(),'database/migrations/keywords.down.sql'),'utf8')
    await migrateKeywords(db,dir,sql)
    expect(await migrateKeywords(db,dir,down,'down')).toBeTruthy()
    expect(keywordTableExists(db)).toBe(false)
    expect(await migrateKeywords(db,dir,down,'down')).toBeUndefined()
    await migrateKeywords(db,dir,sql)
    expect((db.prepare('SELECT COUNT(*) n FROM products').get() as any).n).toBe(2)
  })
  it('backs up before migrating, is idempotent, and guards populated rollback',async()=>{
    const db=setup();const dir=fs.mkdtempSync(path.join(os.tmpdir(),'pos-keywords-'));dirs.push(dir)
    const backup=await migrateKeywords(db,dir,sql);expect(backup).toBeTruthy();expect(keywordTableExists(db)).toBe(true)
    const copy=new SQLite(backup!,{readonly:true});expect(keywordTableExists(copy)).toBe(false);copy.close()
    expect(await migrateKeywords(db,dir,sql)).toBeUndefined()
    new KeywordService(db,actor).save({product_id:'rice',keyword:'arisi',scope_type:'user'})
    await expect(migrateKeywords(db,dir,'DROP TABLE product_search_keywords','down')).rejects.toThrow('populated')
  })
  it('restricts cashiers, keeps private aliases out of sync, audits, reviews and deactivates',()=>{
    const db=setup();db.exec(sql)
    const cashier=new KeywordService(db,actor)
    expect(()=>cashier.save({product_id:'rice',keyword:'rice',scope_type:'global'})).toThrow()
    const native=cashier.save({product_id:'rice',keyword:'அரிசி',scope_type:'user'})
    expect(()=>cashier.save({id:native.id,version:0,product_id:'rice',keyword:'arisi',scope_type:'user'})).toThrow('changed')
    expect(cashier.list({pending:true}).length).toBeGreaterThan(0)
    expect((db.prepare('SELECT COUNT(*) n FROM sync_queue').get() as any).n).toBe(0)
    expect(new KeywordService(db,{...actor,userId:'other'}).snapshot()).toEqual([])
    expect(()=>cashier.review([native.id],'approved')).toThrow()
    const admin=new KeywordService(db,{...actor,permissions:{all:true}})
    const draft=admin.list({management:true,pending:true})[0];admin.review([draft.id],'approved')
    expect(cashier.snapshot().some(row=>row.id===draft.id)).toBe(true)
    admin.save({product_id:'milk',keyword:'1',scope_type:'global'})
    expect(()=>cashier.save({product_id:'rice',keyword:'1',scope_type:'user'})).toThrow('Milk')
    db.prepare('UPDATE products SET is_active=0 WHERE id=?').run('rice')
    expect(cashier.snapshot().every(row=>row.product_id!=='rice')).toBe(true)
    expect((db.prepare('SELECT COUNT(*) n FROM audit_logs').get() as any).n).toBeGreaterThan(0)
    expect((db.prepare("SELECT name FROM products WHERE id='rice'").get() as any).name).toBe('Rice')
  })
})
