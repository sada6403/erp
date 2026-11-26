import type Database from 'better-sqlite3'

export function purchaseInventoryReport(db:Database.Database,branchId:string,filters:{search?:string;state?:string;days?:number;page?:number}={}){
 const days=filters.days??30,page=filters.page??0
 if(!Number.isInteger(days)||days<1||days>365||!Number.isInteger(page)||page<0)throw new Error('Invalid report period or page')
 const today="date('now','+330 minutes')",where=['b.branch_id=?'],args:unknown[]=[branchId]
 if(filters.search){where.push('(p.name LIKE ? OR p.sku LIKE ? OR p.barcode LIKE ? OR b.batch_number LIKE ?)');args.push(...Array(4).fill(`%${filters.search}%`))}
 if(filters.state==='expired')where.push(`b.quantity>0 AND b.expiry_date<${today}`)
 else if(filters.state==='near') {where.push(`b.quantity>0 AND b.expiry_date>=${today} AND b.expiry_date<=date('now','+330 minutes',?)`);args.push(`+${days} days`)}
 else if(filters.state==='available')where.push(`b.quantity>0 AND (b.expiry_date IS NULL OR b.expiry_date>=${today})`)
 const from=`FROM product_batches b JOIN products p ON p.id=b.product_id LEFT JOIN purchase_orders po ON po.id=b.po_id LEFT JOIN suppliers s ON s.id=po.supplier_id WHERE ${where.join(' AND ')}`
 const total=(db.prepare(`SELECT COUNT(*) n ${from}`).get(...args) as {n:number}).n
 const batches=db.prepare(`SELECT b.id,p.name product_name,p.sku,p.barcode,p.unit,b.batch_number,b.quantity,b.cost_price,b.selling_price,b.mrp,b.expiry_date,b.mfg_date,b.historical_cost_known,
  b.original_quantity,b.supplier_returned_quantity,po.po_number,po.supplier_invoice_number,s.name supplier_name,
  CASE WHEN b.quantity<=0 THEN 'sold_out' WHEN b.expiry_date<${today} THEN 'expired' WHEN b.expiry_date<=date('now','+330 minutes',?) THEN 'near_expiry' ELSE 'available' END expiry_state
  ${from} ORDER BY CASE WHEN b.expiry_date IS NULL THEN 1 ELSE 0 END,b.expiry_date,p.name,b.id LIMIT 200 OFFSET ?`).all(`+${days} days`,...args,page*200)
 const alerts=db.prepare(`SELECT SUM(CASE WHEN quantity>0 AND expiry_date<${today} THEN 1 ELSE 0 END) expired,
  SUM(CASE WHEN quantity>0 AND expiry_date>=${today} AND expiry_date<=date('now','+330 minutes',?) THEN 1 ELSE 0 END) near_expiry
  FROM product_batches WHERE branch_id=?`).get(`+${days} days`,branchId) as {expired:number;near_expiry:number}
 const lowStock=db.prepare(`SELECT p.id,p.name,p.sku,p.unit,p.min_stock_level,COALESCE(s.quantity,0) stock,
  MIN(COALESCE(s.quantity,0),COALESCE(b.saleable,0)+MAX(0,COALESCE(s.quantity,0)-COALESCE(b.total_quantity,0))) saleable_stock
  FROM products p LEFT JOIN (SELECT product_id,SUM(MAX(0,quantity-COALESCE(damaged_qty,0))) quantity FROM stocks WHERE branch_id=? AND warehouse_id IS NULL GROUP BY product_id) s ON s.product_id=p.id
  LEFT JOIN (SELECT product_id,SUM(quantity) total_quantity,SUM(CASE WHEN expiry_date IS NULL OR expiry_date>=${today} THEN quantity ELSE 0 END) saleable FROM product_batches WHERE branch_id=? GROUP BY product_id) b ON b.product_id=p.id
  WHERE p.is_active=1 AND (p.branch_id IS NULL OR p.branch_id=?) AND saleable_stock<=COALESCE(p.min_stock_level,0) ORDER BY saleable_stock,p.name LIMIT 1000`).all(branchId,branchId,branchId)
 const movements=db.prepare(`SELECT m.id,p.name product_name,p.sku,m.quantity,m.movement_type,m.from_branch_id,m.to_branch_id,m.reference_order_id,m.notes,m.status,m.created_at FROM stock_movements m JOIN products p ON p.id=m.product_id WHERE m.from_branch_id=? OR m.to_branch_id=? ORDER BY m.created_at DESC,m.rowid DESC LIMIT 500`).all(branchId,branchId)
 const returns=db.prepare(`SELECT r.id,r.return_number,r.return_date,r.total_amount,r.reason,po.po_number,s.name supplier_name FROM purchase_returns r JOIN purchase_orders po ON po.id=r.purchase_id JOIN suppliers s ON s.id=r.supplier_id WHERE r.branch_id=? ORDER BY r.created_at DESC,r.rowid DESC LIMIT 500`).all(branchId)
 const suppliers=db.prepare('SELECT id,name,COALESCE(due_balance,0) due_balance,COALESCE(credit_balance,0) credit_balance,COALESCE(due_balance,0)-COALESCE(credit_balance,0) net_due FROM suppliers WHERE is_active=1 ORDER BY name LIMIT 1000').all()
 return {batches,total,page,page_size:200,alerts:{expired:Number(alerts.expired||0),near_expiry:Number(alerts.near_expiry||0),low_stock:lowStock.length},low_stock:lowStock,movements,returns,suppliers}
}
