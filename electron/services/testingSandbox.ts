import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import Database from 'better-sqlite3'
import { clearCopiedTestSales } from './clearTestSales'

interface TestControl { enabled: boolean; baseline: string; session: string }
const validId = (id: string) => /^[a-f0-9-]{36}$/.test(id)
export function readTestControl(root: string): TestControl | undefined {
  const file=path.join(root,'pos-testing-control.json')
  if(!fs.existsSync(file))return undefined
  const value=JSON.parse(fs.readFileSync(file,'utf8')) as TestControl
  if(typeof value.enabled!=='boolean'||!validId(value.baseline)||!validId(value.session))throw new Error('Invalid POS testing configuration')
  return value
}
function saveControl(root: string, value: TestControl) {
  const target=path.join(root,'pos-testing-control.json'),pending=target+'.pending'
  fs.writeFileSync(pending,JSON.stringify(value),{mode:0o600});fs.renameSync(pending,target)
}
export function testingLaunchDirectory(root: string): string | undefined {
  const control=readTestControl(root)
  if(!control?.enabled)return undefined
  const folder=path.join(root,'pos-testing','sessions',control.session)
  if(fs.readFileSync(path.join(folder,'.pos-test-session'),'utf8')!==control.session)throw new Error('POS test session is missing; refusing to open live data as test data')
  return folder
}
function sanitizedConfig(config: Record<string, unknown>) {
  const next={...config}
  for(const key of Object.keys(next))if(/^auth_|^sync_|^last_successful_sync|^jwt_temp/i.test(key))delete next[key]
  const settings={...(config.app_settings as Record<string,unknown>||{})}
  settings.cloud_api_url='';settings.cloud_api_key='';settings.counter_prefix='TEST'
  for(const key of Object.keys(settings))if(/(email|sms|whatsapp).*enabled|enabled.*(email|sms|whatsapp)/i.test(key))settings[key]=false
  next.app_settings=settings
  return next
}
export async function prepareTestSession(root: string, db: Database.Database, workspaceId: string, config: Record<string,unknown>) {
  const id=randomUUID(),baseline=path.join(root,'pos-testing','baselines',id)
  fs.mkdirSync(baseline,{recursive:true,mode:0o700})
  await db.backup(path.join(baseline,'pos-erp.db'))
  const workspace=workspaceId==='legacy'?'':path.join('company-workspaces',workspaceId)
  if(workspaceId!=='legacy'&&!/^[A-Za-z0-9_-]+$/.test(workspaceId))throw new Error('Invalid company workspace')
  fs.writeFileSync(path.join(baseline,'snapshot.json'),JSON.stringify({workspace,workspaceId,config:sanitizedConfig(config)}),{mode:0o600})
  return resetTestSession(root,{enabled:true,baseline:id,session:randomUUID()})
}
export function resetTestSession(root: string, control=readTestControl(root)) {
  if(!control?.enabled)throw new Error('Clear Test Transactions is available only in Testing Mode')
  const baseline=path.join(root,'pos-testing','baselines',control.baseline)
  const snapshot=JSON.parse(fs.readFileSync(path.join(baseline,'snapshot.json'),'utf8')) as {workspace:string;workspaceId:string;config:Record<string,unknown>}
  const id=randomUUID(),folder=path.join(root,'pos-testing','sessions',id),workspace=path.resolve(folder,snapshot.workspace)
  if(workspace!==folder&&!workspace.startsWith(folder+path.sep))throw new Error('Invalid testing workspace path')
  fs.mkdirSync(workspace,{recursive:true,mode:0o700})
  fs.copyFileSync(path.join(baseline,'pos-erp.db'),path.join(workspace,'pos-erp.db'),fs.constants.COPYFILE_EXCL)
  fs.writeFileSync(path.join(workspace,'config.json'),JSON.stringify(snapshot.config),{mode:0o600})
  fs.writeFileSync(path.join(folder,'company-workspaces.json'),JSON.stringify({active_workspace_id:snapshot.workspaceId}),{mode:0o600})
  fs.writeFileSync(path.join(folder,'.pos-test-session'),id)
  saveControl(root,{enabled:true,baseline:control.baseline,session:id})
  return {restart_required:true}
}
export function disableTestSession(root: string) {
  const control=readTestControl(root)
  if(control)saveControl(root,{...control,enabled:false})
  return {restart_required:true}
}

export function clearExistingTestSales(root:string){
  const control=readTestControl(root)
  if(!control?.enabled)throw new Error('Enable Testing Mode first')
  const previous=path.join(root,'pos-testing','baselines',control.baseline),id=randomUUID(),folder=path.join(root,'pos-testing','baselines',id)
  fs.mkdirSync(folder,{recursive:true,mode:0o700})
  const filename=path.join(folder,'pos-erp.db')
  fs.copyFileSync(path.join(previous,'pos-erp.db'),filename,fs.constants.COPYFILE_EXCL)
  fs.copyFileSync(path.join(previous,'snapshot.json'),path.join(folder,'snapshot.json'),fs.constants.COPYFILE_EXCL)
  const copy=new Database(filename)
  try{clearCopiedTestSales(copy)}finally{copy.close()}
  return resetTestSession(root,{...control,baseline:id})
}
