import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import Database from 'better-sqlite3'
import fs from 'fs'
import os from 'os'
import path from 'path'
import {prepareTestSession,resetTestSession,disableTestSession,testingLaunchDirectory,readTestControl} from './testingSandbox'
let root:string,live:Database.Database
beforeEach(()=>{
  root=fs.mkdtempSync(path.join(os.tmpdir(),'pos-testing-isolation-'))
  live=new Database(path.join(root,'pos-erp.db'))
  live.exec("CREATE TABLE invoices(id TEXT PRIMARY KEY);INSERT INTO invoices VALUES('existing');CREATE TABLE stocks(quantity REAL);INSERT INTO stocks VALUES(10)")
})
afterEach(()=>{
  live.close()
  if(path.dirname(path.resolve(root))!==path.resolve(os.tmpdir())||!path.basename(root).startsWith('pos-testing-isolation-'))throw Error('Unsafe fixture cleanup')
  fs.rmSync(root,{recursive:true,force:true})
})
describe('POS isolated testing session',()=>{
  it('backs up live data, isolates test bills and stock, and resets only the test session',async()=>{
    await prepareTestSession(root,live,'legacy',{auth_user:{id:'admin'},auth_token:'private',app_settings:{cloud_api_url:'https://example.invalid',cloud_api_key:'private',email_enabled:true}})
    const folder=testingLaunchDirectory(root)!,test=new Database(path.join(folder,'pos-erp.db'))
    test.exec("INSERT INTO invoices VALUES('test-bill');UPDATE stocks SET quantity=9");test.close()
    expect(live.prepare('SELECT * FROM invoices').all()).toEqual([{id:'existing'}]);expect(live.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:10})
    const config=JSON.parse(fs.readFileSync(path.join(folder,'config.json'),'utf8'))
    expect(config.auth_user).toBeUndefined();expect(config.auth_token).toBeUndefined();expect(config.app_settings.cloud_api_key).toBe('');expect(config.app_settings.email_enabled).toBe(false)
    resetTestSession(root);const fresh=testingLaunchDirectory(root)!,restored=new Database(path.join(fresh,'pos-erp.db'))
    try{expect(fresh).not.toBe(folder);expect(restored.prepare('SELECT * FROM invoices').all()).toEqual([{id:'existing'}]);expect(restored.prepare('SELECT quantity FROM stocks').get()).toEqual({quantity:10})}finally{restored.close()}
    // Previous test data is retained privately, never recursively deleted on Reset.
    expect(fs.existsSync(path.join(folder,'pos-erp.db'))).toBe(true)
    disableTestSession(root);expect(testingLaunchDirectory(root)).toBeUndefined();expect(()=>resetTestSession(root)).toThrow(/only in Testing Mode/)
  })
  it('keeps company workspace identity while requiring fresh authentication',async()=>{
    await prepareTestSession(root,live,'company-example',{auth_user:{id:'admin'},app_settings:{}})
    const folder=testingLaunchDirectory(root)!
    expect(fs.existsSync(path.join(folder,'company-workspaces/company-example/pos-erp.db'))).toBe(true)
    expect(JSON.parse(fs.readFileSync(path.join(folder,'company-workspaces.json'),'utf8')).active_workspace_id).toBe('company-example')
  })
  it('fails closed if the test session is missing and rejects control-path traversal',async()=>{
    await prepareTestSession(root,live,'legacy',{})
    fs.unlinkSync(path.join(testingLaunchDirectory(root)!,'.pos-test-session'))
    expect(()=>testingLaunchDirectory(root)).toThrow()
    fs.writeFileSync(path.join(root,'pos-testing-control.json'),JSON.stringify({enabled:true,baseline:'../../outside',session:'../../outside'}))
    expect(()=>readTestControl(root)).toThrow(/Invalid POS testing/)
  })
})
