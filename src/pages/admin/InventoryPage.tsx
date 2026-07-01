import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { AlertCircle, ArrowRightLeft, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

export default function InventoryPage() {
  const [stocks, setStocks]       = useState<Record<string, unknown>[]>([])
  const [transfers, setTransfers] = useState<Record<string, unknown>[]>([])
  const [movements, setMovements] = useState<Record<string, unknown>[]>([])
  const [tab, setTab]             = useState<'stock' | 'transfers' | 'movements'>('stock')
  const [movementType, setMovementType] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [loading, setLoading]     = useState(true)

  const load = async () => {
    setLoading(true)
    const [s, t, m] = await Promise.all([
      window.api.stocks.list(),
      window.api.stocks.listTransfers(),
      window.api.stocks.movements(movementType ? { movement_type: movementType } : {})
    ])
    if (s.success) setStocks(s.data as Record<string, unknown>[])
    if (t.success) setTransfers(t.data as Record<string, unknown>[])
    if (m.success) setMovements(m.data as Record<string, unknown>[])
    setLoading(false)
  }

  useEffect(() => { load() }, [movementType])

  const lowStock = stocks.filter(s => (s.quantity as number) <= (s.min_stock_level as number))
  const nextTransferStatus: Record<string, string> = {
    pending: 'approved', pending_approval: 'approved', approved: 'ready_for_dispatch',
    ready_for_dispatch: 'dispatched', dispatched: 'in_transit', in_transit: 'received'
  }
  const advanceTransfer = async (transfer: Record<string, unknown>) => {
    const next = nextTransferStatus[String(transfer.status)]
    if (!next) return
    const res = await window.api.stocks.updateTransfer(transfer.id, next)
    if (res.success) { toast.success(`Transfer marked ${next.replace(/_/g, ' ')}`); load() }
    else toast.error(res.error || 'Could not update transfer')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Inventory" subtitle="Stock levels & transfers"
        actions={
          <button onClick={() => setShowTransfer(true)} className="btn-primary btn-sm gap-1.5">
            <ArrowRightLeft size={14} /> Transfer Stock
          </button>
        }
      />

      {lowStock.length > 0 && (
        <div className="mx-6 my-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400"><strong>{lowStock.length}</strong> items are at or below minimum stock level</p>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 px-6 pb-3 border-b border-slate-800 flex-shrink-0">
        {(['stock', 'transfers', 'movements'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all capitalize ${tab === t ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
            {t === 'movements' ? 'Movement Log' : t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        {tab === 'stock' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Product', 'SKU', 'Warehouse', 'Quantity', 'Damaged', 'Status', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={7} className="text-center py-16 text-slate-500">Loading...</td></tr>
              : stocks.map(s => (
                <tr key={s.id as string} className="table-row">
                  <td className="table-cell font-medium">{s.product_name as string}</td>
                  <td className="table-cell font-mono text-xs text-slate-400">{s.sku as string}</td>
                  <td className="table-cell text-slate-400">{s.warehouse_name as string || 'Main'}</td>
                  <td className="table-cell">
                    <span className={`font-bold ${(s.quantity as number) <= (s.min_stock_level as number) ? 'text-red-400' : 'text-green-400'}`}>
                      {s.quantity as number}
                    </span>
                  </td>
                  <td className="table-cell text-slate-400">{s.damaged_qty as number}</td>
                  <td className="table-cell">
                    {(s.quantity as number) <= 0 ? <span className="badge-red">Out of Stock</span>
                    : (s.quantity as number) <= (s.min_stock_level as number) ? <span className="badge-yellow">Low Stock</span>
                    : <span className="badge-green">In Stock</span>}
                  </td>
                  <td className="table-cell">
                    <AdjustBtn stockId={s.id as string} productId={s.product_id as string} branchId={s.branch_id as string} current={s.quantity as number} onDone={load} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : tab === 'transfers' ? (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Transfer', 'Product', 'From', 'To', 'Qty', 'Status', 'Date', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading...</td></tr>
              : transfers.map(t => (
                <tr key={t.id as string} className="table-row">
                  <td className="table-cell font-mono text-xs text-brand-400">{t.transfer_number as string || '—'}</td>
                  <td className="table-cell"><p className="font-medium">{t.product_name as string}</p><p className="text-xs text-slate-500 font-mono">{t.sku as string}</p></td>
                  <td className="table-cell text-slate-400">{t.from_branch_name as string || '—'}</td>
                  <td className="table-cell text-slate-400">{t.to_branch_name as string || '—'}</td>
                  <td className="table-cell font-bold">{t.quantity as number}</td>
                  <td className="table-cell"><span className={`badge-${t.status === 'received' ? 'green' : t.status === 'pending_approval' ? 'yellow' : t.status === 'cancelled' ? 'red' : 'blue'} capitalize`}>{String(t.status).replace(/_/g, ' ')}</span></td>
                  <td className="table-cell text-slate-400 text-xs">{new Date(t.initiated_at as string).toLocaleDateString()}</td>
                  <td className="table-cell">{nextTransferStatus[String(t.status)] &&
                    <button className="btn-secondary btn-sm capitalize" onClick={() => advanceTransfer(t)}>
                      Mark {nextTransferStatus[String(t.status)].replace(/_/g, ' ')}
                    </button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="flex flex-col min-h-full">
            <div className="flex gap-2 px-6 py-3 border-b border-slate-800 flex-shrink-0">
              {['', 'SALE', 'TRANSFER', 'RECEIVE', 'ADJUSTMENT'].map(type => (
                <button key={type || 'all'} onClick={() => setMovementType(type)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium ${movementType === type ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>
                  {type || 'All'}
                </button>
              ))}
            </div>
            <table className="w-full">
              <thead className="sticky top-0 bg-surface-900 z-10">
                <tr>
                  {['Date', 'Product', 'From', 'To', 'Qty', 'Type', 'Done By', 'Ref'].map(h => (
                    <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading...</td></tr>
                : movements.map(m => (
                  <tr key={m.id as string} className="table-row">
                    <td className="table-cell text-xs text-slate-400">{new Date(m.created_at as string).toLocaleString()}</td>
                    <td className="table-cell">
                      <p className="font-medium">{m.product_name as string}</p>
                      <p className="text-xs text-slate-500 font-mono">{m.sku as string}</p>
                    </td>
                    <td className="table-cell text-slate-400">{m.from_branch_name as string || '-'}</td>
                    <td className="table-cell text-slate-400">{m.to_branch_name as string || '-'}</td>
                    <td className="table-cell font-bold">{m.quantity as number}</td>
                    <td className="table-cell"><span className={`badge-${m.movement_type === 'SALE' ? 'red' : m.movement_type === 'TRANSFER' ? 'blue' : m.movement_type === 'RECEIVE' ? 'green' : 'yellow'}`}>{m.movement_type as string}</span></td>
                    <td className="table-cell text-slate-400">{m.done_by_name as string || '-'}</td>
                    <td className="table-cell font-mono text-xs text-brand-400">{(m.invoice_number as string) || (m.transfer_number as string) || '-'}</td>
                  </tr>
                ))}
                {!loading && movements.length === 0 && (
                  <tr><td colSpan={8} className="text-center py-16 text-slate-500">No stock movements found</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showTransfer && <TransferModal onClose={() => setShowTransfer(false)} onSave={() => { setShowTransfer(false); load() }} />}
    </div>
  )
}

function AdjustBtn({ stockId, productId, branchId, current, onDone }: { stockId: string; productId: string; branchId: string; current: number; onDone: () => void }) {
  const [open, setOpen] = useState(false)
  const [qty, setQty]   = useState(current)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    await window.api.stocks.adjust({ product_id: productId, branch_id: branchId, quantity: qty, reason })
    setSaving(false)
    setOpen(false)
    onDone()
    toast.success('Stock adjusted')
  }

  if (!open) return <button onClick={() => setOpen(true)} className="btn-ghost btn-sm"><Plus size={13} /></button>

  return (
    <div className="flex items-center gap-1">
      <input type="number" value={qty} onChange={e => setQty(parseInt(e.target.value)||0)} className="input py-1 text-sm w-20" />
      <input value={reason} onChange={e => setReason(e.target.value)} placeholder="reason" className="input py-1 text-sm w-28" />
      <button onClick={save} disabled={saving} className="btn-success btn-sm">OK</button>
      <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">✕</button>
    </div>
  )
}

function TransferModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [products, setProducts] = useState<Record<string,unknown>[]>([])
  const [branches, setBranches] = useState<Record<string,unknown>[]>([])
  const [form, setForm] = useState({ product_id: '', from_branch_id: '', to_branch_id: '', quantity: 1, notes: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.products.list({}).then((r: any) => r.success && setProducts(r.data as Record<string,unknown>[]))
    window.api.admin.branches.list().then((r: any) => r.success && setBranches(r.data as Record<string,unknown>[]))
  }, [])

  const save = async () => {
    setSaving(true)
    const res = await window.api.stocks.transfer(form)
    setSaving(false)
    if (res.success) { toast.success('Transfer initiated'); onSave() }
    else toast.error(res.error || 'Transfer failed')
  }

  return (
    <Modal title="Transfer Stock" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Transferring...' : 'Transfer'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Product</label>
          <select value={form.product_id} onChange={e => setForm(p => ({...p, product_id: e.target.value}))} className="input">
            <option value="">Select product...</option>
            {products.map(p => <option key={p.id as string} value={p.id as string}>{p.name as string} ({p.sku as string})</option>)}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">From Branch</label>
            <select value={form.from_branch_id} onChange={e => setForm(p => ({...p, from_branch_id: e.target.value}))} className="input">
              <option value="">Select...</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">To Branch</label>
            <select value={form.to_branch_id} onChange={e => setForm(p => ({...p, to_branch_id: e.target.value}))} className="input">
              <option value="">Select...</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </div>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Quantity</label><input type="number" value={form.quantity} onChange={e => setForm(p => ({...p, quantity: parseInt(e.target.value)||1}))} className="input" min="1" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><input value={form.notes} onChange={e => setForm(p => ({...p, notes: e.target.value}))} className="input" /></div>
      </div>
    </Modal>
  )
}
