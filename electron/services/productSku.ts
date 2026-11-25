import type Database from 'better-sqlite3'

export function resolveProductSku(db:Database.Database,id:string,sku:unknown,barcode:unknown):string{
 const entered=String(sku||'').trim(),scanned=String(barcode||'').trim()
 const generated=!entered&&!scanned
 let candidate=entered||scanned||`NO-SKU-${id.slice(0,8).toUpperCase()}`
 const conflict=(value:string)=>db.prepare('SELECT id,name,is_active FROM products WHERE LOWER(TRIM(sku))=LOWER(?) AND id<>? LIMIT 1').get(value,id) as {id:string;name:string;is_active:number}|undefined
 let owner=conflict(candidate)
 if(owner&&generated){candidate=`NO-SKU-${id.toUpperCase()}`;owner=conflict(candidate)}
 if(owner)throw new Error(`SKU "${candidate}" is already used by "${owner.name}"${owner.is_active?'':' (inactive product)'}. Edit the existing product or use a different SKU.`)
 return candidate
}
