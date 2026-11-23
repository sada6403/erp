import type { IpcMain } from 'electron'
import { app, BrowserWindow } from 'electron'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { getDb } from '../database'
import { createCompanyStore, getWorkspaceDataPath } from '../services/companyWorkspace'
import { KeywordService, managesKeywords, ownsKeywords, type KeywordActor } from '../services/keywords'
import { migrateKeywords } from '../services/keywordMigration'
import { safeHandle } from './ipcHandler'
import { logAudit } from '../services/auditLog'

const store = createCompanyStore()
export function keywordActor(): KeywordActor {
  const session = store.get('auth_user') as { id?: string } | undefined
  if (!session?.id) throw new Error('Sign in to manage search keywords')
  const row = getDb().prepare('SELECT u.id,u.branch_id,r.name AS role_name,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? AND u.is_active=1').get(session.id) as { id:string; branch_id:string; role_name:string; permissions:string } | undefined
  if (!row) throw new Error('Active user required')
  return { userId:row.id, branchId:row.branch_id, terminalId:String(store.get('device_id') || store.get('keyword_terminal_id') || ''), roleName:row.role_name, permissions:JSON.parse(row.permissions || '{}') }
}
function settings() { return store.get('app_settings') as Record<string,unknown> || {} }
function service() {
  if (settings().keywords_enabled !== true) throw new Error('Search keywords are disabled')
  return new KeywordService(getDb(),keywordActor(),settings().enforce_unique_codes !== false)
}
function changed() { for(const win of BrowserWindow.getAllWindows()) win.webContents.send('keywords:changed') }
export function registerKeywordHandlers(ipcMain:IpcMain) {
  safeHandle(ipcMain,'keywords:status',()=>{
    const actor=keywordActor()
    return {success:true,data:{enabled:settings().keywords_enabled===true,uniqueCodes:settings().enforce_unique_codes!==false,admin:Boolean(actor.permissions.all),manage:managesKeywords(actor),own:ownsKeywords(actor),userId:actor.userId}}
  })
  safeHandle(ipcMain,'keywords:configure',async(_e,input:{enabled:boolean;uniqueCodes:boolean})=>{
    const actor=keywordActor()
    if(!actor.permissions.all)throw new Error('Company Admin access required')
    if(typeof input?.enabled!=='boolean'||typeof input.uniqueCodes!=='boolean')throw new Error('Invalid keyword settings')
    let backup:string|undefined
    if(input.enabled) {
      const sqlPath=app.isPackaged?path.join(process.resourcesPath,'database/migrations/keywords.up.sql'):path.join(app.getAppPath(),'database/migrations/keywords.up.sql')
      backup=await migrateKeywords(getDb(),getWorkspaceDataPath('backups'),fs.readFileSync(sqlPath,'utf8'))
      if(!store.get('device_id')&&!store.get('keyword_terminal_id'))store.set('keyword_terminal_id',randomUUID())
    }
    store.set('app_settings',{...settings(),keywords_enabled:input.enabled,enforce_unique_codes:input.uniqueCodes})
    logAudit(getDb(),{userId:actor.userId,branchId:actor.branchId,action:'KEYWORD_SETTINGS_UPDATED',tableName:'settings',newValues:{keywords_enabled:input.enabled,enforce_unique_codes:input.uniqueCodes,backup}})
    changed()
    return {success:true,data:{backup}}
  })
  safeHandle(ipcMain,'keywords:snapshot',()=>{
    const actor=keywordActor()
    return {success:true,data:{enabled:settings().keywords_enabled===true,context:actor,keywords:settings().keywords_enabled===true?service().snapshot():[]}}
  })
  safeHandle(ipcMain,'keywords:list',(_e,options)=>({success:true,data:service().list(options)}))
  safeHandle(ipcMain,'keywords:save',(_e,input)=>{const data=service().save(input);changed();return {success:true,data}})
  safeHandle(ipcMain,'keywords:remove',(_e,id)=>{service().remove(id);changed();return {success:true}})
  safeHandle(ipcMain,'keywords:review',(_e,ids,decision)=>{service().review(ids,decision);changed();return {success:true}})
}
