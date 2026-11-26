import {useEffect,useState} from 'react'
import toast from 'react-hot-toast'
import {purchaseLine,weightedPurchaseCost} from '../../../electron/lib/purchaseMath'
import {stockUnitFactor} from '../../../electron/lib/inventoryUnits'
import {useProductsStore} from '@/store/productsStore'

const money=(value:number|null|undefined)=>value==null?'Unknown':`Rs.${value.toLocaleString(undefined,{maximumFractionDigits:4})}`
export default function PurchasePricingPanel({item}:{item:{product_id:string;quantity:number;free_quantity?:number;discount_amount?:number;unit_cost:number;entry_unit?:string}}){
 const [context,setContext]=useState<any>(),[error,setError]=useState(''),[mode,setMode]=useState('batch'),[markup,setMarkup]=useState('0'),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[prices,setPrices]=useState<Record<string,string>>({})
 async function load(){
  const response=await window.api.purchases.pricingContext(item.product_id)
  if(!response.success)throw new Error(response.error)
  setContext(response.data);setMode(response.data.pricing_mode);setMarkup(String(response.data.markup_pct));setError('')
 }
 useEffect(()=>{
  let active=true
  setContext(undefined);setPrices({});setReason('')
  if(window.api.purchases.pricingContext)window.api.purchases.pricingContext(item.product_id).then((response:any)=>{
   if(!active)return
   if(!response.success){setError(response.error);return}
   setContext(response.data);setMode(response.data.pricing_mode);setMarkup(String(response.data.markup_pct));setError('')
  }).catch((e:unknown)=>{if(active)setError(String(e))})
  return()=>{active=false}
 },[item.product_id])
 async function save(action:()=>Promise<any>){
  setBusy(true)
  try{const result=await action();if(!result.success)throw new Error(result.error);await load();setReason('');useProductsStore.getState().invalidate();toast.success('Pricing saved with audit history')}catch(e){setError(String(e))}finally{setBusy(false)}
 }
 if(!context)return error?<p role="alert" className="col-span-full text-xs text-red-400">{error}</p>:null
 let incoming:number|null=null,average:number|null=null,message=''
 try{
  const factor=stockUnitFactor(item.entry_unit||context.unit,context.unit,context.packs)
  const line=purchaseLine(item.quantity,item.unit_cost,item.free_quantity||0,item.discount_amount||0,factor)
  incoming=line.quantity
  if(context.average_cost!=null)average=weightedPurchaseCost(context.quantity,context.average_cost,line.quantity,line.unit_cost)
 }catch(e){message=String(e)}
 return <details className="col-span-full order-3 text-xs border rounded-lg p-2" style={{borderColor:'var(--border)'}}>
  <summary className="cursor-pointer font-semibold">Stock & pricing · {context.quantity} {context.unit} on hand · Average cost {money(context.average_cost)}</summary>
  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-3">
   <div>Previous purchase<strong className="block">{money(context.previous_purchase_price)}</strong></div><div>Latest purchase<strong className="block">{money(context.latest_purchase_price)}</strong></div>
   <div>Stock after receipt<strong className="block">{incoming==null?'—':Math.round((context.quantity+incoming)*1e6)/1e6} {context.unit}</strong></div><div>New weighted average<strong className="block">{money(average)}</strong></div>
   <div>Suggested selling price<strong className="block">{money(average==null?null:average*(1+Number(markup||0)/100))} / {context.unit}</strong></div>
  </div>
  {!context.cost_known&&<p className="text-amber-400">Opening stock has no known historical cost. Weighted-average selling requires cost reconciliation.</p>}
  {message&&<p>{message}</p>}
  <div className="flex flex-wrap gap-2 py-2 items-end">
   <label>Pricing policy<select aria-label="Pricing policy" className="input block" disabled={!context.can_adjust||busy} value={mode} onChange={e=>setMode(e.target.value)}><option value="batch">Batch price</option><option value="latest">Latest price</option><option value="weighted">Weighted average + markup</option></select></label>
   <label>Markup %<input aria-label="Pricing markup" className="input block w-24" type="number" min="0" max="10000" value={markup} disabled={!context.can_adjust||busy} onChange={e=>setMarkup(e.target.value)}/></label>
   <label>Adjustment reason<input aria-label="Pricing adjustment reason" className="input block" value={reason} disabled={!context.can_adjust||busy} onChange={e=>setReason(e.target.value)}/></label>
   <button type="button" className="btn-secondary btn-sm" disabled={!context.can_adjust||busy||reason.trim().length<3} onClick={()=>save(()=>window.api.purchases.setPricing({product_id:item.product_id,mode,markup:Number(markup),reason}))}>Apply pricing</button>
  </div>
  {error&&<p role="alert" className="text-red-400">{error}</p>}
  <div className="max-h-48 overflow-auto"><table className="w-full text-left"><thead><tr><th>Batch</th><th>Stock</th><th>Cost</th><th>MRP</th><th>Expiry</th><th>Selling price</th></tr></thead><tbody>{context.batches.map((batch:any)=><tr key={batch.id}><td>{batch.batch_number}</td><td>{batch.quantity}</td><td>{batch.known?money(batch.cost_price):'Unknown'}</td><td>{batch.mrp==null?'—':money(batch.mrp)}</td><td>{batch.expiry_date||'No expiry'}</td><td><div className="flex gap-1"><input aria-label={`Selling price for batch ${batch.batch_number}`} className="input w-24" type="number" min="0" step="any" disabled={!context.can_adjust||busy} value={prices[batch.id]??batch.selling_price??''} onChange={e=>setPrices({...prices,[batch.id]:e.target.value})}/><button type="button" className="btn-secondary btn-sm" disabled={!context.can_adjust||busy||prices[batch.id]==null||prices[batch.id]===''||reason.trim().length<3} onClick={()=>save(()=>window.api.purchases.adjustBatchPrice({batch_id:batch.id,price:Number(prices[batch.id]),reason}))}>Save</button></div></td></tr>)}</tbody></table></div>
  <p className="pt-2" style={{color:'var(--text-3)'}}>Prices are per base unit. Manual batch prices apply with the Batch price policy. MRP includes tax; a sale line spanning batches uses the lowest applicable MRP ceiling.</p>
 </details>
}
