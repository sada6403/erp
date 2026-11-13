import { createHash,randomBytes,randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import type { NextRequest } from 'next/server'
import { pool,tenantPool,type QueryClient } from '../db'
import { ensureTenantCompatibility } from '../auth'

export const managementRoles = ['director','assistant_general_manager','general_manager','zonal_manager','regional_manager','branch_manager','field_officer'] as const
export type ManagementRole = typeof managementRoles[number]
export type ManagementPlatform = 'director' | 'employee' | 'control'
export class ManagementError extends Error { constructor(message:string,public status=400){super(message)} }
export type ManagementContext = { companyId:string; userId:string; name?:string; email?:string; platform:ManagementPlatform; role:string; scopeType:string; scopeId:string|null; client:QueryClient }
const digest=(value:string)=>createHash('sha256').update(value).digest('hex')
export const sessionCookie='management_session'
export function requireBrowserOrigin(req:NextRequest){
 const configured=process.env.MANAGEMENT_PUBLIC_ORIGIN
 if(process.env.NODE_ENV==='production'&&!configured)throw new ManagementError('Configure MANAGEMENT_PUBLIC_ORIGIN before enabling browser login',503)
 const expected=new URL(configured||req.url).origin
 if(process.env.NODE_ENV==='production'&&!expected.startsWith('https://'))throw new ManagementError('Management browser access requires HTTPS',503)
 if(req.headers.get('origin')!==expected)throw new ManagementError('Invalid request origin',403)
}
export function jsonValue<T=Record<string,unknown>>(v:unknown):T { return (typeof v==='string'?JSON.parse(v):v) as T }
export async function transaction<T>(client:QueryClient,fn:()=>Promise<T>):Promise<T>{
 await client.query('START TRANSACTION')
 try {const result=await fn();await client.query('COMMIT');return result} catch(error){await client.query('ROLLBACK');throw error}
}
export async function audit(ctx:ManagementContext,action:string,id:string|null,details:unknown={}){
 await ctx.client.query('INSERT INTO management_audit (id,actor_id,action,entity_id,details) VALUES (?,?,?,?,?)',[randomUUID(),ctx.userId,action,id,JSON.stringify(details)])
}
async function tenant(companyId:string) {
 const {rows}=await pool.query<{id:string;db_schema:string}>("SELECT id,db_schema FROM companies WHERE id=? AND status IN ('active','trial')",[companyId])
 if(!rows.length) throw new ManagementError('Account unavailable',401)
 await ensureTenantCompatibility(rows[0].db_schema)
 const client=await tenantPool(rows[0].db_schema).connect()
 try {
  await client.query("SET time_zone='+00:00'")
  const setting=await client.query<{value:unknown}>("SELECT value FROM management_settings WHERE id='enabled'")
  if(!setting.rows.length || jsonValue<unknown>(setting.rows[0].value)!==true) throw new ManagementError('Management is not enabled for this company',403)
  return client
 }catch(error){client.release();throw error}
}
export async function login(companySlug:string,email:string,password:string,platform:ManagementPlatform){
 if(!['director','employee','control'].includes(platform) || !companySlug || !email || password.length>256) throw new ManagementError('Invalid credentials',401)
 const found=await pool.query<{id:string}>("SELECT id FROM companies WHERE (slug=? OR LOWER(name)=LOWER(?)) AND status IN ('active','trial')",[companySlug.trim(),companySlug.trim()])
 if(found.rows.length!==1) throw new ManagementError('Invalid credentials',401)
 const companyId=found.rows[0].id,client=await tenant(companyId)
 try {
  const {rows}=await client.query<Record<string,unknown>>(`SELECT u.id,u.password_hash,u.is_active,u.role_id,r.permissions,a.role_code,a.platform,a.status,a.session_version
   FROM users u JOIN roles r ON r.id=u.role_id LEFT JOIN management_access a ON a.user_id=u.id WHERE LOWER(u.email)=?`,[email.trim().toLowerCase()])
  const u=rows[0]
  if(!u || !Number(u.is_active) || !(await bcrypt.compare(password,String(u.password_hash||'')))) throw new ManagementError('Invalid credentials',401)
  const permissions=jsonValue<Record<string,boolean>>(u.permissions)
  if(platform==='control' ? !permissions.all : u.role_id!=='management-web-only'||u.status!=='active'||u.platform!==platform||(platform==='director'&&u.role_code!=='director')) throw new ManagementError('Platform access denied',403)
  const raw=randomBytes(48).toString('hex'),id=randomUUID()
  await client.query('INSERT INTO management_sessions (id,user_id,platform,token_hash,session_version,expires_at) VALUES (?,?,?,?,?,DATE_ADD(NOW(),INTERVAL 8 HOUR))',[id,u.id,platform,digest(raw),Number(u.session_version||1)])
  const ctx={companyId,userId:String(u.id),platform,role:String(u.role_code||'admin'),scopeType:'company',scopeId:null,client}
  await audit(ctx,'LOGIN',id,{platform})
  return {token:`${companyId}.${raw}`,userId:u.id}
 }catch(error){
  try{await client.query("INSERT INTO management_audit (id,actor_id,action,entity_id,details) VALUES (?,NULL,'LOGIN_FAILED',NULL,?)",[randomUUID(),JSON.stringify({platform})])}catch{/* Preserve the original authentication error. */}
  throw error
 }finally{client.release()}
}
export async function authorize(req:NextRequest):Promise<ManagementContext>{
 const bearer=req.headers.get('authorization')
 const token=bearer?.startsWith('Bearer ')?bearer.slice(7):req.cookies.get(sessionCookie)?.value
 if(!token || !/^[a-zA-Z0-9-]{1,64}\.[a-f0-9]{96}$/.test(token)) throw new ManagementError('Login required',401)
 // Cookie writes require same-origin. Native/mobile Bearer requests do not use ambient credentials.
 if(!['GET','HEAD'].includes(req.method) && !bearer) requireBrowserOrigin(req)
 const [companyId,raw]=token.split('.'),client=await tenant(companyId)
 try {
  const {rows}=await client.query<Record<string,unknown>>(`SELECT s.platform,s.session_version,u.id,u.name,u.email,u.is_active,u.role_id,r.permissions,a.role_code,a.scope_type,a.scope_id,a.status,a.platform allowed_platform,a.session_version current_version
   FROM management_sessions s JOIN users u ON u.id=s.user_id JOIN roles r ON r.id=u.role_id LEFT JOIN management_access a ON a.user_id=u.id
   WHERE s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>NOW()`,[digest(raw)])
  const row=rows[0]
  if(!row || !Number(row.is_active)||Number(row.session_version)!==Number(row.current_version||1)) throw new ManagementError('Session expired or revoked',401)
  const platform=String(row.platform) as ManagementPlatform
  if(platform==='control'){
   if(!jsonValue<Record<string,boolean>>(row.permissions).all) throw new ManagementError('Company Admin required',403)
  }else if(row.role_id!=='management-web-only'||row.status!=='active'||row.allowed_platform!==platform||(platform==='director'&&row.role_code!=='director')) throw new ManagementError('Account access revoked',401)
  return {companyId,userId:String(row.id),name:String(row.name),email:String(row.email),platform,role:String(row.role_code||'admin'),scopeType:platform==='control'?'company':String(row.scope_type),scopeId:platform==='control'?null:row.scope_id?String(row.scope_id):null,client}
 }catch(error){client.release();throw error}
}
export function requireControl(ctx:ManagementContext){if(ctx.platform!=='control')throw new ManagementError('POS management control required',403)}
export async function allowedBranches(ctx:ManagementContext):Promise<string[]>{
 const {rows}=await ctx.client.query<{id:string}>(`SELECT b.id FROM branches b
  LEFT JOIN management_branch_regions br ON br.branch_id=b.id LEFT JOIN regions r ON r.id=br.region_id
  WHERE (?='company' OR (?='branch' AND b.id=?) OR (?='region' AND r.id=?) OR (?='zone' AND r.zone_id=?))`,[ctx.scopeType,ctx.scopeType,ctx.scopeId,ctx.scopeType,ctx.scopeId,ctx.scopeType,ctx.scopeId])
 return rows.map(row=>row.id)
}
