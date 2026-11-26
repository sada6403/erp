import {useEffect,useState} from 'react'
import Modal from '@/components/shared/Modal'
import {colomboToday} from '@/lib/datetime'
import toast from 'react-hot-toast'

export default function PurchaseReturnModal({purchaseId,onClose,onDone}:{purchaseId:string;onClose:()=>void;onDone:()=>void}){
 const [id]=useState(()=>crypto.randomUUID()),[data,setData]=useState<any>(),[error,setError]=useState(''),[busy,setBusy]=useState(false),[date,setDate]=useState(colomboToday()),[reason,setReason]=useState(''),[quantities,setQuantities]=useState<Record<string,string>>({})
 useEffect(()=>{let active=true;window.api.purchases.returnContext(purchaseId).then((response:any)=>{if(!active)return;if(!response.success)setError(response.error);else setData(response.data)}).catch((e:unknown)=>{if(active)setError(String(e))});return()=>{active=false}},[purchaseId])
 async function save(){
  const items=Object.entries(quantities).filter(([,q])=>q!==''&&Number(q)!==0).map(([batch_id,q])=>({batch_id,quantity:Number(q)}))
  if(!items.length||reason.trim().length<3||!date){setError('Choose returned quantities, a date and a reason');return}
  setBusy(true)
  try{const result=await window.api.purchases.returnStock({id,purchase_id:purchaseId,date,reason,items});if(!result.success)throw new Error(result.error);toast.success('Supplier return saved; stock and supplier balance updated');onDone()}catch(e){setError(String(e))}finally{setBusy(false)}
 }
 return <Modal title={`Purchase return${data?' · '+data.purchase.po_number:''}`} size="xl" onClose={()=>{if(!busy)onClose()}} footer={<><button className="btn-secondary" disabled={busy} onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy||!data} onClick={save}>{busy?'Saving…':'Confirm supplier return'}</button></>}>
  <div className="space-y-4">
   {error&&<p role="alert" className="text-red-400">{error}</p>}
   {!data&&!error&&<p>Loading returnable batches…</p>}
   <p className="text-sm">Return only stock physically sent back to the supplier. The original purchase cost is used for the credit. Paid purchases create supplier credit for future purchases.</p>
   <div className="grid grid-cols-2 gap-3"><label>Return date<input aria-label="Return date" className="input block" type="date" value={date} onChange={e=>setDate(e.target.value)}/></label><label>Reason<input aria-label="Purchase return reason" className="input block" value={reason} onChange={e=>setReason(e.target.value)}/></label></div>
   <div className="overflow-auto"><table className="w-full text-sm text-left"><thead><tr><th>Product / Batch</th><th>Available</th><th>Cost / unit</th><th>Expiry</th><th>Return quantity</th></tr></thead><tbody>{data?.batches.map((batch:any)=><tr key={batch.id}><td className="py-2">{batch.product_name}<span className="block text-xs">{batch.batch_number}</span></td><td>{batch.quantity} {batch.unit}</td><td>Rs.{batch.cost_price}</td><td>{batch.expiry_date||'No expiry'}</td><td><input aria-label={`Return quantity ${batch.batch_number}`} className="input w-28" type="number" min="0" max={batch.quantity} step="any" value={quantities[batch.id]??''} onChange={e=>setQuantities({...quantities,[batch.id]:e.target.value})}/></td></tr>)}</tbody></table></div>
   {data?.batches.length===0&&<p>No remaining batch stock is available for return.</p>}
  </div>
 </Modal>
}
