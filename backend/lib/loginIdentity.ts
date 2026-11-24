import type {QueryClient} from './db'
import {normalizeLogin,suggestLoginId,validateLoginId} from '../../electron/lib/loginIdentity'
export async function supportsLoginIds(client:Pick<QueryClient,'query'>,table='users'){
 const {rows}=await client.query('SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME=? AND COLUMN_NAME=?',[table,'login_id']);return rows.length>0
}
export async function prepareUserIdentity(client:QueryClient,record:Record<string,unknown>,id:string){
 const {rows:current}=await client.query<{login_id:string}>('SELECT login_id FROM users WHERE id=?',[id])
 const {rows:users}=await client.query<{id:string;login_id:string}>('SELECT id,login_id FROM users WHERE id<>?',[id])
 const used=new Set(users.map(row=>normalizeLogin(row.login_id)))
 if((!record.login_id||record.login_id_generated!==0&&record.login_id_generated!==false)&&current[0]?.login_id)record.login_id=current[0].login_id
 else record.login_id=record.login_id?validateLoginId(record.login_id):suggestLoginId(record.email,used)
 if(used.has(String(record.login_id)))throw new Error('Indha User ID already irukku — User ID already exists')
 if(record.email){record.email=normalizeLogin(record.email);const {rows}=await client.query('SELECT id FROM users WHERE LOWER(TRIM(email))=? AND id<>?',[record.email,id]);if(rows.length)throw new Error('Email is already used by another user')}
}
