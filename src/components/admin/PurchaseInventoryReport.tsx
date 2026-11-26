import {useEffect,useState} from 'react'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

const names:Record<string,string>={batches:'Batch inventory',low_stock:'Low stock',movements:'Stock movements',returns:'Purchase returns',suppliers:'Supplier balances'}
export default function PurchaseInventoryReport({onClose}:{onClose:()=>void}){
 const [data,setData]=useState<any>(),[error,setError]=useState(''),[tab,setTab]=useState('batches'),[search,setSearch]=useState(''),[state,setState]=useState(''),[days,setDays]=useState(30),[page,setPage]=useState(0),[busy,setBusy]=useState(false)
 useEffect(()=>{
  let active=true;setBusy(true)
  const timer=setTimeout(()=>{window.api.purchases.inventoryReport({search,state,days,page}).then((r:any)=>{if(!active)return;if(!r.success)setError(r.error);else{setData(r.data);setError('')}}).catch((e:unknown)=>{if(active)setError(String(e))}).finally(()=>{if(active)setBusy(false)})},150)
  return()=>{active=false;clearTimeout(timer)}
 },[search,state,days,page])
 const rows=data?.[tab]||[],columns=rows.length?Object.keys(rows[0]).filter(key=>!['id'].includes(key)):[]
 async function exportRows(){
  const safeRows=rows.map((row:Record<string,unknown>)=>Object.fromEntries(Object.entries(row).map(([key,value])=>[key,typeof value==='string'&&/^[\s]*[=+@-]/.test(value)?"'"+value:value])))
  const result=await window.api.reports.exportCsvRows({filename:`inventory-${tab}.csv`,rows:safeRows,metadata:{Report:names[tab],Scope:tab==='batches'?`Page ${page+1}`:'Displayed rows'}})
  if(!result.success&&!result.cancelled)toast.error(result.error||'Export failed')
 }
 return <Modal title="Inventory alerts & reports" size="xl" onClose={onClose}>
  <div className="space-y-4">
   {data&&<div className="flex flex-wrap gap-2"><button className="btn-secondary" onClick={()=>{setTab('batches');setState('expired');setPage(0)}}>Expired: {data.alerts.expired}</button><button className="btn-secondary" onClick={()=>{setTab('batches');setState('near');setPage(0)}}>Near expiry: {data.alerts.near_expiry}</button><button className="btn-secondary" onClick={()=>setTab('low_stock')}>Low stock: {data.alerts.low_stock}</button></div>}
   <div className="flex flex-wrap gap-2">{Object.entries(names).map(([key,name])=><button className={tab===key?'btn-primary btn-sm':'btn-secondary btn-sm'} key={key} onClick={()=>setTab(key)}>{name}</button>)}</div>
   {tab==='batches'&&<div className="flex flex-wrap gap-2"><input aria-label="Inventory report search" className="input" placeholder="Product, SKU, barcode or batch" value={search} onChange={e=>{setSearch(e.target.value);setPage(0)}}/><select aria-label="Expiry status" className="input" value={state} onChange={e=>{setState(e.target.value);setPage(0)}}><option value="">All batches</option><option value="available">Available</option><option value="near">Near expiry</option><option value="expired">Expired</option></select><label>Near expiry days<input aria-label="Near expiry days" className="input w-24" type="number" min="1" max="365" value={days} onChange={e=>{setDays(Number(e.target.value));setPage(0)}}/></label></div>}
   {error&&<p role="alert" className="text-red-400">{error}</p>}
   <div className="flex justify-between items-center"><p className="text-sm">{busy?'Loading…':`${rows.length} displayed rows`}{tab==='batches'&&data?` / ${data.total} batches`:''}</p><button className="btn-secondary btn-sm" disabled={busy||!rows.length} onClick={exportRows}>Export displayed rows (CSV)</button></div>
   <div className="overflow-auto max-h-[50vh]"><table className="w-full text-xs text-left whitespace-nowrap"><thead><tr>{columns.map(key=><th className="p-2 capitalize" key={key}>{key.replace(/_/g,' ')}</th>)}</tr></thead><tbody>{rows.map((row:any,index:number)=><tr key={row.id||index} style={{borderTop:'1px solid var(--border)'}}>{columns.map(key=><td className="p-2" key={key}>{row[key]==null?'—':String(row[key])}</td>)}</tr>)}</tbody></table></div>
   {tab==='batches'&&<div className="flex justify-end gap-2"><button className="btn-secondary btn-sm" disabled={busy||page===0} onClick={()=>setPage(page-1)}>Previous</button><span>Page {page+1}</span><button className="btn-secondary btn-sm" disabled={busy||!data||(page+1)*200>=data.total} onClick={()=>setPage(page+1)}>Next</button></div>}
  </div>
 </Modal>
}
