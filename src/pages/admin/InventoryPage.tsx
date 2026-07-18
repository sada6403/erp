import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { AlertCircle, ArrowRightLeft, Plus, Lock, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

export default function InventoryPage() {
  const [stocks, setStocks]       = useState<Record<string, unknown>[]>([])
  const [branchSummary, setBranchSummary] = useState<Record<string, unknown>[]>([])
  const [branches, setBranches] = useState<Record<string, unknown>[]>([])
  const [catalogTotalProducts, setCatalogTotalProducts] = useState(0)
  const [branchId, setBranchId] = useState('')
  const [transfers, setTransfers] = useState<Record<string, unknown>[]>([])
  const [movements, setMovements] = useState<Record<string, unknown>[]>([])
  const [tab, setTab]             = useState<'stock' | 'transfers' | 'movements'>('stock')
  const [movementType, setMovementType] = useState('')
  const [showTransfer, setShowTransfer] = useState(false)
  const [loading, setLoading]     = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [s, t, m] = await Promise.all([
        window.api.stocks.list(branchId || undefined),
        window.api.stocks.listTransfers(),
        window.api.stocks.movements(movementType ? { movement_type: movementType } : {})
      ])
      const [summary, branchList] = await Promise.all([
        window.api.stocks.branchSummary(),
        window.api.admin.branches.list(),
      ])
      const audit = await window.api.products.catalogAudit()
      if (s.success) setStocks(s.data as Record<string, unknown>[])
      else toast.error(s.error || 'Failed to load stock')
      if (t.success) setTransfers(t.data as Record<string, unknown>[])
      else toast.error(t.error || 'Failed to load transfers')
      if (m.success) setMovements(m.data as Record<string, unknown>[])
      else toast.error(m.error || 'Failed to load movements')
      if (summary.success) setBranchSummary(summary.data as Record<string, unknown>[])
      else toast.error(summary.error || 'Failed to load branch summary')
      if (branchList.success) setBranches(branchList.data as Record<string, unknown>[])
      else toast.error(branchList.error || 'Failed to load branches')
      if (audit.success) setCatalogTotalProducts(Number((audit.data as { totalProducts?: number } | undefined)?.totalProducts || 0))
      else toast.error(audit.error || 'Failed to load catalog audit')
    } catch {
      toast.error('Failed to load inventory data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [movementType])
  useEffect(() => { load() }, [branchId])

  const lowStock = stocks.filter(s => {
    const qty = Number(s.quantity || 0)
    return qty >= 1 && qty <= 5
  })
  const outOfStockRows = stocks.filter(s => Number(s.quantity || 0) === 0)
  const activeSummary = branchId
    ? branchSummary.find(b => String(b.id) === branchId)
    : branchSummary.find(b => String(b.code || '').toUpperCase() === 'MAIN') || branchSummary[0]
  const summaryProductCount = activeSummary ? Number(activeSummary.product_count || 0) : 0
  const summaryLowStockCount = activeSummary ? Number(activeSummary.low_stock_count || 0) : lowStock.length
  const summaryOutOfStock = activeSummary ? Number(activeSummary.out_of_stock_count || 0) : outOfStockRows.length
  const totalProducts = catalogTotalProducts || summaryProductCount
  const outOfStock = summaryOutOfStock
  const lowStockCount = summaryLowStockCount
  const remaining = Math.max(0, totalProducts - outOfStock - lowStockCount)
  const nextTransferStatus: Record<string, string> = {
    pending: 'approved', pending_approval: 'approved', approved: 'ready_for_dispatch',
    ready_for_dispatch: 'dispatched', dispatched: 'in_transit', in_transit: 'received'
  }
  const advanceTransfer = async (transfer: Record<string, unknown>) => {
    const next = nextTransferStatus[String(transfer.status)]
    if (!next) return
    try {
      const res = await window.api.stocks.updateTransfer(transfer.id, next)
      if (res.success) { toast.success(`Transfer marked ${next.replace(/_/g, ' ')}`); load() }
      else toast.error(res.error || 'Could not update transfer')
    } catch {
      toast.error('Could not update transfer')
    }
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

      <div className="px-6 pt-4">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3 flex-wrap">
            <div className="w-72">
            <label className="block text-xs font-medium mb-1.5 text-slate-400">Branch</label>
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input">
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={b.id as string} value={b.id as string}>
                  {b.name as string}
                </option>
              ))}
            </select>
            </div>
            <div className="flex flex-wrap gap-2 flex-1">
              <button
                onClick={() => setBranchId('')}
                className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${branchId === '' ? 'bg-brand-600 text-white border-brand-500' : 'bg-surface-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
              >
                All Branches
              </button>
              {branches.map((b: any) => (
                <button
                  key={`branch-btn-${String(b.id)}`}
                  onClick={() => setBranchId(String(b.id))}
                  className={`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${branchId === String(b.id) ? 'bg-brand-600 text-white border-brand-500' : 'bg-surface-800 text-slate-300 border-slate-700 hover:border-slate-500'}`}
                >
                  {String(b.name || 'Branch')}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            {[
              { label: 'Total Products', value: totalProducts },
              { label: 'Low Stock', value: lowStockCount },
              { label: 'Out of Stock', value: outOfStock },
              { label: 'Remaining', value: remaining },
            ].map(card => (
              <div key={card.label} className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                <p className="text-xs uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>{card.label}</p>
                <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{card.value}</p>
              </div>
            ))}
          </div>
        </div>
        {activeSummary && (
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Showing summary for <strong style={{ color: 'var(--text-2)' }}>{String(activeSummary.name || 'Main Branch')}</strong>
          </p>
        )}
      </div>

      {lowStock.length > 0 && (
        <div className="mx-6 my-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
          <AlertCircle size={14} className="text-red-400 flex-shrink-0" />
          <p className="text-sm text-red-400"><strong>{lowStock.length}</strong> items are low stock (1 to 5 units)</p>
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
          <>
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
                      <span className={`font-bold ${Number(s.quantity || 0) === 0 ? 'text-red-400' : Number(s.quantity || 0) <= 5 ? 'text-yellow-400' : 'text-green-400'}`}>
                        {s.quantity as number}
                      </span>
                    </td>
                    <td className="table-cell text-slate-400">{s.damaged_qty as number}</td>
                    <td className="table-cell">
                      {Number(s.quantity || 0) <= 0 ? <span className="badge-red">Out of Stock</span>
                      : Number(s.quantity || 0) <= 5 ? <span className="badge-yellow">Low Stock</span>
                      : <span className="badge-green">In Stock</span>}
                    </td>
                    <td className="table-cell">
                      <AdjustBtn stockId={s.id as string} productId={s.product_id as string} branchId={s.branch_id as string} current={s.quantity as number} onDone={load} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-6 pb-6 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {branchSummary.map((b: any) => {
                const isMain = String(b.code || '').toUpperCase() === 'MAIN'
                const low = isMain ? summaryLowStockCount : Number(b.low_stock_count || 0)
                const out = isMain ? summaryOutOfStock : Number(b.out_of_stock_count || 0)
                const products = isMain ? totalProducts : Number(b.product_count || 0)
                return (
                  <div key={String(b.id)} className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-card)' }}>
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{b.name}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{b.code || 'No code'}</p>
                      </div>
                      <span className={`badge-${out > 0 ? 'red' : low > 0 ? 'yellow' : 'green'}`}>
                        {out > 0 ? 'Out' : low > 0 ? 'Low' : 'OK'}
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-2 mt-4 text-center">
                      <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Products</p>
                        <p className="font-bold" style={{ color: 'var(--text-1)' }}>{products}</p>
                      </div>
                      <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Low</p>
                        <p className="font-bold text-yellow-500">{low}</p>
                      </div>
                      <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>Out</p>
                        <p className="font-bold text-red-500">{out}</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setBranchId(String(b.id))
                        setTab('stock')
                      }}
                      className="mt-4 btn-secondary btn-sm w-full"
                    >
                      View this branch
                    </button>
                  </div>
                )
              })}
            </div>
          </>
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
            <div className="flex gap-2 px-6 py-3 border-b border-slate-800 flex-shrink-0 overflow-x-auto">
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

function AdjustBtn({ stockId: _stockId, productId, branchId, current, onDone }: { stockId: string; productId: string; branchId: string; current: number; onDone: () => void }) {
  const { user } = useAuthStore()
  const isAdmin = Boolean(((user?.role as unknown as Record<string, unknown>)?.permissions as Record<string, unknown> || {})?.all)
  const targetRecordId = `${productId}-${branchId}`

  const [open, setOpen] = useState(false)
  const [qty, setQty]   = useState(current)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [unlock, setUnlock] = useState<{ unlocked: boolean; pending: boolean; request_id: string | null } | null>(null)

  const checkUnlock = async () => {
    if (isAdmin) return
    try {
      const res = await window.api.editRequests.checkUnlocked('stocks', targetRecordId)
      if (res.success) setUnlock(res.data)
      else toast.error(res.error || 'Failed to check edit permission')
    } catch {
      toast.error('Failed to check edit permission')
    }
  }

  const openEditor = async () => {
    await checkUnlock()
    setOpen(true)
  }

  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.stocks.adjustCorrection({
        product_id: productId, branch_id: branchId, quantity: qty, reason,
        edit_request_id: unlock?.request_id || undefined,
      })
      if (!res.success) { toast.error(res.error || 'Stock adjustment failed'); return }
      setOpen(false)
      setUnlock(null)
      onDone()
      toast.success('Stock adjusted')
    } catch {
      toast.error('Stock adjustment failed')
    } finally {
      setSaving(false)
    }
  }

  const requestEdit = async () => {
    if (!reason.trim()) { toast.error('Enter a reason for the request'); return }
    setSaving(true)
    try {
      const res = await window.api.editRequests.create({
        target_table: 'stocks', target_record_id: targetRecordId, reason,
        requested_changes: { new_quantity: qty },
      })
      if (!res.success) { toast.error(res.error || 'Could not submit request'); return }
      toast.success('Edit request submitted — waiting for admin approval')
      await checkUnlock()
    } catch {
      toast.error('Could not submit request')
    } finally {
      setSaving(false)
    }
  }

  if (!open) return <button onClick={openEditor} className="btn-ghost btn-sm"><Plus size={13} /></button>

  const canEditDirectly = isAdmin || unlock?.unlocked

  if (!canEditDirectly && unlock?.pending) {
    return (
      <div className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}>
        <Clock size={13} /> Pending approval
        <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">✕</button>
      </div>
    )
  }

  if (!canEditDirectly) {
    return (
      <div className="flex items-center gap-1">
        <input value={reason} onChange={e => setReason(e.target.value)} placeholder="reason for request" className="input py-1 text-sm w-32" />
        <button onClick={requestEdit} disabled={saving} className="btn-secondary btn-sm gap-1"><Lock size={12} /> Request Edit</button>
        <button onClick={() => setOpen(false)} className="btn-ghost btn-sm">✕</button>
      </div>
    )
  }

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
    window.api.products.list({}).then((r: any) => {
      if (r.success) setProducts(r.data as Record<string,unknown>[])
      else toast.error(r.error || 'Failed to load products')
    }).catch(() => toast.error('Failed to load products'))
    window.api.admin.branches.list().then((r: any) => {
      if (r.success) setBranches(r.data as Record<string,unknown>[])
      else toast.error(r.error || 'Failed to load branches')
    }).catch(() => toast.error('Failed to load branches'))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.stocks.transfer(form)
      if (res.success) { toast.success('Transfer initiated'); onSave() }
      else toast.error(res.error || 'Transfer failed')
    } catch {
      toast.error('Transfer failed')
    } finally {
      setSaving(false)
    }
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
