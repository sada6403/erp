import {describe,it,expect} from 'vitest'
import {PGlite} from '../../branch-hub/node_modules/@electric-sql/pglite'
import fs from 'fs'
import path from 'path'
describe('PostgreSQL supermarket inventory compatibility',()=>{
 it('applies idempotently, preserves old data and round-trips fractional quantities and exact costs',async()=>{
  const db=new PGlite()
  try{
   await db.exec(`CREATE TABLE branches(id TEXT PRIMARY KEY);CREATE TABLE suppliers(id TEXT PRIMARY KEY);CREATE TABLE products(id TEXT PRIMARY KEY,cost_price NUMERIC(12,2),selling_price NUMERIC(12,2));CREATE TABLE invoices(id TEXT PRIMARY KEY);CREATE TABLE invoice_items(id TEXT PRIMARY KEY,quantity INTEGER,unit_price NUMERIC(12,2));CREATE TABLE stocks(id TEXT PRIMARY KEY,quantity INTEGER,damaged_qty INTEGER);INSERT INTO stocks VALUES('legacy',10,0);INSERT INTO products VALUES('rice',100,150);`)
   const sql=fs.readFileSync(path.join(process.cwd(),'backend/database/supermarket-inventory.sql'),'utf8')
   await db.exec(sql);await db.exec(sql)
   expect((await db.query<{quantity:string}>("SELECT quantity::text quantity FROM stocks WHERE id='legacy'")).rows[0].quantity).toBe('10')
   await db.exec("INSERT INTO stocks VALUES('loose',0.000001,0);UPDATE products SET cost_price=81.818181818 WHERE id='rice'")
   expect((await db.query<{quantity:string}>("SELECT quantity::text quantity FROM stocks WHERE id='loose'")).rows[0].quantity).toBe('0.000001')
   expect((await db.query<{cost:string}>("SELECT cost_price::text cost FROM products WHERE id='rice'")).rows[0].cost).toBe('81.818181818')
   expect((await db.query<{n:number}>("SELECT count(*)::int n FROM information_schema.tables WHERE table_name IN ('purchase_returns','purchase_return_items','product_batches')")).rows[0].n).toBe(3)
  }finally{await db.close()}
 })
})
