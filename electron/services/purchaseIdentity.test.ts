import {describe,it,expect,vi} from 'vitest'
import {validatePurchaseInvoice} from '../../backend/lib/purchaseIdentity'
import type {QueryClient} from '../../backend/lib/db'
describe('cloud supplier invoice identity',()=>{
 it('rejects another purchase with the same normalized supplier invoice',async()=>{
  const client={query:vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT id')?[{id:'other'}]:[]}))} as unknown as Pick<QueryClient,'query'>
  await expect(validatePurchaseInvoice(client,{supplier_id:'supplier',supplier_invoice_number:' Bill-1 '},'purchase')).rejects.toThrow(/already belongs/)
  expect(client.query).toHaveBeenLastCalledWith(expect.stringContaining('LOWER(TRIM'),['supplier','Bill-1','purchase'])
 })
 it('validates partial status updates against the saved invoice and allows idempotent same-id replay',async()=>{
  const client={query:vi.fn(async(sql:string)=>({rows:sql.startsWith('SELECT supplier_id')?[{supplier_id:'supplier',supplier_invoice_number:'INV-1'}]:[]}))} as unknown as Pick<QueryClient,'query'>
  await expect(validatePurchaseInvoice(client,{status:'PARTIAL'},'purchase')).resolves.toBeUndefined()
  expect(client.query).toHaveBeenLastCalledWith(expect.any(String),['supplier','INV-1','purchase'])
 })
})
