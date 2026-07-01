import { useEffect, useRef, useState } from 'react'
import { Plus, RefreshCw, Eye, ChevronDown, Send, PackageCheck, XCircle, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

type PO = Record<string, unknown>
type POItem = Record<string, unknown>

const PO_STATUSES = ['DRAFT', 'SENT', 'PARTIAL', 'RECEIVED', 'CANCELLED'] as const

function statusBadge(status: string) {
  const map: Record<string, string> = {
    DRAFT: 'badge-yellow', SENT: 'badge-blue',
    PARTIAL: 'badge-orange', RECEIVED: 'badge-green', CANCELLED: 'badge-red'
  }
  return <span className={map[status] || 'badge-blue'}>{status}</span>
}

export default function PurchaseOrdersPage() {
  const [pos, setPOs]         = useState<PO[]>([])
  const [statusFilter, setFilter] = useState('')
  const [loading, setLoading] = useState(false)
  const [showCreate, setShowCreate] = useState(false)
  const [viewPO, setViewPO]   = useState<(PO & { items?: POItem[] }) | null>(null)
  const [showReceive, setShowReceive] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await window.api.purchases.list(statusFilter ? { status: statusFilter } : {})
    if (res.success) setPOs(res.data as PO[])
    setLoading(false)
  }

  useEffect(() => { load() }, [statusFilter])

  const loadDetail = async (id: string) => {
    const res = await window.api.purchases.get(id)
    if (res.success) setViewPO(res.data as PO & { items?: POItem[] })
  }

  const updateStatus = async (po: PO, status: string, extra?: unknown) => {
    const res = await window.api.purchases.updateStatus(String(po.id), status, extra)
    if (res.success) {
      toast.success(`PO ${po.po_number} → ${status}`)
      load()
      if (viewPO?.id === po.id) loadDetail(String(po.id))
    } else {
      toast.error(String(res.error))
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Purchase Orders"
        subtitle={`${pos.length} purchase orders`}
        actions={
          <div className="flex gap-2">
            <button className="btn-ghost btn-sm gap-1.5" onClick={load} disabled={loading}>
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
            <button className="btn-primary btn-sm gap-1.5" onClick={() => setShowCreate(true)}>
              <Plus size={14} /> New PO
            </button>
          </div>
        }
      />

      {/* Status filter tabs */}
      <div className="flex gap-2 px-6 py-3 border-b border-slate-800 overflow-x-auto">
        {['', ...PO_STATUSES].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap
              ${statusFilter === s ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900">
            <tr>
              {['PO #', 'Supplier', 'Branch', 'Items', 'Total', 'Expected', 'Status', ''].map(h =>
                <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {pos.map(po => (
              <tr className="table-row" key={String(po.id)}>
                <td className="table-cell font-mono text-xs text-brand-400">{String(po.po_number)}</td>
                <td className="table-cell font-medium">{String(po.supplier_name || '—')}</td>
                <td className="table-cell text-slate-400 text-sm">{String(po.branch_name || '—')}</td>
                <td className="table-cell text-center">{String(po.item_count ?? 0)}</td>
                <td className="table-cell font-semibold">
                  Rs.{Number(po.total_amount || 0).toLocaleString()}
                </td>
                <td className="table-cell text-xs text-slate-400">
                  {po.expected_date ? new Date(String(po.expected_date)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell">{statusBadge(String(po.status))}</td>
                <td className="table-cell">
                  <div className="flex gap-2">
                    <button className="btn-ghost btn-sm gap-1"
                      onClick={() => { loadDetail(String(po.id)) }}>
                      <Eye size={12} /> View
                    </button>
                    {po.status === 'DRAFT' && (
                      <button className="btn-secondary btn-sm gap-1"
                        onClick={() => updateStatus(po, 'SENT')}>
                        <Send size={12} /> Send
                      </button>
                    )}
                    {(po.status === 'SENT' || po.status === 'PARTIAL') && (
                      <button className="btn-primary btn-sm gap-1"
                        onClick={() => { loadDetail(String(po.id)); setShowReceive(true) }}>
                        <PackageCheck size={12} /> Receive
                      </button>
                    )}
                    {(po.status === 'DRAFT' || po.status === 'SENT') && (
                      <button className="btn-ghost btn-sm text-red-400 gap-1"
                        onClick={() => updateStatus(po, 'CANCELLED')}>
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {pos.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-16 text-slate-500">No purchase orders found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreatePOModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load() }}
        />
      )}

      {viewPO && !showReceive && (
        <PODetailModal
          po={viewPO}
          onClose={() => setViewPO(null)}
          onReceive={() => setShowReceive(true)}
          onSend={() => updateStatus(viewPO, 'SENT')}
          onCancel={() => updateStatus(viewPO, 'CANCELLED')}
        />
      )}

      {viewPO && showReceive && (
        <ReceivePOModal
          po={viewPO}
          onClose={() => { setShowReceive(false); setViewPO(null) }}
          onDone={(items) => {
            const isFullReceive = items.every((i: Record<string, unknown>) =>
              Number(i.received_qty) === Number(i.ordered_qty) - Number(i.already_received))
            updateStatus(viewPO, isFullReceive ? 'RECEIVED' : 'PARTIAL', { items })
            setShowReceive(false)
            setViewPO(null)
          }}
        />
      )}
    </div>
  )
}

function PODetailModal({ po, onClose, onReceive, onSend, onCancel }:
  { po: PO & { items?: POItem[] }; onClose: () => void; onReceive: () => void; onSend: () => void; onCancel: () => void }) {
  return (
    <Modal title={`PO — ${po.po_number}`} onClose={onClose}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-sm">
          <div><p className="text-slate-500">Supplier</p><p className="font-medium">{String(po.supplier_name || '—')}</p></div>
          <div><p className="text-slate-500">Branch</p><p className="font-medium">{String(po.branch_name || '—')}</p></div>
          <div><p className="text-slate-500">Status</p>{statusBadge(String(po.status))}</div>
          <div><p className="text-slate-500">Total</p><p className="font-bold text-brand-400">Rs.{Number(po.total_amount || 0).toLocaleString()}</p></div>
          <div><p className="text-slate-500">Expected</p><p>{po.expected_date ? new Date(String(po.expected_date)).toLocaleDateString() : '—'}</p></div>
          <div><p className="text-slate-500">Notes</p><p className="text-xs">{String(po.notes || '—')}</p></div>
        </div>

        <div>
          <p className="text-sm font-semibold mb-2">Items</p>
          <table className="w-full text-sm">
            <thead><tr className="border-b border-slate-700">
              <th className="text-left py-2 text-slate-400 font-normal">Product</th>
              <th className="text-right py-2 text-slate-400 font-normal">Ordered</th>
              <th className="text-right py-2 text-slate-400 font-normal">Received</th>
              <th className="text-right py-2 text-slate-400 font-normal">Unit Cost</th>
              <th className="text-right py-2 text-slate-400 font-normal">Total</th>
            </tr></thead>
            <tbody>{(po.items || []).map((item: POItem) => (
              <tr key={String(item.id)} className="border-b border-slate-800">
                <td className="py-2">{String(item.product_name || '—')}<br/><span className="text-xs text-slate-500">{String(item.sku || '')}</span></td>
                <td className="text-right py-2">{Number(item.quantity)}</td>
                <td className="text-right py-2 text-green-400">{Number(item.received_qty || 0)}</td>
                <td className="text-right py-2">Rs.{Number(item.unit_cost).toLocaleString()}</td>
                <td className="text-right py-2 font-semibold">Rs.{Number(item.line_total).toLocaleString()}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>

        <div className="flex justify-between pt-2">
          <div className="flex gap-2">
            {po.status === 'DRAFT' && <button className="btn-secondary btn-sm gap-1" onClick={onSend}><Send size={12}/>Send to Supplier</button>}
            {(po.status === 'SENT' || po.status === 'PARTIAL') && <button className="btn-primary btn-sm gap-1" onClick={onReceive}><PackageCheck size={12}/>Receive Items</button>}
            {(po.status === 'DRAFT' || po.status === 'SENT') && <button className="btn-ghost btn-sm text-red-400" onClick={onCancel}><XCircle size={12}/>Cancel PO</button>}
          </div>
          <button className="btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  )
}

function ReceivePOModal({ po, onClose, onDone }:
  { po: PO & { items?: POItem[] }; onClose: () => void; onDone: (items: Record<string, unknown>[]) => void }) {
  const [qtys, setQtys] = useState<Record<string, number>>(() => {
    const init: Record<string, number> = {}
    for (const item of po.items || []) {
      const remaining = Number(item.quantity) - Number(item.received_qty || 0)
      init[String(item.id)] = remaining > 0 ? remaining : 0
    }
    return init
  })

  const submit = () => {
    const items = (po.items || []).map((item: POItem) => ({
      id: item.id,
      received_qty: qtys[String(item.id)] || 0,
      ordered_qty: item.quantity,
      already_received: item.received_qty || 0,
    }))
    onDone(items)
  }

  return (
    <Modal title={`Receive Items — ${po.po_number}`} onClose={onClose}>
      <div className="space-y-4">
        <table className="w-full text-sm">
          <thead><tr className="border-b border-slate-700">
            <th className="text-left py-2 text-slate-400 font-normal">Product</th>
            <th className="text-right py-2 text-slate-400 font-normal">Ordered</th>
            <th className="text-right py-2 text-slate-400 font-normal">Already Received</th>
            <th className="text-right py-2 text-slate-400 font-normal">Receiving Now</th>
          </tr></thead>
          <tbody>
            {(po.items || []).map((item: POItem) => {
              const remaining = Number(item.quantity) - Number(item.received_qty || 0)
              return (
                <tr key={String(item.id)} className="border-b border-slate-800">
                  <td className="py-2 font-medium">{String(item.product_name || '—')}</td>
                  <td className="text-right py-2">{Number(item.quantity)}</td>
                  <td className="text-right py-2 text-slate-400">{Number(item.received_qty || 0)}</td>
                  <td className="text-right py-2">
                    <input
                      type="number"
                      min={0}
                      max={remaining}
                      value={qtys[String(item.id)] ?? 0}
                      onChange={e => setQtys(q => ({ ...q, [String(item.id)]: Math.min(remaining, Math.max(0, parseInt(e.target.value) || 0)) }))}
                      className="input w-20 text-right py-1 text-sm"
                      disabled={remaining <= 0}
                    />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        <div className="flex justify-end gap-3 pt-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary gap-1" onClick={submit}>
            <PackageCheck size={14} /> Confirm Receipt
          </button>
        </div>
      </div>
    </Modal>
  )
}

function ProductSearchSelect({
  products, value, onChange
}: {
  products: Record<string, unknown>[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const ref     = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = products.find(p => String(p.id) === value)
  const filtered = products.filter(p => {
    const q = query.toLowerCase()
    return (
      String(p.name).toLowerCase().includes(q) ||
      String(p.sku || '').toLowerCase().includes(q)
    )
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset highlight when filter changes
  useEffect(() => { setHighlighted(0) }, [query])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[highlighted] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const openDropdown = () => { setOpen(true); setQuery(''); setHighlighted(0) }

  const select = (id: string) => {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openDropdown() } return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) select(String(filtered[highlighted].id)) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'Tab')   { setOpen(false) }
  }

  return (
    <div ref={ref} className="relative min-w-0 w-full">
      <div
        tabIndex={0}
        className="input text-sm py-1.5 flex items-center gap-2 cursor-pointer overflow-hidden focus:outline-none"
        onClick={openDropdown}
        onKeyDown={onKeyDown}
      >
        <span className="min-w-0 flex-1 truncate" style={{ color: selected ? 'var(--text-1)' : 'var(--text-3)' }}>
          {selected ? `${String(selected.name)} (${String(selected.sku || '')})` : 'Select product...'}
        </span>
        <ChevronDown size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg shadow-xl border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-2)' }}>
          <div className="flex items-center gap-2 px-2 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <Search size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <input
              autoFocus
              type="text"
              placeholder="Search product or SKU..."
              className="bg-transparent text-sm outline-none w-full"
              style={{ color: 'var(--text-1)' }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: 'var(--text-3)' }}>No products found</p>
            ) : filtered.map((p, i) => (
              <div
                key={String(p.id)}
                onClick={() => select(String(p.id))}
                onMouseEnter={() => setHighlighted(i)}
                className="px-3 py-2 text-sm cursor-pointer flex items-center justify-between gap-2 transition-colors"
                style={{
                  background: i === highlighted ? 'var(--bg-soft)' : 'transparent',
                  color: String(p.id) === value ? 'var(--brand-500, #6366f1)' : 'var(--text-1)',
                }}
              >
                <span className="truncate">{String(p.name)}</span>
                <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>{String(p.sku || '')}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function CreatePOModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [suppliers, setSuppliers] = useState<Record<string, unknown>[]>([])
  const [products, setProducts]   = useState<Record<string, unknown>[]>([])
  const [form, setForm] = useState({
    supplier_id: '', expected_date: '', notes: '',
    items: [{ product_id: '', quantity: 1, unit_cost: 0 }]
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.admin.suppliers.list().then((r: { success: boolean; data: unknown }) => {
      if (r.success) setSuppliers(r.data as Record<string, unknown>[])
    })
    window.api.products.list({ is_active: true }).then((r: { success: boolean; data: unknown }) => {
      if (r.success) setProducts(r.data as Record<string, unknown>[])
    })
  }, [])

  const setItem = (index: number, key: string, value: unknown) => {
    setForm(f => ({
      ...f,
      items: f.items.map((item, i) => {
        if (i !== index) return item
        if (key === 'product_id') {
          const prod = products.find(p => p.id === value) as Record<string, unknown> | undefined
          return { ...item, product_id: String(value), unit_cost: Number(prod?.cost_price || prod?.selling_price || 0) }
        }
        return { ...item, [key]: value }
      })
    }))
  }

  const addItem = () => setForm(f => ({ ...f, items: [...f.items, { product_id: '', quantity: 1, unit_cost: 0 }] }))
  const removeItem = (i: number) => setForm(f => ({ ...f, items: f.items.filter((_, n) => n !== i) }))

  const totalAmount = form.items.reduce((s, i) => s + i.quantity * i.unit_cost, 0)

  const save = async () => {
    if (!form.supplier_id) { toast.error('Select a supplier'); return }
    if (form.items.some(i => !i.product_id)) { toast.error('All items need a product'); return }
    setSaving(true)
    const res = await window.api.purchases.create(form)
    setSaving(false)
    if (res.success) {
      toast.success(`PO ${(res.data as Record<string, unknown>).po_number} created`)
      onDone()
    } else {
      toast.error(String(res.error))
    }
  }

  return (
    <Modal title="New Purchase Order" onClose={onClose}>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Supplier *</label>
            <select className="input" value={form.supplier_id} onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}>
              <option value="">Select supplier...</option>
              {suppliers.map(s => <option key={String(s.id)} value={String(s.id)}>{String(s.name)}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Expected Delivery Date</label>
            <input type="date" className="input" value={form.expected_date}
              onChange={e => setForm(f => ({ ...f, expected_date: e.target.value }))} />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input resize-none h-16 text-sm" value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} placeholder="Optional notes..." />
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold">Items</p>
            <button className="btn-ghost btn-sm gap-1" onClick={addItem}><Plus size={12}/>Add Item</button>
          </div>

          {/* Column headers */}
          <div className="grid gap-2 mb-1 px-1" style={{ gridTemplateColumns: '1fr 72px 110px 80px 20px' }}>
            {['Product', 'Qty', 'Unit Cost', 'Total', ''].map((h, i) => (
              <p key={h} className={`text-xs font-medium${i === 0 ? ' min-w-0 truncate' : ''}`} style={{ color: 'var(--text-3)' }}>{h}</p>
            ))}
          </div>

          <div className="space-y-1.5">
            {form.items.map((item, idx) => (
              <div key={idx} className="grid gap-2 items-center rounded-lg px-1 py-1.5"
                style={{ gridTemplateColumns: '1fr 72px 110px 80px 20px', background: 'var(--bg-soft)', minWidth: 0 }}>
                <ProductSearchSelect
                  products={products}
                  value={item.product_id}
                  onChange={id => setItem(idx, 'product_id', id)}
                />
                <input
                  type="number" min={1}
                  className="input text-sm py-1.5 text-center"
                  value={item.quantity}
                  onChange={e => setItem(idx, 'quantity', parseInt(e.target.value) || 1)}
                />
                <input
                  type="number" min={0}
                  className="input text-sm py-1.5"
                  value={item.unit_cost}
                  onChange={e => setItem(idx, 'unit_cost', parseFloat(e.target.value) || 0)}
                />
                <p className="text-sm font-semibold text-right pr-1">
                  Rs.{(item.quantity * item.unit_cost).toLocaleString()}
                </p>
                <div className="flex justify-center">
                  {form.items.length > 1 && (
                    <button className="text-red-400 hover:text-red-300" onClick={() => removeItem(idx)}>
                      <XCircle size={14}/>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-end mt-2 text-sm font-bold">
            Total: Rs.{totalAmount.toLocaleString()}
          </div>
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-slate-700">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary gap-1" onClick={save} disabled={saving}>
            {saving ? 'Creating...' : 'Create Purchase Order'}
          </button>
        </div>
      </div>
    </Modal>
  )
}
