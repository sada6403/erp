import {createHash} from 'crypto'
import {redeemPasswordReset} from '../../backend/lib/passwordReset'
import {describe,it,expect} from 'vitest'
import {prepareUserIdentity} from '../../backend/lib/loginIdentity'
import {validateSyncedBatch} from '../../backend/lib/batchValidation'
import type {QueryClient} from '../../backend/lib/db'
function client(query:(sql:string,values?:unknown[])=>unknown[]):QueryClient{return {query:async(sql,values)=>({rows:query(sql,values) as any}),release(){}}}
describe('cloud release identity and batch guards',()=>{
 it('rejects case-insensitive User ID and email collisions',async()=>{
  const db=client(sql=>sql.includes('id<>?')?[{id:'old',login_id:'SABI'}]:[])
  await expect(prepareUserIdentity(db,{login_id:'sabi',login_id_generated:0,email:'new@test.com'},'new')).rejects.toThrow('Indha User ID already irukku')
  const emailDb=client(sql=>sql.includes('LOWER(TRIM(email))')?[{id:'old'}]:[])
  await expect(prepareUserIdentity(emailDb,{login_id:'cashier',login_id_generated:0,email:'OLD@Test.com'},'new')).rejects.toThrow('Email is already')
 })
 it('keeps the canonical cloud ID on partial or generated-ID updates',async()=>{
  const db=client(sql=>sql==='SELECT login_id FROM users WHERE id=?'?[{login_id:'canonical'}]:[])
  const row:Record<string,unknown>={name:'Edited'};await prepareUserIdentity(db,row,'existing');expect(row.login_id).toBe('canonical')
 })
 it('rejects duplicate receipt writes without explicit Add quantity',async()=>{
  const db=client(sql=>sql.includes('SELECT id,quantity')?[{id:'old',quantity:7}]:[])
  await expect(validateSyncedBatch(db,{product_id:'p',batch_number:'B1',expiry_date:'2099-12-31',mfg_date:'2026-01-01',batch_identity_id:'key'},'receipt')).rejects.toThrow('explicit add_existing')
 })
 it('locks the physical key and accepts acknowledged receipts with matching dates',async()=>{
  const statements:string[]=[];const db=client(sql=>{statements.push(sql);if(sql==='SELECT * FROM product_batches WHERE id=?')return [];if(sql.includes('SELECT id,quantity'))return [{id:'old',quantity:7}];if(sql.includes('SELECT expiry_date'))return [{expiry_date:'2099-12-31',mfg_date:'2026-01-01'}];if(sql.includes('SELECT * FROM product_batch_identities'))return [{product_id:'p',batch_no:'B1',expiry_date:'2099-12-31',mfg_date:'2026-01-01',needs_review:0}];return []})
  await validateSyncedBatch(db,{product_id:'p',batch_number:'B1',expiry_date:'2099-12-31',mfg_date:'2026-01-01',batch_identity_id:'key',batch_entry_mode:'add_existing'},'receipt')
  expect(statements.find(sql=>sql.includes('identities')&&sql.includes('FOR UPDATE'))).toBeTruthy()
 })
 it('rejects invalid dates even for API requests bypassing the form',async()=>{
  await expect(validateSyncedBatch(client(()=>[]),{product_id:'p',batch_number:'B1',expiry_date:'2026-02-30'},'receipt')).rejects.toThrow('Invalid batch date')
  await expect(validateSyncedBatch(client(()=>[]),{product_id:'p',batch_number:'B1',mfg_date:'2027-01-01',expiry_date:'2027-01-01'},'receipt')).rejects.toThrow('after Manufacture')
 })
})

describe('single-use email password reset',()=>{
 it('updates the hash, consumes all user links and records a credential-free audit atomically',async()=>{
  const calls:{sql:string;values?:unknown[]}[]=[]
  const fingerprint=createHash('sha256').update('old-bcrypt-hash').digest('hex')
  const db=client((sql,values)=>{calls.push({sql,values});return sql.startsWith('SELECT l.')?[{user_id:'user',password_hash:'old-bcrypt-hash',password_fingerprint:fingerprint}]:[]})
  expect(await redeemPasswordReset(db,'test-token','new-bcrypt-hash')).toBe('user')
  expect(calls[0].sql).toBe('START TRANSACTION');expect(calls.at(-1)?.sql).toBe('COMMIT')
  expect(calls.find(call=>call.sql.startsWith('SELECT'))?.values).toEqual([createHash('sha256').update('test-token').digest('hex')])
  const audit=calls.find(call=>call.sql.startsWith('INSERT INTO audit_logs'))!
  expect(JSON.stringify(audit.values)).not.toContain('bcrypt');expect(JSON.stringify(audit.values)).not.toContain('test-token')
  expect(calls.find(call=>call.sql.startsWith('UPDATE user_password_reset_links'))?.values).toEqual(['user'])
 })
 it('rejects missing, expired or already-used links without updating a password',async()=>{
  const calls:string[]=[];const db=client(sql=>{calls.push(sql);return []})
  await expect(redeemPasswordReset(db,'used-token','new-hash')).rejects.toThrow('Invalid or expired')
  expect(calls.at(-1)).toBe('ROLLBACK');expect(calls.some(sql=>sql.startsWith('UPDATE users'))).toBe(false)
 })
 it('invalidates a link after an administrator has changed the password',async()=>{
  const calls:string[]=[];const db=client(sql=>{calls.push(sql);return sql.startsWith('SELECT l.')?[{user_id:'user',password_hash:'admin-reset-hash',password_fingerprint:createHash('sha256').update('previous-hash').digest('hex')}]:[]})
  await expect(redeemPasswordReset(db,'old-token','new-hash')).rejects.toThrow('Invalid or expired')
  expect(calls.at(-1)).toBe('ROLLBACK');expect(calls.some(sql=>sql.startsWith('UPDATE users'))).toBe(false)
 })
})
