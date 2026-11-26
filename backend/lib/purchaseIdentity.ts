import type {QueryClient} from './db'

export async function validatePurchaseInvoice(client:Pick<QueryClient,'query'>,record:Record<string,unknown>,id:string){
 const {rows}=await client.query<{supplier_id:string;supplier_invoice_number:string|null}>('SELECT supplier_id,supplier_invoice_number FROM purchase_orders WHERE id=? FOR UPDATE',[id])
 const supplier=record.supplier_id===undefined?rows[0]?.supplier_id:record.supplier_id
 const invoice=record.supplier_invoice_number===undefined?rows[0]?.supplier_invoice_number:record.supplier_invoice_number
 if(!supplier||!String(invoice||'').trim())return
 const duplicates=await client.query<{id:string}>('SELECT id FROM purchase_orders WHERE supplier_id=? AND LOWER(TRIM(supplier_invoice_number))=LOWER(?) AND id<>? FOR UPDATE',[supplier,String(invoice).trim(),id])
 if(duplicates.rows.length)throw new Error('Supplier invoice already belongs to another purchase. Reconcile the duplicate receipt before syncing its stock.')
}
