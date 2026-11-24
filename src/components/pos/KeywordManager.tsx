import { useEffect, useState } from 'react'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

interface Props { product?: {id:string;name:string}; initialKeyword?:string; onClose:()=>void }
export default function KeywordManager({product,initialKeyword='',onClose}:Props) {
  const [status,setStatus]=useState<{enabled:boolean;uniqueCodes:boolean;admin:boolean;manage:boolean;own:boolean;userId:string}>()
  const [rows,setRows]=useState<any[]>([])
  const [keyword,setKeyword]=useState(initialKeyword)
  const [scope,setScope]=useState('user')
  const [filter,setFilter]=useState('all')
  const [selected,setSelected]=useState<string[]>([])
  const [editing,setEditing]=useState<any>()
  const [busy,setBusy]=useState(false)
  const [error,setError]=useState('')
  async function load() {
    const response=await window.api.keywords.status()
    if(!response.success)throw new Error(response.error)
    setStatus(response.data)
    if(response.data.enabled) {
      const list=await window.api.keywords.list({management:true,productId:product?.id})
      if(!list.success)throw new Error(list.error)
      setRows(list.data)
    } else setRows([])
  }
  useEffect(()=>{void load().catch(err=>setError(err.message))},[product?.id])
  async function run(action:()=>Promise<any>) {
    setBusy(true);setError('')
    try {const result=await action();if(!result.success)throw new Error(result.error);await load();setSelected([])}catch(err){setError((err as Error).message)}finally{setBusy(false)}
  }
  const visible=rows.filter(row=>filter==='all'||filter==='pending'&&row.review_status==='pending'||row.scope_type===filter)
  const mayEdit=(row:any)=>status?.admin||row.scope_type==='user'&&row.user_id===status?.userId&&status?.own||row.scope_type!=='user'&&status?.manage
  return <Modal title={product?`Search keywords — ${product.name}`:'Search keywords'} onClose={onClose} size="xl">
    <div className="space-y-4 keyword-text" onKeyDown={event=>{if(event.key!=='Escape')event.stopPropagation()}}>
      <p className="text-sm">Keywords help find products. Cart and receipts use the master product name.</p>
      {error&&<p role="alert" className="text-red-400">{error}</p>}
      {status?.admin&&<div className="flex flex-wrap items-center gap-4">
        <label><input type="checkbox" checked={status.enabled} disabled={busy} onChange={e=>{const enabled=e.target.checked;void run(()=>window.api.keywords.configure({enabled,uniqueCodes:status.uniqueCodes}))}}/> Enable keywords (backs up database before first enable)</label>
        <label><input type="checkbox" checked={status.uniqueCodes} disabled={busy} onChange={e=>{const uniqueCodes=e.target.checked;void run(()=>window.api.keywords.configure({enabled:status.enabled,uniqueCodes}))}}/> Unique quick codes</label>
      </div>}
      {!status?.enabled&&<p>Keywords are disabled. Company Admin can enable this feature here.</p>}
      {status?.enabled&&<>
        {(product||editing)&&status.own&&<form className="flex flex-wrap gap-2" onSubmit={e=>{e.preventDefault();void run(async()=>{const res=await window.api.keywords.save({id:editing?.id,version:editing?.version,product_id:editing?.product_id||product?.id,keyword,scope_type:editing?.scope_type||scope});if(res.success){setKeyword('');setEditing(undefined);toast.success('Keyword saved')}return res})}}>
          <input autoFocus aria-label="Keyword" className="input flex-1" value={keyword} maxLength={255} onChange={e=>setKeyword(e.target.value)} placeholder="arisi / அரிசி / සහල් / 1" required/>
          <select aria-label="Keyword scope" className="input w-36" value={editing?.scope_type||scope} disabled={Boolean(editing)} onChange={e=>setScope(e.target.value)}>
            <option value="user">My user</option>{status.manage&&<><option value="terminal">This PC</option><option value="branch">This branch</option><option value="global">Global</option></>}
          </select>
          <button className="btn-primary" disabled={busy}>Save keyword</button>
          {editing&&<button type="button" className="btn-secondary" onClick={()=>{setEditing(undefined);setKeyword('')}}>Cancel edit</button>}
        </form>}
        {!product&&!editing&&<p className="text-sm">Find a product in POS and choose “Add my keyword” to add a new keyword.</p>}
        <div className="flex flex-wrap gap-2">
          <select aria-label="Filter keywords" className="input w-44" value={filter} onChange={e=>setFilter(e.target.value)}>{['all','user','terminal','branch','global','pending'].map(value=><option key={value}>{value}</option>)}</select>
          {status.manage&&<>{['approved','rejected'].map(decision=><button className="btn-secondary" key={decision} disabled={busy||!selected.length} onClick={()=>void run(()=>window.api.keywords.review(selected,decision))}>{decision==='approved'?'Approve':'Reject'} selected drafts</button>)}</>}
        </div>
        <table className="w-full text-sm"><thead><tr><th>Review</th><th>Product</th><th>Keyword</th><th>Scope / source</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          {visible.map(row=><tr key={row.id} className="border-b" style={{borderColor:'var(--border)'}}>
            <td>{status.manage&&mayEdit(row)&&row.source==='auto_translit'&&<input aria-label={`Select ${row.keyword}`} type="checkbox" checked={selected.includes(row.id)} onChange={e=>setSelected(ids=>e.target.checked?[...ids,row.id]:ids.filter(id=>id!==row.id))}/>}</td>
            <td>{row.product_name}</td><td>{row.keyword}</td><td>{row.scope_type} / {row.source}</td><td>{row.review_status} / {row.is_active?'active':'inactive'}</td>
            <td>{mayEdit(row)&&<><button className="btn-secondary" disabled={busy} onClick={()=>{setEditing(row);setKeyword(row.keyword)}}>Edit</button> <button className="btn-secondary" disabled={busy||!row.is_active&&row.review_status!=='pending'} onClick={()=>void run(()=>window.api.keywords.remove(row.id))}>Remove</button></>}</td>
          </tr>)}
        </tbody></table>
      </>}
    </div>
  </Modal>
}
