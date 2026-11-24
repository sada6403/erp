import {useState} from 'react'
import Modal from '@/components/shared/Modal'
export function useBatchGuard(){
 const [question,setQuestion]=useState<{check:any;resolve:(accept:boolean)=>void}>()
 async function confirm<T extends Record<string,any>>(entries:T[]):Promise<(T&Record<string,any>)[]|null>{
  const prepared=[]
  for(const entry of entries){
   if(!entry.product_id||!entry.batch_number&&!entry.mfg_date&&!entry.expiry_date){prepared.push(entry);continue}
   const response=await window.api.batches.inspect(entry)
   if(!response.success)throw new Error(response.error)
   const check=response.data
   if(check.existing||check.warnings.length){
    const accept=await new Promise<boolean>(resolve=>setQuestion({check,resolve}))
    setQuestion(undefined);if(!accept)return null
    prepared.push({...entry,batch_resolution:check.existing?'add_existing':'acknowledge',existing_batch_id:check.existing?.id,acknowledge_dates:true,...(check.existing?{mfg_date:check.existing.mfg_date||''}:{})})
   }else prepared.push(entry)
  }
  return prepared
 }
 const dialog=question?<Modal title={question.check.existing?'Batch already exists':'Batch date warning'} onClose={()=>question.resolve(false)} footer={<><button className="btn-secondary" onClick={()=>question.resolve(false)}>Cancel</button><button className="btn-primary" onClick={()=>question.resolve(true)}>{question.check.existing?'Existing batch-ku quantity add pannu':'Continue with these dates'}</button></>}><div className="space-y-3">{question.check.existing&&<><p>Idhu already add panni irukku.</p><p>Batch: {question.check.existing.batch_number} · Stock quantity: {question.check.existing.quantity}</p><p>Entered date: {question.check.existing.entered_at||'—'}</p><p>Manufacture: {question.check.existing.mfg_date||'—'} · Expiry: {question.check.existing.expiry_date||'—'}</p><p className="text-xs">Adding quantity retains the existing physical batch dates and preserves separate purchase-cost layers.</p></>}{question.check.warnings.map((warning:string,i:number)=><p className="text-amber-400" key={i}>{warning}</p>)}</div></Modal>:null
 return {confirm,dialog}
}
