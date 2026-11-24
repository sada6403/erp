import {describe,it,expect} from 'vitest'
import {ensureBatchSyncSchema} from '../../backend/lib/batchSyncSchema'
import type {QueryClient} from '../../backend/lib/db'
describe('cloud batch schema compatibility',()=>{
 it('creates the missing identity table and adds only missing receipt fields',async()=>{
  const queries:string[]=[]
  const client={query:async(sql:string)=>{queries.push(sql);return {rows:sql.startsWith('SELECT TABLE_NAME')?[{TABLE_NAME:'product_batches',COLUMN_NAME:'id'},{TABLE_NAME:'product_batches',COLUMN_NAME:'mfg_date'},{TABLE_NAME:'purchase_items',COLUMN_NAME:'id'}]:[]}}} as Pick<QueryClient,'query'>
  await ensureBatchSyncSchema(client)
  expect(queries[0]).toContain('CREATE TABLE IF NOT EXISTS product_batch_identities')
  expect(queries[0]).toContain('UNIQUE KEY uq_physical_batch(product_id,batch_no,expiry_date)')
  expect(queries).toContain('ALTER TABLE product_batches ADD COLUMN batch_identity_id VARCHAR(191) NULL')
  expect(queries.some(sql=>sql.startsWith('ALTER TABLE product_batches ADD COLUMN mfg_date'))).toBe(false)
  expect(queries.some(sql=>/^\s*(UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql))).toBe(false)
 })
 it('propagates DDL failures so a tenant is retried instead of cached ready',async()=>{
  const client={query:async()=>{throw new Error('DDL denied')}} as Pick<QueryClient,'query'>
  await expect(ensureBatchSyncSchema(client)).rejects.toThrow('DDL denied')
 })
})
