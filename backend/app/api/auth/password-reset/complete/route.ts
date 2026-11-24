import {NextRequest,NextResponse} from 'next/server'
import {createHash,randomUUID} from 'crypto'
import bcrypt from 'bcryptjs'
import {pool,tenantPool,type QueryClient} from '@/lib/db'
import {authLimiter} from '@/lib/rateLimit'
export async function POST(request:NextRequest){
 const limited=authLimiter(request);if(limited)return limited
 try{
  const {token,company_slug,password}=await request.json()
  if(typeof token!=='string'||!/^[a-f0-9]{64}$/.test(token)||typeof password!=='string'||password.length<8||Buffer.byteLength(password)>72)return NextResponse.json({error:'Use a valid link and an 8–72 byte password'},{status:400})
  const {rows:companies}=await pool.query('SELECT id,db_schema FROM companies WHERE slug=? AND status IN (\'active\',\'trial\')',[company_slug]);if(!companies[0])throw new Error('Invalid link')
  const company=companies[0] as {id:string;db_schema:string},db=await tenantPool(company.db_schema).connect() as QueryClient
  const passwordHash=await bcrypt.hash(password,12)
  try{
   await db.query('START TRANSACTION')
   const {rows}=await db.query<Record<string,string>>('SELECT l.*,u.password_hash FROM user_password_reset_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=? AND l.used_at IS NULL AND l.expires_at>NOW() AND u.is_active=1 FOR UPDATE',[createHash('sha256').update(token).digest('hex')])
   const link=rows[0];if(!link||createHash('sha256').update(link.password_hash).digest('hex')!==link.password_fingerprint)throw new Error('Invalid or expired link')
   await db.query('UPDATE users SET password_hash=?,force_password_change=0,login_attempts=0,locked_until=NULL,updated_at=NOW() WHERE id=?',[passwordHash,link.user_id])
   await db.query('UPDATE user_password_reset_links SET used_at=NOW() WHERE user_id=? AND used_at IS NULL',[link.user_id])
   await db.query("INSERT INTO audit_logs(id,user_id,action,table_name,record_id,new_values) VALUES(?,?,'PASSWORD_RESET_LINK','users',?,?)",[randomUUID(),link.user_id,link.user_id,JSON.stringify({method:'email_link'})])
   await db.query('COMMIT')
   await pool.query('UPDATE refresh_tokens SET revoked_at=NOW() WHERE company_id=? AND user_id=? AND revoked_at IS NULL',[company.id,link.user_id]).catch(()=>undefined)
   return NextResponse.json({success:true})
  }catch{await db.query('ROLLBACK');throw new Error('Invalid or expired link')}finally{db.release()}
 }catch{return NextResponse.json({error:'Invalid or expired reset link'},{status:400})}
}
