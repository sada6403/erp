import { useEffect, useState } from 'react'
import { Plus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

const FLOW = ['pending','confirmed','processing','preparing','ready_for_delivery','dispatched','in_transit','delivered']
const labels = (s: string) => s.replace(/_/g, ' ')

export default function OrdersPage() {
  const [orders, setOrders] = useState<Record<string, unknown>[]>([])
  const [filter, setFilter] = useState('')
  const [showForm, setShowForm] = useState(false)
  const load = async () => {
    try {
      const res = await window.api.orders.list(filter ? { status: filter } : {})
      if (res.success) setOrders(res.data)
      else toast.error(res.error || 'Failed to load orders')
    } catch (err) {
      toast.error('Failed to load orders: ' + String(err))
    }
  }
  useEffect(() => { load() }, [filter])
  const advance = async (o: Record<string, unknown>) => {
    const next = FLOW[FLOW.indexOf(String(o.status)) + 1]
    if (!next) return
    try {
      const res = await window.api.orders.updateStatus(o.id, next)
      if (res.success) { toast.success(`Order marked ${labels(next)}`); load() } else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to update order status: ' + String(err))
    }
  }
  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Customer Orders" subtitle={`${orders.length} tracked orders`}
      actions={<button className="btn-primary btn-sm" onClick={() => setShowForm(true)}><Plus size={14} /> New Order</button>} />
    <div className="flex gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
      {['', ...FLOW, 'cancelled', 'returned'].map(s => <button key={s} onClick={() => setFilter(s)}
        className={`px-3 py-1.5 rounded-lg text-xs capitalize whitespace-nowrap ${filter === s ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{s ? labels(s) : 'All'}</button>)}
    </div>
    <div className="flex-1 overflow-auto"><table className="w-full"><thead className="sticky top-0 bg-surface-900">
      <tr>{['Order','Customer','Branch','Items','Total','Payment','Delivery','Status',''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}</tr>
    </thead><tbody>{orders.map(o => <tr className="table-row" key={String(o.id)}>
      <td className="table-cell font-mono text-xs text-brand-400">{String(o.order_number)}</td>
      <td className="table-cell"><p className="font-medium">{String(o.customer_name)}</p><p className="text-xs text-slate-500">{String(o.customer_phone || '')}</p></td>
      <td className="table-cell text-slate-400">{String(o.branch_name)}</td><td className="table-cell">{Number(o.item_count)}</td>
      <td className="table-cell font-semibold">Rs.{Number(o.total_amount).toLocaleString()}</td>
      <td className="table-cell"><span className={o.payment_status === 'paid' ? 'badge-green' : 'badge-yellow'}>{String(o.payment_status)}</span></td>
      <td className="table-cell text-xs text-slate-400">{o.delivery_date ? new Date(String(o.delivery_date)).toLocaleDateString() : '—'}</td>
      <td className="table-cell"><span className="badge-blue capitalize">{labels(String(o.status))}</span></td>
      <td className="table-cell">{FLOW.includes(String(o.status)) && String(o.status) !== 'delivered' &&
        <button className="btn-secondary btn-sm capitalize" onClick={() => advance(o)}>Mark {labels(FLOW[FLOW.indexOf(String(o.status)) + 1])}</button>}</td>
    </tr>)}</tbody></table></div>
    {showForm && <OrderForm onClose={() => setShowForm(false)} onDone={() => { setShowForm(false); load() }} />}
  </div>
}

function OrderForm({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [products, setProducts] = useState<any[]>([])
  const [form, setForm] = useState({ customer_name:'', customer_phone:'', customer_address:'', delivery_date:'', notes:'', items:[{ product_id:'', quantity:1, unit_price:0 }] })
  useEffect(() => {
    window.api.products.list({ is_active:true })
      .then((r: any) => { if (r.success) setProducts(r.data); else toast.error(r.error || 'Failed to load products') })
      .catch((err: unknown) => toast.error('Failed to load products: ' + String(err)))
  }, [])
  const setItem = (index: number, key: string, value: any) => setForm(p => ({ ...p, items: p.items.map((i, n) => {
    if (n !== index) return i
    if (key === 'product_id') return { ...i, product_id:value, unit_price:Number(products.find(x => x.id === value)?.selling_price || 0) }
    return { ...i, [key]:value }
  }) }))
  const save = async () => {
    try {
      const res = await window.api.orders.create(form)
      if (res.success) { toast.success(`Order ${res.data.order_number} created`); onDone() } else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to create order: ' + String(err))
    }
  }
  return <Modal title="New Customer Order" size="lg" onClose={onClose}
    footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Create Order</button></>}>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-slate-400">Customer name *</label><input className="input mt-1" value={form.customer_name} onChange={e => setForm({...form,customer_name:e.target.value})} /></div>
      <div><label className="text-xs text-slate-400">Phone</label><input className="input mt-1" value={form.customer_phone} onChange={e => setForm({...form,customer_phone:e.target.value})} /></div>
      <div className="col-span-2"><label className="text-xs text-slate-400">Delivery address</label><input className="input mt-1" value={form.customer_address} onChange={e => setForm({...form,customer_address:e.target.value})} /></div>
      <div><label className="text-xs text-slate-400">Delivery date</label><input type="date" className="input mt-1" value={form.delivery_date} onChange={e => setForm({...form,delivery_date:e.target.value})} /></div>
      <div className="col-span-2 space-y-2"><label className="text-xs text-slate-400">Products *</label>
        {form.items.map((item, index) => <div className="grid grid-cols-[1fr_90px_130px] gap-2" key={index}>
          <select className="input" value={item.product_id} onChange={e => setItem(index,'product_id',e.target.value)}><option value="">Select product</option>{products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
          <input className="input" type="number" min={1} value={item.quantity} onChange={e => setItem(index,'quantity',Number(e.target.value))} />
          <input className="input" type="number" value={item.unit_price} onChange={e => setItem(index,'unit_price',Number(e.target.value))} />
        </div>)}
        <button className="btn-ghost btn-sm" onClick={() => setForm(p => ({...p,items:[...p.items,{product_id:'',quantity:1,unit_price:0}]}))}>+ Add product</button>
      </div>
      <div className="col-span-2"><label className="text-xs text-slate-400">Notes</label><textarea className="input mt-1" value={form.notes} onChange={e => setForm({...form,notes:e.target.value})} /></div>
    </div>
  </Modal>
}
