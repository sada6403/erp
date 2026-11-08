import type { IpcMain } from 'electron'
import { net } from 'electron'
import { createCompanyStore } from '../services/companyWorkspace'
import { usesSupermarketStock } from '../services/supermarketModule'
import { safeHandle } from './ipcHandler'

const store=createCompanyStore()
let session:{token:string;localUserId:string;baseUrl:string}|null=null
function owner(){
 const settings=(store.get('app_settings')||{}) as Record<string,unknown>
 const user=(store.get('auth_user')||{}) as Record<string,any>
 if(!usesSupermarketStock(settings)||!(user.role?.permissions?.all||user.permissions?.all)||!user.id)throw new Error('Supermarket Company Admin access required')
 const baseUrl=String(settings.cloud_api_url||'').replace(/\/+$/,'')
 if(!baseUrl)throw new Error('Configure the existing Cloud API URL in Settings first')
 const url=new URL(baseUrl)
 if(url.protocol!=='https:'&&!['localhost','127.0.0.1','[::1]'].includes(url.hostname))throw new Error('Management requires HTTPS outside localhost')
 return {baseUrl,localUserId:String(user.id)}
}
async function request(resource:string,body?:unknown){
 const who=owner()
 if(!session||session.localUserId!==who.localUserId||session.baseUrl!==who.baseUrl)throw new Error('Connect to Management Control first')
 if(!/^[a-z-]+(?:\?[a-zA-Z0-9%=&_.:-]*)?$/.test(resource))throw new Error('Invalid management resource')
 const response=await net.fetch(`${who.baseUrl}/api/management/${resource}`,{method:body===undefined?'GET':'POST',headers:{Authorization:`Bearer ${session.token}`,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(30000)})
 const result=await response.json() as {success:boolean;error?:string;data?:unknown}
 if(response.status===401||response.status===403)session=null
 return result
}
export function registerManagementHandlers(ipcMain:IpcMain){
 safeHandle(ipcMain,'management:connect',async(_event,payload:{company:string;email:string;password:string})=>{
  const who=owner()
  const response=await net.fetch(`${who.baseUrl}/api/management/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...payload,platform:'control',transport:'bearer'}),signal:AbortSignal.timeout(30000)})
  const result=await response.json() as {success:boolean;error?:string;data?:{token:string;userId:string}}
  if(!result.success||!result.data)return {success:false,error:result.error||'Could not connect'}
  // Cloud authentication must match the current POS account, not another administrator.
  if(result.data.userId!==who.localUserId)return {success:false,error:'Sign in using the same Company Admin account as this POS session'}
  session={...who,token:result.data.token};return {success:true}
 })
 safeHandle(ipcMain,'management:read',(_event,resource:string)=>request(resource))
 safeHandle(ipcMain,'management:write',(_event,resource:string,body:unknown)=>request(resource,body))
 safeHandle(ipcMain,'management:disconnect',async()=>{
  try{return await request('logout',{})}finally{session=null}
 })
}
