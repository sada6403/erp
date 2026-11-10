import type Database from 'better-sqlite3'
export interface BillHistoryFilters { status?:string;from?:string;to?:string;uploaded_from?:string;uploaded_to?:string;supplier_id?:string;uploaded_by?:string;file_type?:string;search?:string }
export function listPurchaseBills(db:Database.Database,branchId:string,filters:BillHistoryFilters={}) {
 const where=['po.branch_id=?','a.is_active=1'];const args:unknown[]=[branchId]
 if(filters.from){where.push('date(COALESCE(po.purchase_date,po.created_at))>=date(?)');args.push(filters.from)}
 if(filters.to){where.push('date(COALESCE(po.purchase_date,po.created_at))<=date(?)');args.push(filters.to)}
 if(filters.uploaded_from){where.push("date(a.uploaded_at,'+330 minutes')>=date(?)");args.push(filters.uploaded_from)}
 if(filters.uploaded_to){where.push("date(a.uploaded_at,'+330 minutes')<=date(?)");args.push(filters.uploaded_to)}
 if(filters.status){where.push('po.status=?');args.push(filters.status)}
 if(filters.supplier_id){where.push('po.supplier_id=?');args.push(filters.supplier_id)}
 if(filters.uploaded_by){where.push('a.uploaded_by=?');args.push(filters.uploaded_by)}
 if(filters.file_type==='pdf')where.push("a.mime_type='application/pdf'")
 if(filters.file_type==='image')where.push("a.mime_type LIKE 'image/%'")
 if(filters.search){where.push('(a.original_name LIKE ? OR po.po_number LIKE ? OR po.supplier_invoice_number LIKE ? OR s.name LIKE ? OR u.name LIKE ?)');args.push(...Array(5).fill(`%${filters.search}%`))}
 return db.prepare(`SELECT a.id,a.purchase_id,a.original_name,a.mime_type,a.file_size,a.uploaded_at,a.uploaded_by,
 u.name uploaded_by_name,po.po_number,po.supplier_id,po.supplier_invoice_number,
 COALESCE(po.purchase_date,date(po.created_at)) purchase_date,po.invoice_date,po.purchase_type,po.total_amount,po.status,s.name supplier_name
 FROM purchase_attachments a JOIN purchase_orders po ON po.id=a.purchase_id
 LEFT JOIN suppliers s ON s.id=po.supplier_id LEFT JOIN users u ON u.id=a.uploaded_by
 WHERE ${where.join(' AND ')} ORDER BY a.uploaded_at DESC,a.id DESC`).all(...args)
}
