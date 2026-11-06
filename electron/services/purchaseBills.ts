import type Database from 'better-sqlite3'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const pending=new Map<string,{owner:string;files:Record<string,unknown>[];created:number}>()
export function stagePurchaseBills(paths:string[],directory:string,owner:string){
  fs.mkdirSync(directory,{recursive:true})
  const files:Record<string,unknown>[]=[]
  try {
    for(const source of paths){
      const ext=path.extname(source).toLowerCase()
      const mime:Record<string,string>={'.pdf':'application/pdf','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg'}
      const stat=fs.statSync(source)
      if(!mime[ext] || !stat.isFile() || stat.size>15*1024*1024) throw new Error('Choose a PDF/JPG/PNG bill no larger than 15 MB')
      const stored=randomUUID()+ext
      fs.copyFileSync(source,path.join(directory,stored))
      files.push({id:randomUUID(),original_name:path.basename(source),stored_name:stored,relative_path:`purchase-invoices/${stored}`,mime_type:mime[ext],file_size:stat.size,uploaded_by:owner})
    }
    const token=randomUUID(); pending.set(token,{owner,files,created:Date.now()})
    return {token,files:files.map(file=>({id:file.id,original_name:file.original_name}))}
  } catch(e){ for(const file of files) fs.rmSync(path.join(directory,String(file.stored_name)),{force:true}); throw e }
}
export function persistStagedBills(db:Database.Database,purchaseId:string,token:string|undefined,owner:string){
  if(!token) return
  const entry=pending.get(token)
  if(!entry || entry.owner!==owner || Date.now()-entry.created>3600000) throw new Error('Selected bills expired; select them again')
  for(const file of entry.files) db.prepare(`INSERT INTO purchase_attachments (id,purchase_id,original_name,stored_name,relative_path,mime_type,file_size,uploaded_by)
    VALUES (@id,@purchase_id,@original_name,@stored_name,@relative_path,@mime_type,@file_size,@uploaded_by)`).run({...file,purchase_id:purchaseId})
}
export function completeStagedBills(token?:string){ if(token) pending.delete(token) }
export function discardStagedBills(token:string,directory:string,owner:string){
  const entry=pending.get(token)
  if(!entry || entry.owner!==owner) return
  for(const file of entry.files) fs.rmSync(path.join(directory,String(file.stored_name)),{force:true})
  pending.delete(token)
}
