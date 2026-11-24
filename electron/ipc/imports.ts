import type {IpcMain} from 'electron'
import {app,BrowserWindow,dialog} from 'electron'
import fs from 'fs'
import path from 'path'
import {getDb} from '../database'
import {safeHandle} from './ipcHandler'
import {createCompanyStore,getActiveWorkspaceId,getWorkspaceDataPath} from '../services/companyWorkspace'
import {keywordActor} from './keywords'
import {IMPORT_TYPES,importCsv,importType} from '../lib/importRegistry'
import {ImportJobs} from '../services/importJobs'
import {migrateImports,importsInstalled} from '../services/importMigration'
import {importLimits} from '../services/importFile'
import {persistStagedBills,completeStagedBills,stagePurchaseBills} from '../services/purchaseBills'
import {logAudit} from '../services/auditLog'
const store=createCompanyStore()
const jobs=new Map<string,Promise<unknown>>()
const settings=()=>store.get('app_settings') as Record<string,any>||{}
const actor=()=>{const user=keywordActor();return {...user,branchId:user.branchId||String(settings().branch_id||'')}}
function service(){
 const workspace=getActiveWorkspaceId(),user=actor(),keywordsEnabled=settings().keywords_enabled===true,uniqueCodes=settings().enforce_unique_codes!==false
 const result=new ImportJobs(getDb(),user,{enabled:settings().bulk_import_v2_enabled===true,keywordsEnabled,uniqueCodes,limits:settings().import_limits,actor,assertContext:()=>{if(getActiveWorkspaceId()!==workspace||settings().bulk_import_v2_enabled!==true||(settings().keywords_enabled===true)!==keywordsEnabled||(settings().enforce_unique_codes!==false)!==uniqueCodes)throw new Error('Import workspace or feature settings changed; review the job before resuming')}})
 result.purge();return result
}
function changed(){for(const win of BrowserWindow.getAllWindows())win.webContents.send('sync:dataChanged',{reason:'bulk-import'})}
export function registerImportHandlers(ipcMain:IpcMain){
 safeHandle(ipcMain,'imports:status',(_e,id?:string)=>{
  if(id)return {success:true,data:service().status(id)}
  const user=actor();return {success:true,data:{enabled:settings().bulk_import_v2_enabled===true,admin:Boolean(user.permissions.all),limits:importLimits(settings().import_limits),types:IMPORT_TYPES.filter(type=>user.permissions.all||!type.admin&&user.permissions[type.permission])}}
 })
 safeHandle(ipcMain,'imports:configure',async(_e,input:{enabled:boolean;limits?:Record<string,number>})=>{
  const user=actor();if(!user.permissions.all)throw new Error('Company Admin access required')
  const workspace=getActiveWorkspaceId(),db=getDb()
  if(typeof input?.enabled!=='boolean')throw new Error('Invalid import setting')
  if(jobs.size)throw new Error('Wait for the running import before changing its settings')
  const limits=importLimits(input.limits||settings().import_limits)
  let backup:string|undefined
  if(input.enabled){const sqlPath=app.isPackaged?path.join(process.resourcesPath,'database/migrations/imports.up.sql'):path.join(app.getAppPath(),'database/migrations/imports.up.sql');backup=await migrateImports(db,getWorkspaceDataPath('backups'),fs.readFileSync(sqlPath,'utf8'))}
  if(getActiveWorkspaceId()!==workspace||actor().userId!==user.userId||!actor().permissions.all)throw new Error('Admin workspace changed; reopen import settings')
  store.set('app_settings',{...settings(),bulk_import_v2_enabled:input.enabled,import_limits:limits})
  logAudit(getDb(),{userId:user.userId,branchId:user.branchId,action:'IMPORT_SETTINGS_UPDATED',tableName:'settings',newValues:{enabled:input.enabled,limits,backup}})
  return {success:true,data:{backup}}
 })
 safeHandle(ipcMain,'imports:upload',async(_e,type:string)=>{
  const instance=service();importType(type)
  const selected=await dialog.showOpenDialog({title:'Select file for Bulk Import v2',filters:[{name:'Excel / delimited text',extensions:['xlsx','xls','csv','tsv']}],properties:['openFile']})
  if(selected.canceled||!selected.filePaths[0])return {success:false,error:'Cancelled'}
  const file=selected.filePaths[0],stat=fs.statSync(file)
  if(!stat.isFile()||stat.size>instance.limits.maxBytes)throw new Error('Selected file exceeds import size limit')
  return {success:true,data:instance.upload(type,path.basename(file),fs.readFileSync(file))}
 })
 safeHandle(ipcMain,'imports:describe',(_e,id,input)=>({success:true,data:service().describe(id,input)}))
 safeHandle(ipcMain,'imports:mapping',(_e,id,input)=>({success:true,data:service().map(id,input)}))
 safeHandle(ipcMain,'imports:validate',(_e,id)=>({success:true,data:service().validate(id)}))
 safeHandle(ipcMain,'imports:history',()=>({success:true,data:service().history()}))
 safeHandle(ipcMain,'imports:cancel',(_e,id)=>{service().cancel(id);return {success:true}})
 safeHandle(ipcMain,'imports:commit',(_e,id:string,reviewToken:string,billsToken?:string)=>{
  const instance=service(),status=instance.status(id),workspace=getActiveWorkspaceId(),key=workspace+':'+id
  if(jobs.has(key))return {success:true,data:{id,status:'committing'}}
  const task=instance.commit(id,status.type==='stock_in'?purchaseId=>persistStagedBills(instance.db,purchaseId,billsToken,instance.actor.userId):undefined,reviewToken)
  jobs.set(key,task)
  void task.then(()=>{if(status.type==='stock_in')completeStagedBills(billsToken)}).catch(error=>{try{instance.db.prepare("UPDATE import_jobs SET last_error=?,status=CASE WHEN status='validated' THEN 'failed' ELSE status END WHERE id=? AND status!='completed'").run((error as Error).message,id)}catch{/* Bound workspace may already be closed. */}}).finally(()=>{jobs.delete(key);changed()})
  return {success:true,data:{id,status:'committing'}}
 })
 safeHandle(ipcMain,'imports:rollback',(_e,id)=>{const result=service().rollback(id);changed();return {success:true,data:result}})
 safeHandle(ipcMain,'imports:selectBills',async()=>{
  const instance=service();const definition=IMPORT_TYPES.find(row=>row.id==='stock_in')!
  if(!instance.actor.permissions.all&&!instance.actor.permissions[definition.permission])throw new Error('Stock import permission required')
  const selected=await dialog.showOpenDialog({title:'Upload supplier bill',filters:[{name:'PDF / image',extensions:['pdf','jpg','jpeg','png']}],properties:['openFile','multiSelections']})
  if(selected.canceled)return {success:false,error:'Cancelled'}
  return {success:true,data:stagePurchaseBills(selected.filePaths,getWorkspaceDataPath('purchase-invoices'),instance.actor.userId)}
 })
 safeHandle(ipcMain,'imports:templates',(_e,type)=>({success:true,data:service().templates(type)}))
 safeHandle(ipcMain,'imports:saveTemplate',(_e,id,name)=>({success:true,data:service().saveTemplate(id,name)}))
 safeHandle(ipcMain,'imports:deleteTemplate',(_e,id)=>{service().removeTemplate(id);return {success:true}})
 safeHandle(ipcMain,'imports:export',async(_e,input:{type:string;jobId?:string})=>{
  const instance=service();const content=input.jobId?instance.errorCsv(input.jobId):importCsv([importType(input.type).fields.map(field=>field.key)])
  const selected=await dialog.showSaveDialog({title:input.jobId?'Save validation error report':'Save sample import template',defaultPath:input.jobId?'import-errors.csv':`${input.type}-template.csv`,filters:[{name:'UTF-8 CSV',extensions:['csv']}]})
  if(selected.canceled||!selected.filePath)return {success:false,error:'Cancelled'}
  fs.writeFileSync(selected.filePath,content,'utf8');return {success:true}
 })
}
