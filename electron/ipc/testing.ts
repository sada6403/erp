import { app, type IpcMain } from 'electron'
import { getDb } from '../database'
import { createCompanyStore, getActiveWorkspaceId } from '../services/companyWorkspace'
import { isTestingMode } from '../services/testingMode'
import { prepareTestSession, resetTestSession, disableTestSession, clearExistingTestSales } from '../services/testingSandbox'
import { safeHandle } from './ipcHandler'

export function registerTestingHandlers(ipcMain:IpcMain){
  let busy=false
  const store=createCompanyStore()
  const caller=()=>store.get('auth_user') as {id?:string;permissions?:Record<string,unknown>;role?:{permissions?:Record<string,unknown>}}|undefined
  const admin=()=>Boolean(caller()?.role?.permissions?.all||caller()?.permissions?.all)
  const root=()=>process.env.POS_LIVE_USER_DATA||app.getPath('userData')
  safeHandle(ipcMain,'testing:status',()=>({success:true,data:{enabled:isTestingMode(),can_configure:admin(),can_clear:isTestingMode()&&Boolean(caller()?.id)}}))
  safeHandle(ipcMain,'testing:change',async(_e,action:string)=>{
    if(!caller()?.id)throw new Error('Sign in first')
    if(busy)throw new Error('Testing mode change is already in progress')
    if(action!=='reset'&&!admin())throw new Error('Only Admin can enable or disable Testing Mode')
    if(action==='reset'&&!isTestingMode())throw new Error('Test history can only be cleared in Testing Mode')
    busy=true
    try{
      if(action==='enable'){
        if(isTestingMode())throw new Error('Testing Mode is already enabled')
        await prepareTestSession(root(),getDb(),getActiveWorkspaceId(),store.store as Record<string,unknown>)
      }else if(action==='reset')resetTestSession(root())
      else if(action==='clear_existing'){
        if(!isTestingMode())throw new Error('Enable Testing Mode first')
        clearExistingTestSales(root())
      }
      else if(action==='disable')disableTestSession(root())
      else throw new Error('Unknown testing action')
      return {success:true,data:{restart_required:true}}
    }finally{busy=false}
  })
  safeHandle(ipcMain,'testing:restart',()=>{
    if(!caller()?.id)throw new Error('Sign in first')
    app.relaunch();app.quit();return {success:true}
  })
}
