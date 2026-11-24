import Database from 'better-sqlite3'
import {describe,it,expect,afterEach} from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {migrateRelease210} from './releaseMigration'
import {allocateLoginId} from './loginIdentity'
import {claimBatch,inspectBatch} from './batchIdentity'
const databases:Database.Database[]=[],directories:string[]=[]
function setup(){const db=new Database(':memory:');databases.push(db);db.pragma('foreign_keys=ON');db.exec(`CREATE TABLE users(id TEXT PRIMARY KEY,email TEXT,password_hash TEXT);INSERT INTO users VALUES('a','Sabi@example.com','hash-a'),('b','sabi@other.com','hash-b');CREATE TABLE products(id TEXT PRIMARY KEY);INSERT INTO products VALUES('p');CREATE TABLE product_batches(id TEXT PRIMARY KEY,product_id TEXT,batch_number TEXT,expiry_date TEXT,mfg_date TEXT,quantity REAL,cost_price REAL,created_at TEXT);INSERT INTO product_batches VALUES('old-a','p','B1','2027-12-31','2026-11-01',3,100,'2026-11-01'),('old-b','p','B1','2027-12-31','2026-11-01',4,120,'2026-11-02');`);return db}
async function migrate(db:Database.Database){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'release210-'));directories.push(directory);return migrateRelease210(db,directory,fs.readFileSync(path.join(process.cwd(),'database/migrations/release-2.10.up.sql'),'utf8'))}
afterEach(()=>{for(const db of databases.splice(0))db.close();for(const directory of directories.splice(0))fs.rmSync(directory,{recursive:true,force:true})})
describe('2.10 identity migration and batch invariants',()=>{
 it('backs up, generates unique User IDs and preserves emails/password hashes and all cost layers',async()=>{
  const db=setup(),before=db.prepare('SELECT * FROM users ORDER BY id').all(),batches=db.prepare('SELECT id,quantity,cost_price FROM product_batches ORDER BY id').all()
  const backup=await migrate(db);expect(backup).toBeTruthy();expect(await migrate(db)).toBeUndefined()
  expect(db.prepare('SELECT id,email,password_hash FROM users ORDER BY id').all()).toEqual(before)
  expect(db.prepare('SELECT login_id FROM users ORDER BY id').all()).toEqual([{login_id:'sabi'},{login_id:'sabi2'}])
  expect(db.prepare('SELECT id,quantity,cost_price FROM product_batches ORDER BY id').all()).toEqual(batches)
  expect((db.prepare('SELECT COUNT(*) n FROM product_batch_identities').get() as any).n).toBe(1)
  expect(()=>allocateLoginId(db,'SABI','new@test.com')).toThrow('Indha User ID already irukku')
  expect(()=>db.prepare("INSERT INTO users(id,email,login_id) VALUES('c','new@test.com','SABI')").run()).toThrow()
  expect(()=>db.prepare("INSERT INTO users(id,email) VALUES('c','sabi@EXAMPLE.COM')").run()).toThrow()
  db.exec(fs.readFileSync(path.join(process.cwd(),'database/migrations/release-2.10.down.sql'),'utf8'));expect(await migrate(db)).toBeTruthy();expect(db.prepare('SELECT login_id FROM users ORDER BY id').all()).toEqual([{login_id:'sabi'},{login_id:'sabi2'}])
 })
 it('returns existing quantity/date and requires explicit quantity-add without merging costs',async()=>{
  const db=setup();await migrate(db);const input={product_id:'p',batch_number:'B1',expiry_date:'2027-12-31',mfg_date:'2026-11-01'}
  const check=inspectBatch(db,input);expect(check.existing).toMatchObject({quantity:7,entered_at:'2026-11-01',layers:2})
  expect(()=>claimBatch(db,input)).toThrow('BATCH_DUPLICATE')
  const identity=claimBatch(db,{...input,batch_resolution:'add_existing',existing_batch_id:check.existing!.id,acknowledge_dates:true});expect(identity.id).toBe(check.existing!.id)
  expect((db.prepare('SELECT SUM(quantity) n FROM product_batches').get() as any).n).toBe(7)
 })
 it('validates manufacture/expiry order and warns about expired or differing dates',async()=>{
  const db=setup();await migrate(db)
  expect(()=>claimBatch(db,{product_id:'p',batch_number:'B2',mfg_date:'2027-12-31',expiry_date:'2027-12-31'})).toThrow('after Manufacture')
  expect(()=>claimBatch(db,{product_id:'p',batch_number:'B2',expiry_date:'2000-01-01'})).toThrow('BATCH_DATE_WARNING')
  const variant=inspectBatch(db,{product_id:'p',batch_number:'B1',mfg_date:'2026-11-01',expiry_date:'2028-01-01'});expect(variant.warnings.join(' ')).toContain('dates differ')
  expect(()=>db.prepare('INSERT INTO product_batch_identities SELECT \'different-id\',product_id,batch_no,expiry_date,mfg_date,needs_review,created_at,updated_at FROM product_batch_identities LIMIT 1').run()).toThrow()
 })
})
