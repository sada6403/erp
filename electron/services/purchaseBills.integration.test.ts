import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { stagePurchaseBills,persistStagedBills,completeStagedBills,discardStagedBills } from './purchaseBills'
let db:Database.Database,dir:string,source:string,stored:string
beforeEach(()=>{dir=fs.mkdtempSync(path.join(os.tmpdir(),'purchase-bills-'));source=path.join(dir,'supplier.pdf');stored=path.join(dir,'saved');fs.writeFileSync(source,'%PDF-1.4 test supplier bill');db=new Database(':memory:');db.exec(`CREATE TABLE purchase_attachments(id TEXT PRIMARY KEY,purchase_id TEXT,original_name TEXT,stored_name TEXT,relative_path TEXT,mime_type TEXT,file_size INTEGER,uploaded_by TEXT)` )})
afterEach(()=>{db.close();fs.rmSync(dir,{recursive:true,force:true})})
describe('supplier bills for order and direct stock entry',()=>{
 it('saves selected files durably and links them to the existing purchase attachment table',()=>{
  const selection=stagePurchaseBills([source],stored,'owner')
  db.transaction(()=>persistStagedBills(db,'purchase',selection.token,'owner'))()
  completeStagedBills(selection.token)
  discardStagedBills(selection.token,stored,'owner')
  const row=db.prepare('SELECT * FROM purchase_attachments').get() as {purchase_id:string;relative_path:string;original_name:string;stored_name:string}
  expect(row.purchase_id).toBe('purchase');expect(row.original_name).toBe('supplier.pdf')
  expect(fs.readFileSync(path.join(stored,row.stored_name),'utf8')).toBe('%PDF-1.4 test supplier bill')
 })
 it('rolls back bill rows on failed stock save and lets the same selection be retried',()=>{
  const selection=stagePurchaseBills([source],stored,'owner')
  expect(()=>db.transaction(()=>{persistStagedBills(db,'purchase',selection.token,'owner');throw new Error('stock failed')})()).toThrow('stock failed')
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_attachments').get()).toEqual({n:0})
  db.transaction(()=>persistStagedBills(db,'purchase',selection.token,'owner'))()
  completeStagedBills(selection.token)
  expect(db.prepare('SELECT COUNT(*) n FROM purchase_attachments').get()).toEqual({n:1})
 })
 it('rejects another user token and removes files when entry is cancelled',()=>{
  const selection=stagePurchaseBills([source],stored,'owner')
  expect(()=>persistStagedBills(db,'purchase',selection.token,'other')).toThrow(/expired/)
  discardStagedBills(selection.token,stored,'owner')
  expect(fs.readdirSync(stored)).toEqual([])
 })
})
