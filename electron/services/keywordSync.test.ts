import {describe,it,expect,vi} from 'vitest'
import {applySyncOperation} from '../../backend/lib/sync'
const record={id:'k',product_id:'p',keyword:'arisi',keyword_normalized:'arisi',keyword_type:'word',script:'latin',source:'manual',scope_type:'global',scope_key:'global',branch_id:null,terminal_id:null,user_id:null,parent_id:null,review_status:'approved',created_by:'u',created_at:'2026-01-01T00:00:00.000Z',updated_at:'2026-01-01T00:00:00.000Z',version:1,is_active:1}
function client(old?:Record<string,unknown>,duplicate=false){return {release:vi.fn(),query:vi.fn(async(sql:string)=>{
  if(sql.includes('GET_LOCK'))return {rows:[{acquired:1}]}
  if(sql.startsWith('SELECT id FROM products WHERE id=?'))return {rows:[{id:'p'}]}
  if(sql.startsWith('SELECT * FROM product_search_keywords'))return {rows:old?[old]:[]}
  if(sql.includes('scope_key=? FOR UPDATE'))return {rows:duplicate?[{id:'other'}]:[]}
  return {rows:[]}
})}}
const push=(db:ReturnType<typeof client>,r:Record<string,unknown>)=>applySyncOperation(db as any,{table:'product_search_keywords',operation:'INSERT',recordId:'k',record:r})
describe('cloud keyword conflict contract',()=>{
  it('rejects private aliases and rolls back',async()=>{const db=client();await expect(push(db,{...record,scope_type:'user',user_id:'u'})).rejects.toThrow('Private');expect(db.query.mock.calls.some(([sql])=>sql==='ROLLBACK')).toBe(true)})
  it('uses server change time, preserving offline incremental discovery',async()=>{const db=client();await push(db,record);expect(db.query.mock.calls.find(([sql])=>sql.startsWith('INSERT INTO product_search_keywords'))?.[0]).toContain('CURRENT_TIMESTAMP(3)')})
  it('accepts idempotent replay but rejects divergent equal-version edits and stale versions',async()=>{const db=client(record);await push(db,record);await expect(push(db,{...record,keyword:'rice',keyword_normalized:'rice'})).rejects.toThrow('concurrent');await expect(push(client({...record,version:3}),record)).rejects.toThrow('newer');await expect(push(client(record),{...record,version:3})).rejects.toThrow('gap')})
  it('does not overwrite another device identity through a unique-key upsert',async()=>{const db=client(undefined,true);await expect(push(db,record)).rejects.toThrow('another device');expect(db.query.mock.calls.some(([sql])=>sql.startsWith('INSERT INTO product_search_keywords'))).toBe(false)})
})
