import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
export default function PurchaseBillPicker({ onChange, disabled=false }: { onChange: (token:string)=>void; disabled?:boolean }) {
  const [token,setToken]=useState('')
  const [files,setFiles]=useState<{id:string;original_name:string}[]>([])
  const [loading,setLoading]=useState(false)
  useEffect(()=>()=>{ if(token) window.api.purchases.discardBills(token).catch(()=>undefined) },[token])
  const choose=async()=>{
    setLoading(true)
    try {
      const r=await window.api.purchases.chooseBills()
      if(!r.success){if(!r.cancelled) toast.error(r.error||'Could not select bills');return}
      setToken(r.data.token);setFiles(r.data.files);onChange(r.data.token)
    }catch(e){toast.error(String(e))}finally{setLoading(false)}
  }
  return <div className="rounded-lg border p-3 space-y-2" style={{borderColor:'var(--border)'}}>
    <div className="flex items-center gap-3"><span className="text-sm font-semibold">Supplier bill (PDF / image)</span><button type="button" className="btn-secondary btn-sm" disabled={disabled||loading} onClick={choose}>{files.length?'Replace bills':'Upload supplier bill'}</button></div>
    {files.map(file=><p key={file.id} className="text-xs">{file.original_name}</p>)}
    <p className="text-xs" style={{color:'var(--text-3)'}}>Bills are saved with this purchase. You can also attach bills later from purchase details.</p>
  </div>
}
