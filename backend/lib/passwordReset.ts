import {createHash,randomUUID} from 'crypto'
import type {QueryClient} from './db'

/** The row lock serializes redemption; consuming every link also invalidates parallel requests. */
export async function redeemPasswordReset(db:QueryClient,token:string,passwordHash:string):Promise<string>{
 await db.query('START TRANSACTION')
 try{
  const {rows}=await db.query<Record<string,string>>('SELECT l.*,u.password_hash FROM user_password_reset_links l JOIN users u ON u.id=l.user_id WHERE l.token_hash=? AND l.used_at IS NULL AND l.expires_at>NOW() AND u.is_active=1 FOR UPDATE',[createHash('sha256').update(token).digest('hex')])
  const link=rows[0]
  if(!link||createHash('sha256').update(link.password_hash).digest('hex')!==link.password_fingerprint)throw new Error('Invalid or expired link')
  await db.query('UPDATE users SET password_hash=?,force_password_change=0,login_attempts=0,locked_until=NULL,updated_at=NOW() WHERE id=?',[passwordHash,link.user_id])
  await db.query('UPDATE user_password_reset_links SET used_at=NOW() WHERE user_id=? AND used_at IS NULL',[link.user_id])
  await db.query("INSERT INTO audit_logs(id,user_id,action,table_name,record_id,new_values) VALUES(?,?,'PASSWORD_RESET_LINK','users',?,?)",[randomUUID(),link.user_id,link.user_id,JSON.stringify({method:'email_link'})])
  await db.query('COMMIT')
  return link.user_id
 }catch(error){await db.query('ROLLBACK');throw error}
}
