import { NextRequest,NextResponse } from 'next/server'
import { authorize,login,ManagementError,sessionCookie,requireBrowserOrigin,type ManagementContext,type ManagementPlatform } from '@/lib/management/access'
import { readManagement,writeManagement } from '@/lib/management/service'
import { authLimiter } from '@/lib/rateLimit'

export const dynamic='force-dynamic'
function response(data:unknown,status=200){return NextResponse.json(data,{status,headers:{'Cache-Control':'no-store','Pragma':'no-cache'}})}
async function handle(req:NextRequest,params:Promise<{path:string[]}>) {
 let ctx:ManagementContext|undefined
 try{
  const resource=(await params).path.join('/')
  if(resource==='login'&&req.method==='POST'){
   const limited=authLimiter(req);if(limited)return limited
   const body=await req.json()
   const platform=String(body.platform) as ManagementPlatform
   // Browsers use cookie transport; native control/mobile clients explicitly request bearer transport.
   const bearer=body.transport==='bearer'
   if(!bearer)requireBrowserOrigin(req)
   const result=await login(String(body.company||''),String(body.email||''),String(body.password||''),platform)
   const res=response(bearer?{success:true,data:result}:{success:true,data:{userId:result.userId}})
   if(!bearer)res.cookies.set(sessionCookie,result.token,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'strict',path:'/api/management',maxAge:8*3600})
   return res
  }
  ctx=await authorize(req)
  if(resource==='logout'&&req.method==='POST'){
   await ctx.client.query('UPDATE management_sessions SET revoked_at=NOW() WHERE user_id=? AND platform=? AND revoked_at IS NULL',[ctx.userId,ctx.platform])
   const res=response({success:true});res.cookies.set(sessionCookie,'',{httpOnly:true,sameSite:'strict',path:'/api/management',maxAge:0});return res
  }
  if(req.method==='GET')return response({success:true,data:await readManagement(ctx,resource,req.nextUrl.searchParams)})
  if(req.method==='POST')return response({success:true,data:await writeManagement(ctx,resource,await req.json())})
  return response({success:false,error:'Method not allowed'},405)
 }catch(error){
  if(error instanceof ManagementError)return response({success:false,error:error.message},error.status)
  if(error instanceof SyntaxError)return response({success:false,error:'Invalid JSON'},400)
  const code=(error as {code?:string}).code
  if(code==='ER_NO_SUCH_TABLE')return response({success:false,error:'Management setup required. Apply the backup-first management migration in the test environment.'},503)
  if(code==='ER_DUP_ENTRY')return response({success:false,error:'This record already exists. Refresh before retrying.'},409)
  // Validation errors from the pure policy engine are safe; database/connection errors are not.
  if(error instanceof Error && !code && /^(Invalid |Commission |General managers |Below-minimum |Customer targets |Salary policy |Deductions )/.test(error.message))return response({success:false,error:error.message},400)
  return response({success:false,error:'Management service unavailable. Contact the administrator.'},503)
 }finally{ctx?.client.release()}
}
export async function GET(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){return handle(req,params)}
export async function POST(req:NextRequest,{params}:{params:Promise<{path:string[]}>}){return handle(req,params)}
