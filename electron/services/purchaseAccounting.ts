import type Database from 'better-sqlite3'
import {purchaseMoney} from '../lib/purchaseMath'
import {queueInventoryRecord} from './inventoryOutbox'

/** Called inside the receipt transaction. Draft orders create no supplier debt. */
export function applyPurchaseBalance(db:Database.Database,purchaseId:string,persistOutbox=true,forceInvoice=false){
 const po=db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(purchaseId) as Record<string,any>
 if(!po)throw new Error('Purchase not found')
 // Compatibility with pre-upgrade databases is read-only until migrated.
 if(po.outstanding_amount===undefined)return
 const received=db.prepare('SELECT 1 FROM purchase_items WHERE po_id=? AND received_qty>0 LIMIT 1').get(purchaseId)
 if(!received&&po.status!=='RECEIVED'&&!forceInvoice)return
 const total=Number(po.total_amount),paid=Number(po.paid_amount||0)
 if(!Number.isFinite(total)||total<0||!Number.isFinite(paid)||paid<0||paid>total)throw new Error('Invalid purchase payment balance')
 const supplier=db.prepare('SELECT * FROM suppliers WHERE id=?').get(po.supplier_id) as Record<string,any>
 const cancelledValue=po.status==='CANCELLED'?Number((db.prepare('SELECT COALESCE(SUM(received_qty*unit_cost),0) value FROM purchase_items WHERE po_id=?').get(purchaseId) as {value:number}).value):total
 const liability=purchaseMoney(Math.max(0,cancelledValue-Number(po.returned_amount||0)))
 const refund=purchaseMoney(Math.max(0,paid-liability))
 const credit=purchaseMoney(Number(supplier.credit_balance||0)+Number(po.applied_supplier_credit||0)+refund-Number(po.refund_credit_amount||0))
 if(credit<0)throw new Error('Supplier credit was used by a later purchase; reconcile the credit before reducing this payment')
 const applied=purchaseMoney(Math.min(credit,Math.max(0,liability-paid)))
 const outstanding=purchaseMoney(Math.max(0,liability-paid-applied)),delta=purchaseMoney(outstanding-Number(po.outstanding_amount||0))
 db.prepare("UPDATE purchase_orders SET outstanding_amount=?,payment_status=?,applied_supplier_credit=?,refund_credit_amount=?,updated_at=datetime('now') WHERE id=?").run(outstanding,outstanding===0?'paid':paid>0||applied>0?'partial':'unpaid',applied,refund,purchaseId)
 db.prepare('UPDATE suppliers SET credit_balance=? WHERE id=?').run(purchaseMoney(credit-applied),po.supplier_id)
 db.prepare("UPDATE suppliers SET due_balance=ROUND(MAX(0,COALESCE(due_balance,0)+?),2),updated_at=datetime('now') WHERE id=?").run(delta,po.supplier_id)
 if(persistOutbox)queueInventoryRecord(db,'suppliers',db.prepare('SELECT * FROM suppliers WHERE id=?').get(po.supplier_id) as Record<string,unknown>,'UPDATE')
}

/** Allocate the existing supplier-payment flow FIFO without deducting its balance twice. */
export function allocateSupplierPayment(db:Database.Database,supplierId:string,amount:number){
 if(!Number.isFinite(amount)||amount<=0)throw new Error('Invalid supplier payment')
 let remaining=purchaseMoney(amount)
 const purchases=db.prepare("SELECT * FROM purchase_orders WHERE supplier_id=? AND outstanding_amount>0 ORDER BY COALESCE(purchase_date,created_at),created_at,id").all(supplierId) as Record<string,any>[]
 for(const po of purchases){
  if(remaining<=0)break
  const applied=purchaseMoney(Math.min(remaining,Number(po.outstanding_amount))),outstanding=purchaseMoney(Number(po.outstanding_amount)-applied)
  db.prepare("UPDATE purchase_orders SET paid_amount=ROUND(paid_amount+?,2),outstanding_amount=?,payment_status=?,updated_at=datetime('now') WHERE id=?").run(applied,outstanding,outstanding===0?'paid':'partial',po.id)
  queueInventoryRecord(db,'purchase_orders',db.prepare('SELECT * FROM purchase_orders WHERE id=?').get(po.id) as Record<string,unknown>,'UPDATE')
  remaining=purchaseMoney(remaining-applied)
 }
 return {allocated:purchaseMoney(amount-remaining),legacy_balance_payment:remaining}
}
