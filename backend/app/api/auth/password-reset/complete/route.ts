import {NextRequest,NextResponse} from 'next/server'
import {redeemPasswordReset} from '@/lib/passwordReset'
import bcrypt from 'bcryptjs'
import {pool,tenantPool,type QueryClient} from '@/lib/db'
import {authLimiter} from '@/lib/rateLimit'
export async function POST(request:NextRequest){
 const limited=authLimiter(request);if(limited)return limited
 try{
  const {token,company_slug,password}=await request.json()
  if(typeof company_slug!=='string'||!company_slug||company_slug.length>191||typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)return NextResponse.json({error:'Use a valid link and an 8–72 byte password'},{status:400})
  const {rows:companies}=await pool.query('SELECT id,db_schema FROM companies WHERE slug=? AND status IN (\'active\',\'trial\')',[company_slug]);if(!companies[0])throw new Error('Invalid link')
  const company=companies[0] as {id:string;db_schema:string},db=await tenantPool(company.db_schema).connect() as QueryClient
  const passwordHash=await bcrypt.hash(password,12)
  try{
   const userId=await redeemPasswordReset(db,token,passwordHash)
   await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE company_id=? AND user_id=? AND revoked_at IS NULL',[company.id,userId]).catch(()=>undefined)
   return NextResponse.json({success:true})
  }finally{db.release()}
 }catch{return NextResponse.json({error:'Invalid or expired reset link'},{status:400})}
}
