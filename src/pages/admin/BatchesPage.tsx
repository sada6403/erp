import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Package, AlertTriangle, Clock, Search, Plus, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal from '@/components/shared/Modal'

interface Batch {
  id: string
  product_id: string
  product_name: string
  product_sku: string
  branch_name: string | null
  batch_number: string | null
  serial_number: string | null
  expiry_date: string | null
  mfg_date: string | null
  quantity: number
  cost_price: number
  days_until_expiry?: number
  created_at: string
}

function expiryStatus(expiry: string | null): 'expired' | 'critical' | 'warning' | 'ok' | null {
  if (!expiry) return null
  const days = Math.floor((new Date(expiry).getTime() - Date.now()) / 86400000)
  if (days < 0) return 'expired'
  if (days <= 7) return 'critical'
  if (days <= 30) return 'warning'
  return 'ok'
}

const STATUS_COLOR = {
  expired:  'bg-red-500/20 text-red-400 border-red-500/30',
  critical: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  warning:  'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  ok:       'bg-green-500/20 text-green-400 border-green-500/30',
}

export default function BatchesPage() {
  const [batches, setBatches]     = useState<Batch[]>([])
  const [search, setSearch]       = useState('')
  const [filter, setFilter]       = useState<'all' | 'expiring' | 'expired'>('all')
  const [showAdd, setShowAdd]     = useState(false)
  const [loading, setLoading]     = useState(true)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    const filters: Record<string, unknown> = {}
    if (filter === 'expiring') filters.expiring_days = 30
    const res = await window.api.batches.list(filters) as { success: boolean; data: Batch[] }
    if (res.success) {
      let data = res.data
      if (filter === 'expired') data = data.filter(b => b.expiry_date && new Date(b.expiry_date) < new Date())
      setBatches(data)
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [filter])

  const filtered = batches.filter(b =>
    !search || b.product_name.toLowerCase().includes(search.toLowerCase()) ||
    b.batch_number?.toLowerCase().includes(search.toLowerCase()) ||
    b.product_sku.toLowerCase().includes(search.toLowerCase())
  )

  const expiringCount = batches.filter(b => b.expiry_date && expiryStatus(b.expiry_date) !== 'ok').length
  const expiredCount  = batches.filter(b => b.expiry_date && expiryStatus(b.expiry_date) === 'expired').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Batch & Expiry Tracking"
        subtitle={`${batches.length} batches · ${expiringCount} expiring · ${expiredCount} expired`}
        actions={
          <button onClick={() => setShowAdd(true)} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Batch
          </button>
        }
      />

      {/* Filter bar */}
      <div className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-1">
          {(['all', 'expiring', 'expired'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-colors ${filter === f ? 'text-white' : 'hover:bg-[var(--bg-soft)]'}`}
              style={filter === f ? { background: 'var(--brand-primary)' } : { color: 'var(--text-3)' }}>
              {f === 'all' ? 'All Batches' : f === 'expiring' ? '⚠ Expiring (30d)' : '🔴 Expired'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 flex-1 max-w-xs ml-auto">
          <Search size={14} style={{ color: 'var(--text-3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input py-1.5 text-sm flex-1" placeholder="Search product, batch no…" />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <Package size={40} className="mx-auto mb-3" style={{ color: 'var(--text-3)' }} />
            <p className="text-sm" style={{ color: 'var(--text-3)' }}>No batches found</p>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Product', 'Batch No.', 'Expiry', 'Qty', 'Branch', 'Cost', ''].map(h => (
                    <th key={h} className="table-header px-4 py-3 text-left text-xs">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const st = expiryStatus(b.expiry_date)
                  const isExp = expandedId === b.id
                  const daysLeft = b.expiry_date ? Math.floor((new Date(b.expiry_date).getTime() - Date.now()) / 86400000) : null
                  return [
                    <tr key={b.id} className="table-row cursor-pointer" onClick={() => setExpandedId(isExp ? null : b.id)}>
                      <td className="table-cell px-4 py-3">
                        <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{b.product_name}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{b.product_sku}</p>
                      </td>
                      <td className="table-cell px-4 py-3">
                        <span className="font-mono text-sm" style={{ color: 'var(--text-2)' }}>{b.batch_number || '—'}</span>
                        {b.serial_number && <p className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>S/N: {b.serial_number}</p>}
                      </td>
                      <td className="table-cell px-4 py-3">
                        {b.expiry_date ? (
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${st ? STATUS_COLOR[st] : ''}`}>
                            {new Date(b.expiry_date).toLocaleDateString()}
                            {daysLeft !== null && <span className="ml-1">({daysLeft < 0 ? `${Math.abs(daysLeft)}d ago` : `${daysLeft}d left`})</span>}
                          </span>
                        ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                      </td>
                      <td className="table-cell px-4 py-3">
                        <span className={`font-bold text-sm ${b.quantity <= 0 ? 'text-red-400' : ''}`} style={{ color: b.quantity > 0 ? 'var(--text-1)' : undefined }}>
                          {b.quantity}
                        </span>
                      </td>
                      <td className="table-cell px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>{b.branch_name || '—'}</td>
                      <td className="table-cell px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>
                        Rs.{Number(b.cost_price).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="table-cell px-4 py-3">
                        {isExp ? <ChevronUp size={13} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />}
                      </td>
                    </tr>,
                    isExp && (
                      <tr key={`${b.id}-detail`} style={{ background: 'var(--bg-soft)' }}>
                        <td colSpan={7} className="px-6 py-3">
                          <div className="grid grid-cols-4 gap-4 text-xs" style={{ color: 'var(--text-2)' }}>
                            <div><span style={{ color: 'var(--text-3)' }}>Batch ID</span><br /><span className="font-mono">{b.id.slice(0, 16)}…</span></div>
                            <div><span style={{ color: 'var(--text-3)' }}>Mfg Date</span><br />{b.mfg_date || '—'}</div>
                            <div><span style={{ color: 'var(--text-3)' }}>Created</span><br />{new Date(b.created_at).toLocaleDateString()}</div>
                            <div className="flex gap-2 items-end">
                              {st === 'expired' && (
                                <span className="flex items-center gap-1 text-red-400 font-semibold"><AlertTriangle size={11} /> EXPIRED — remove from sale</span>
                              )}
                              {(st === 'critical' || st === 'warning') && (
                                <span className="flex items-center gap-1 text-yellow-400"><Clock size={11} /> Expires soon</span>
                              )}
                            </div>
                          </div>
                        </td>
                      </tr>
                    )
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddBatchModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); load() }} />}
    </div>
  )
}

function AddBatchModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [products, setProducts]   = useState<{ id: string; name: string; sku: string }[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [saving, setSaving]       = useState(false)
  const [form, setForm]           = useState({
    product_id: '', batch_number: '', serial_number: '',
    expiry_date: '', mfg_date: '', quantity: 1, cost_price: 0,
  })

  useEffect(() => {
    window.api.products.list({}).then((r: { success: boolean; data: { id: string; name: string; sku: string }[] }) => {
      if (r.success) setProducts(r.data)
    })
  }, [])

  const filteredProducts = products.filter(p =>
    !productSearch || p.name.toLowerCase().includes(productSearch.toLowerCase()) || p.sku.toLowerCase().includes(productSearch.toLowerCase())
  ).slice(0, 10)

  const save = async () => {
    if (!form.product_id) { toast.error('Select a product'); return }
    if (form.quantity <= 0) { toast.error('Quantity must be > 0'); return }
    setSaving(true)
    const res = await window.api.batches.create(form) as { success: boolean; error?: string }
    setSaving(false)
    if (res.success) { toast.success('Batch added'); onSaved() }
    else toast.error(res.error || 'Failed to add batch')
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(prev => ({ ...prev, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const selectedProduct = products.find(p => p.id === form.product_id)

  return (
    <Modal title="Add Batch / Serial / Expiry" onClose={onClose} size="md"
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Add Batch'}</button></>}>
      <div className="space-y-4">
        <div>
          <label className="label">Product *</label>
          {selectedProduct ? (
            <div className="flex items-center justify-between input cursor-pointer" onClick={() => setForm(f => ({ ...f, product_id: '' }))}>
              <span className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{selectedProduct.name}</span>
              <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{selectedProduct.sku}</span>
            </div>
          ) : (
            <>
              <input value={productSearch} onChange={e => setProductSearch(e.target.value)} className="input" placeholder="Search product…" autoFocus />
              {productSearch && (
                <div className="mt-1 rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {filteredProducts.map(p => (
                    <button key={p.id} onClick={() => { setForm(f => ({ ...f, product_id: p.id })); setProductSearch('') }}
                      className="w-full flex items-center justify-between px-3 py-2 hover:bg-[var(--bg-soft)] text-left">
                      <span className="text-sm" style={{ color: 'var(--text-1)' }}>{p.name}</span>
                      <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{p.sku}</span>
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Batch Number</label><input value={form.batch_number} onChange={f('batch_number')} className="input" placeholder="e.g. BT-2024-001" /></div>
          <div><label className="label">Serial Number</label><input value={form.serial_number} onChange={f('serial_number')} className="input" placeholder="e.g. SN-12345" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Manufacturing Date</label><input type="date" value={form.mfg_date} onChange={f('mfg_date')} className="input" /></div>
          <div><label className="label">Expiry Date</label><input type="date" value={form.expiry_date} onChange={f('expiry_date')} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Quantity *</label><input type="number" min={1} value={form.quantity} onChange={f('quantity')} className="input" /></div>
          <div><label className="label">Cost Price</label><input type="number" min={0} step={0.01} value={form.cost_price} onChange={f('cost_price')} className="input" /></div>
        </div>
      </div>
    </Modal>
  )
}
