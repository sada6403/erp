import type Database from 'better-sqlite3'
import {normalizeLogin,suggestLoginId,validateLoginId} from '../lib/loginIdentity'
export function hasLoginIds(db:Database.Database){return (db.prepare('PRAGMA table_info(users)').all() as {name:string}[]).some(row=>row.name==='login_id')}
export function allocateLoginId(db:Database.Database,value:unknown,email:unknown,id?:string) {
 if(!hasLoginIds(db))throw new Error('Install the User ID migration before editing login accounts')
 const requested=String(value??'').trim()
 const used=new Set((db.prepare('SELECT login_id FROM users WHERE id!=?').all(id||'') as {login_id:string}[]).map(row=>normalizeLogin(row.login_id)))
 const loginId=requested?validateLoginId(requested):suggestLoginId(email,used)
 if(used.has(loginId))throw new Error('Indha User ID already irukku — this User ID is already in use')
 return loginId
}
export function backfillLoginIds(db:Database.Database) {
 const rows=db.prepare('SELECT id,email,login_id FROM users ORDER BY LOWER(email),id').all() as {id:string;email:string;login_id:string|null}[]
 const used=new Set(rows.filter(row=>row.login_id).map(row=>normalizeLogin(row.login_id)))
 for(const row of rows)if(!row.login_id){const loginId=suggestLoginId(row.email,used);used.add(loginId);db.prepare('UPDATE users SET login_id=?,login_id_generated=1 WHERE id=?').run(loginId,row.id)}
}
