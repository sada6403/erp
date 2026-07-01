import { useEffect, useState } from 'react'
import { ArrowRightLeft, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

export default function StockLookupPage() {
  const [products, setProducts] = useState<Record<string, unknown>[]>([])
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Record<string, unknown> | null>(null)
  const [availability, setAvailability] = useState<Record<string, unknown>[]>([])
  const [transferFrom, setTransferFrom] = useState<Record<string, unknown> | null>(null)

  useEffect(() => { window.api.products.list({ is_active: true }).then((r: any) => r.success && setProducts(r.data)) }, [])
  const choose = async (product: Record<string, unknown>) => {
    setSelected(product)
    const res = await window.api.stocks.availability(product.id)
    if (res.success) setAvailability(res.data)
  }
  const filtered = products.filter(p => !query || String(p.name).toLowerCase().includes(query.toLowerCase()) ||
    String(p.sku).toLowerCase().includes(query.toLowerCase()))

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Cross-Branch Stock" subtitle="Find stock and request a branch transfer" />
    <div className="grid grid-cols-[360px_1fr] flex-1 overflow-hidden">
      <div className="border-r border-slate-800 overflow-auto">
        <div className="p-4 sticky top-0 bg-surface-900">
          <div className="relative"><Search size={14} className="absolute left-3 top-3 text-slate-500" />
            <input className="input pl-8" value={query} onChange={e => setQuery(e.target.value)} placeholder="Product, SKU or barcode" />
          </div>
        </div>
        {filtered.map(p => <button key={String(p.id)} onClick={() => choose(p)}
          className={`w-full text-left px-4 py-3 border-b border-slate-800 hover:bg-surface-800 ${selected?.id === p.id ? 'bg-brand-600/10' : ''}`}>
          <p className="text-sm font-medium">{String(p.name)}</p>
          <p className="text-xs text-slate-500 font-mono">{String(p.sku)}</p>
        </button>)}
      </div>
      <div className="p-6 overflow-auto">
        {!selected ? <div className="text-slate-500 text-center py-24">Select a product to view branch availability.</div> :
          <><h2 className="text-lg font-semibold">{String(selected.name)}</h2>
            <p className="text-sm text-slate-500 font-mono mb-5">{String(selected.sku)}</p>
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
              {availability.map(a => <div key={String(a.id)} className="card flex items-center justify-between">
                <div><p className="font-medium">{String(a.branch_name)}</p>
                  <p className="text-xs text-slate-500">{String(a.branch_address || 'Location not set')}</p>
                  <p className="text-xs text-slate-500 mt-1">Estimated transfer: 1–3 business days</p></div>
                <div className="text-right"><p className={`text-xl font-bold ${Number(a.available_quantity) ? 'text-green-400' : 'text-red-400'}`}>{Number(a.available_quantity)}</p>
                  <p className="text-xs text-slate-500">available</p>
                  {Number(a.available_quantity) > 0 && <button className="btn-primary btn-sm mt-2" onClick={() => setTransferFrom(a)}>
                    <ArrowRightLeft size={12} /> Request</button>}</div>
              </div>)}
            </div>
          </>}
      </div>
    </div>
    {transferFrom && selected && <QuickTransfer product={selected} source={transferFrom}
      onClose={() => setTransferFrom(null)} onDone={() => { setTransferFrom(null); choose(selected) }} />}
  </div>
}

function QuickTransfer({ product, source, onClose, onDone }: any) {
  const { user } = useAuthStore()
  const myBranchId = (user as any)?.branch_id ?? ''
  const [branches, setBranches] = useState<any[]>([])
  const [to, setTo] = useState(myBranchId)   // default to current user's branch
  const [qty, setQty] = useState(1)

  useEffect(() => {
    window.api.admin.branches.list().then((r: any) => {
      if (r.success) setBranches(r.data)
    })
  }, [])

  const save = async () => {
    if (!to) { toast.error('Please select a destination branch'); return }
    if (to === source.branch_id) { toast.error('Source and destination must be different'); return }
    const res = await window.api.stocks.transfer({
      product_id: product.id,
      from_branch_id: source.branch_id,
      to_branch_id: to,
      quantity: qty,
    })
    if (res.success) { toast.success(`Transfer request ${res.data.transfer_number} created`); onDone() }
    else toast.error(res.error)
  }

  return (
    <Modal title="Create Transfer Request" onClose={onClose}
      footer={
        <><button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Create Request</button></>
      }>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-slate-400">From</label>
          <p className="font-medium mt-0.5">{source.branch_name}</p>
        </div>
        <div>
          <label className="text-xs text-slate-400">Destination branch</label>
          <select className="input mt-1" value={to} onChange={e => setTo(e.target.value)}>
            <option value="">Select branch</option>
            {branches
              .filter(b => b.id !== source.branch_id)
              .map(b => (
                <option key={b.id} value={b.id}>
                  {b.name}{b.id === myBranchId ? ' (your branch)' : ''}
                </option>
              ))}
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400">Quantity</label>
          <input className="input mt-1" type="number" min={1}
            max={Number(source.available_quantity)} value={qty}
            onChange={e => setQty(Number(e.target.value))} />
          <p className="text-xs text-slate-500 mt-1">{source.available_quantity} available at {source.branch_name}</p>
        </div>
      </div>
    </Modal>
  )
}
