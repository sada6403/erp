import Database from 'better-sqlite3'
import {describe,it,expect} from 'vitest'
import {receiptQuantity,purchaseFullyReceived} from './purchaseReceiving'

describe('partial purchase receiving',()=>{
 it('checks all order lines, including those omitted from a partial receipt',()=>{
  const db=new Database(':memory:')
  try{
   db.exec(`CREATE TABLE purchase_items(po_id TEXT,quantity REAL,received_qty REAL);INSERT INTO purchase_items VALUES('po',5,5),('po',10,0)`)
   expect(purchaseFullyReceived(db,'po')).toBe(false)
   db.exec(`UPDATE purchase_items SET received_qty=quantity WHERE po_id='po'`)
   expect(purchaseFullyReceived(db,'po')).toBe(true)
   expect(purchaseFullyReceived(db,'missing')).toBe(false)
  }finally{db.close()}
 })
 it.each([-1,Infinity,NaN,'wrong'])('rejects invalid receipt quantity %s',received=>{
  expect(()=>receiptQuantity(10,0,received,0)).toThrow(/valid non-negative/)
 })
 it('rejects stale retries and requires an observed quantity for supermarket receipts',()=>{
  expect(()=>receiptQuantity(10,3,3,0,true)).toThrow(/already updated/)
  expect(()=>receiptQuantity(10,3,3,undefined,true)).toThrow(/Refresh/)
  expect(()=>receiptQuantity(10,9,2,9,true)).toThrow(/exceeds/)
 })
 it('uses six-decimal stock precision for cumulative quantities',()=>{
  expect(receiptQuantity(0.3,0.1,0.2,0.1,true)).toEqual({quantity:0.2,total:0.3})
 })
})
