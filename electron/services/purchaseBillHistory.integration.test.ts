import Database from 'better-sqlite3'
import {beforeEach,afterEach,describe,expect,it} from 'vitest'
import {listPurchaseBills} from './purchaseBillHistory'
let db:Database.Database
beforeEach(()=>{db=new Database(':memory:');db.exec(`
 CREATE TABLE users(id TEXT,name TEXT); INSERT INTO users VALUES ('staff1','Nimal'),('staff2','Kamal');
 CREATE TABLE suppliers(id TEXT,name TEXT); INSERT INTO suppliers VALUES ('s1','Rice Supplier'),('s2','Biscuit Supplier');
 CREATE TABLE purchase_orders(id TEXT,branch_id TEXT,supplier_id TEXT,po_number TEXT,supplier_invoice_number TEXT,purchase_date TEXT,created_at TEXT,invoice_date TEXT,purchase_type TEXT,total_amount REAL,status TEXT);
 INSERT INTO purchase_orders VALUES ('p1','main','s1','PO-1','INV-100','2026-11-01','2026-11-01',NULL,'direct',1000,'RECEIVED'),('p2','main','s2','PO-2','INV-200','2026-11-02','2026-11-02',NULL,'order',2000,'SENT'),('other','branch2','s1','PO-3','OTHER','2026-11-01','2026-11-01',NULL,'direct',3000,'RECEIVED');
 CREATE TABLE purchase_attachments(id TEXT,purchase_id TEXT,original_name TEXT,mime_type TEXT,file_size INTEGER,uploaded_at TEXT,uploaded_by TEXT,is_active INTEGER);
 INSERT INTO purchase_attachments VALUES ('a1','p1','rice.pdf','application/pdf',100,'2026-11-03 10:00:00','staff1',1),('a2','p2','biscuit.jpg','image/jpeg',200,'2026-11-04 10:00:00','staff2',1),('removed','p1','old.pdf','application/pdf',100,'2026-11-05 10:00:00','staff1',0),('other','other','other.pdf','application/pdf',100,'2026-11-04 10:00:00','staff1',1);
 `)})
afterEach(()=>db.close())
const ids=(filters:Parameters<typeof listPurchaseBills>[2]={})=>(listPurchaseBills(db,'main',filters) as {id:string}[]).map(r=>r.id)
describe('supplier bill history filters and metadata',()=>{
 it('isolates the branch, excludes removed bills and includes supplier and uploader details',()=>{
  expect(ids()).toEqual(['a2','a1'])
  const row=listPurchaseBills(db,'main',{supplier_id:'s1'})[0] as Record<string,unknown>
  expect(row).toMatchObject({supplier_name:'Rice Supplier',uploaded_by_name:'Nimal',uploaded_at:'2026-11-03 10:00:00',supplier_invoice_number:'INV-100',po_number:'PO-1',original_name:'rice.pdf',purchase_date:'2026-11-01'})
 })
 it('filters purchase date independently from upload date',()=>{
  expect(ids({from:'2026-11-02',to:'2026-11-02'})).toEqual(['a2'])
  expect(ids({uploaded_from:'2026-11-03',uploaded_to:'2026-11-03'})).toEqual(['a1'])
  expect(ids({from:'2026-11-01',to:'2026-11-01',uploaded_from:'2026-11-04'})).toEqual([])
 })
 it('filters staff, supplier and file type',()=>{
  expect(ids({uploaded_by:'staff1',file_type:'pdf',supplier_id:'s1'})).toEqual(['a1'])
  expect(ids({file_type:'image'})).toEqual(['a2'])
  expect(ids({status:'RECEIVED'})).toEqual(['a1'])
  expect(ids({status:'SENT'})).toEqual(['a2'])
  expect(ids({supplier_id:'s1',uploaded_by:'staff2'})).toEqual([])
 })
 it('searches invoice reference, filename and uploader without interpolating SQL',()=>{
  expect(ids({search:'INV-200'})).toEqual(['a2'])
  expect(ids({search:'rice.pdf'})).toEqual(['a1'])
  expect(ids({search:'Nimal'})).toEqual(['a1'])
  expect(ids({search:"' OR 1=1 --"})).toEqual([])
 })
})
