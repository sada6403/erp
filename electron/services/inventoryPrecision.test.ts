import {describe,it,expect} from 'vitest'
import {ensureInventoryPrecision} from '../../backend/lib/inventoryPrecision'
import type {QueryClient} from '../../backend/lib/db'
describe('cloud inventory numeric precision compatibility',()=>{
 it('expands scale without reducing integer capacity, nullability or defaults',async()=>{
  const statements:string[]=[]
  const rows=[{TABLE_NAME:'stocks',COLUMN_NAME:'quantity',DATA_TYPE:'decimal',NUMERIC_PRECISION:12,NUMERIC_SCALE:2,IS_NULLABLE:'NO',COLUMN_DEFAULT:'0.00',EXTRA:''},{TABLE_NAME:'product_batches',COLUMN_NAME:'cost_price',DATA_TYPE:'decimal',NUMERIC_PRECISION:40,NUMERIC_SCALE:2,IS_NULLABLE:'YES',COLUMN_DEFAULT:null,EXTRA:''}]
  const client={query:async(sql:string)=>{statements.push(sql);return {rows:sql.startsWith('SELECT')?rows:[]}}} as Pick<QueryClient,'query'>
  await ensureInventoryPrecision(client)
  expect(statements).toContain('ALTER TABLE `stocks` MODIFY COLUMN `quantity` DECIMAL(24,6) NOT NULL DEFAULT 0.00')
  expect(statements).toContain('ALTER TABLE `product_batches` MODIFY COLUMN `cost_price` DECIMAL(47,9) NULL DEFAULT NULL')
  expect(statements.some(sql=>/\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i.test(sql))).toBe(false)
 })
 it('skips already sufficient decimal columns and floating-point columns',async()=>{
  const statements:string[]=[]
  const client={query:async(sql:string)=>{statements.push(sql);return {rows:[{TABLE_NAME:'stocks',COLUMN_NAME:'quantity',DATA_TYPE:'decimal',NUMERIC_SCALE:6},{TABLE_NAME:'products',COLUMN_NAME:'cost_price',DATA_TYPE:'double'}]}}} as Pick<QueryClient,'query'>
  await ensureInventoryPrecision(client);expect(statements).toHaveLength(1)
 })
 it('propagates migration errors so synchronization cannot silently truncate precision',async()=>{
  const client={query:async()=>{throw new Error('DDL denied')}} as Pick<QueryClient,'query'>
  await expect(ensureInventoryPrecision(client)).rejects.toThrow('DDL denied')
 })
})
