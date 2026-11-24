import {NextRequest,NextResponse} from 'next/server'
import {randomBytes,createHash} from 'crypto'
import {pool,tenantPool} from '@/lib/db'
import {sendCompanyEmail} from '@/lib/email'
import {authLimiter} from '@/lib/rateLimit'
export async function POST(request:NextRequest){
 const limited=authLimiter(request);if(limited)return limited
 const generic=()=>NextResponse.json({success:true,message:'If the email is registered, a reset link will be sent. Admin reset remains available.'})
 try{
  const input=await request.json();const email=String(input.email||'').trim().toLowerCase(),key=request.headers.get('x-api-key')||''
  const {rows:companies}=await pool.query('SELECT id,slug,db_schema FROM companies WHERE ((?<>\'\' AND slug=?) OR (?<>\'\' AND api_key=?)) AND status IN (\'active\',\'trial\') LIMIT 1',[String(input.company_slug||''),String(input.company_slug||''),key,key])
  const company=companies[0] as Record<string,string>|undefined;if(!company||!email)return generic()
  const db=tenantPool(company.db_schema)
  const {rows}=await db.query<Record<string,string>>('SELECT id,password_hash FROM users WHERE LOWER(TRIM(email))=? AND is_active=1',[email]);if(!rows[0])return generic()
  const base=process.env.PUBLIC_APP_URL||process.env.NEXT_PUBLIC_APP_URL;if(!base)return generic()
  const url=new URL('/reset-password',base);if(url.protocol!=='https:'&&url.hostname!=='localhost')return generic()
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex')
  await db.query('INSERT INTO user_password_reset_links(token_hash,user_id,password_fingerprint,expires_at,created_at) VALUES(?,?,?,DATE_ADD(NOW(),INTERVAL 15 MINUTE),NOW())',[hash,rows[0].id,createHash('sha256').update(rows[0].password_hash).digest('hex')])
  url.hash=new URLSearchParams({token,company:company.slug}).toString()
  await sendCompanyEmail(company.id,{to:email,subject:'POS password reset link',html:`<p>Use this single-use link within 15 minutes to reset your password.</p><p><a href="${url.href.replace(/&/g,'&amp;')}">Reset password</a></p><p>If you did not request this, ignore this email.</p>`,text:`Reset your password within 15 minutes: ${url.href}`})
  return generic()
 }catch{return generic()}
}
