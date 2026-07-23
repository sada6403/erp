import { useState, useEffect, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Search, RotateCcw, Eye, XCircle, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Return = {
  id: string; invoice_id: string; customer_id: string | null
  return_date: string; reason: string; total_refund: number
  refund_method: string; notes: string | null; created_by: string
  status: string; created_at: string
  invoice_number?: string; customer_name?: string; created_by_name?: string
}

type InvoiceItem = {
  id: string; product_id: string; product_name: string; sku: string
  quantity: number; unit_price: number; max_return: number
  return_qty: number
}

type Invoice = {
  id: string; invoice_number: string; total_amount: number
  customer_name?: string; bill_date: string; status: string
}

const REFUND_METHODS = ['cash', 'bank_transfer', 'credit_note', 'exchange']

const fmt = (n: number) => `Rs. ${Number(n).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`

export default function ReturnsPage() {
  const { user } = useAuthStore()
  const [returns, setReturns]     = useState<Return[]>([])
  const [loading, setLoading]     = useState(false)
  const [fromDate, setFromDate]   = useState('')
  const [toDate, setToDate]       = useState('')
  const [statusF, setStatusF]     = useState('')

  // New return flow
  const [showNew, setShowNew]         = useState(false)
  const [invoiceSearch, setInvoiceSearch] = useState('')
  const [searchResults, setSearchResults] = useState<Invoice[]>([])
  const [searching, setSearching]     = useState(false)
  const [selectedInvoice, setSelectedInvoice] = useState<Invoice | null>(null)
  const [invoiceItems, setInvoiceItems] = useState<InvoiceItem[]>([])
  const [reason, setReason]       = useState('')
  const [refundMethod, setRefundMethod] = useState('cash')
  const [notes, setNotes]         = useState('')
  const [saving, setSaving]       = useState(false)
  const searchTimer = useRef<ReturnType<typeof setTimeout>>()

  // View detail
  const [viewReturn, setViewReturn] = useState<(Return & { items?: unknown[] }) | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.returns.list({ from_date: fromDate || undefined, to_date: toDate || undefined, status: statusF || undefined })
      if (res.success) setReturns(res.data as Return[])
      else toast.error(res.error || 'Failed to load returns')
    } catch (err) {
      toast.error('Failed to load returns: ' + String(err))
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [fromDate, toDate, statusF])

  const searchInvoices = async (q: string) => {
    if (!q.trim()) { setSearchResults([]); return }
    setSearching(true)
    try {
      const res = await window.api.invoices.list({ search: q, limit: 10 })
      if (res.success) setSearchResults((res.data as Invoice[]).slice(0, 10))
      else toast.error(res.error || 'Failed to search invoices')
    } catch (err) {
      toast.error('Failed to search invoices: ' + String(err))
    } finally { setSearching(false) }
  }

  const handleInvoiceSearchChange = (val: string) => {
    setInvoiceSearch(val)
    clearTimeout(searchTimer.current)
    searchTimer.current = setTimeout(() => searchInvoices(val), 350)
  }

  const selectInvoice = async (inv: Invoice) => {
    setSelectedInvoice(inv)
    setSearchResults([])
    setInvoiceSearch(inv.invoice_number)
    try {
      const res = await window.api.returns.getInvoiceItems(inv.id)
      if (res.success) {
        const d = res.data as { items: InvoiceItem[] }
        setInvoiceItems(d.items.map(it => ({ ...it, return_qty: 0 })))
      } else {
        toast.error(res.error || 'Failed to load invoice items')
      }
    } catch (err) {
      toast.error('Failed to load invoice items: ' + String(err))
    }
  }

  const changeQty = (idx: number, val: string) => {
    const num = Math.max(0, Math.min(invoiceItems[idx].max_return, Number(val) || 0))
    setInvoiceItems(items => items.map((it, i) => i === idx ? { ...it, return_qty: num } : it))
  }

  const refundTotal = invoiceItems.reduce((s, it) => s + it.return_qty * it.unit_price, 0)
  const hasItems    = invoiceItems.some(it => it.return_qty > 0)

  const submitReturn = async () => {
    if (!selectedInvoice) { toast.error('Select an invoice'); return }
    if (!hasItems) { toast.error('Select at least one item to return'); return }
    if (!reason.trim()) { toast.error('Please enter a reason'); return }
    setSaving(true)
    try {
      const items = invoiceItems.filter(it => it.return_qty > 0).map(it => ({
        product_id: it.product_id, invoice_item_id: it.id,
        quantity: it.return_qty, unit_price: it.unit_price
      }))
      const res = await window.api.returns.create({
        invoice_id: selectedInvoice.id,
        customer_id: selectedInvoice.customer_name ? undefined : undefined,
        reason, refund_method: refundMethod, notes: notes || undefined,
        created_by: user?.id || '',
        items
      })
      if (res.success) {
        toast.success(`Return processed — Refund: ${fmt(refundTotal)}`)
        setShowNew(false)
        resetForm()
        load()
      } else toast.error(res.error || 'Failed to process return')
    } catch (err) {
      toast.error('Failed to process return: ' + String(err))
    } finally { setSaving(false) }
  }

  const cancelReturn = async (ret: Return) => {
    if (!confirm('Cancel this return? Stock will NOT be re-adjusted.')) return
    try {
      const res = await window.api.returns.cancel(ret.id)
      if (res.success) { toast.success('Return cancelled'); load() }
      else toast.error(res.error || 'Failed to cancel')
    } catch (err) {
      toast.error('Failed to cancel return: ' + String(err))
    }
  }

  const viewDetail = async (ret: Return) => {
    try {
      const res = await window.api.returns.get(ret.id)
      if (res.success) setViewReturn(res.data as Return & { items: unknown[] })
      else toast.error(res.error || 'Failed to load return details')
    } catch (err) {
      toast.error('Failed to load return details: ' + String(err))
    }
  }

  const resetForm = () => {
    setInvoiceSearch('')
    setSelectedInvoice(null)
    setInvoiceItems([])
    setReason('')
    setRefundMethod('cash')
    setNotes('')
  }

  const openNew = () => { resetForm(); setShowNew(true) }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Returns & Refunds"
        subtitle={`${returns.length} returns`}
        actions={
          <button onClick={openNew} className="btn-primary btn-sm gap-1.5">
            <RotateCcw size={14} /> New Return
          </button>
        }
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b" style={{ borderColor: 'var(--border)', background: 'var(--bg-page)' }}>
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>From</label>
          <input type="date" className="input py-1 text-xs" value={fromDate} onChange={e => setFromDate(e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs" style={{ color: 'var(--text-3)' }}>To</label>
          <input type="date" className="input py-1 text-xs" value={toDate} onChange={e => setToDate(e.target.value)} />
        </div>
        <select className="input py-1 text-xs" value={statusF} onChange={e => setStatusF(e.target.value)}>
          <option value="">All Statuses</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn-secondary btn-sm" onClick={() => { setFromDate(''); setToDate(''); setStatusF('') }}>Clear</button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="table-header">
              <th className="text-left px-4 py-3">Return #</th>
              <th className="text-left px-4 py-3">Invoice</th>
              <th className="text-left px-4 py-3">Customer</th>
              <th className="text-left px-4 py-3">Reason</th>
              <th className="text-left px-4 py-3">Method</th>
              <th className="text-right px-4 py-3">Refund</th>
              <th className="text-left px-4 py-3">Date</th>
              <th className="text-left px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {loading
              ? <tr><td colSpan={9} className="text-center py-12" style={{ color: 'var(--text-3)' }}>Loading…</td></tr>
              : returns.length === 0
                ? <tr><td colSpan={9} className="text-center py-12" style={{ color: 'var(--text-3)' }}>No returns found</td></tr>
                : returns.map((r, i) => (
                    <tr key={r.id} className="border-t" style={{ borderColor: 'var(--border)', background: i % 2 === 1 ? 'var(--bg-soft)' : undefined }}>
                      <td className="px-4 py-3 font-mono text-xs" style={{ color: 'var(--text-1)' }}>{r.id.slice(0, 8).toUpperCase()}</td>
                      <td className="px-4 py-3 font-semibold text-xs" style={{ color: 'var(--text-1)' }}>{r.invoice_number || '—'}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-2)' }}>{r.customer_name || '—'}</td>
                      <td className="px-4 py-3 text-xs max-w-[160px] truncate" style={{ color: 'var(--text-2)' }}>{r.reason}</td>
                      <td className="px-4 py-3">
                        <span className="badge-secondary text-xs capitalize">{r.refund_method.replace('_', ' ')}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-semibold text-sm text-green-600">{fmt(r.total_refund)}</td>
                      <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-3)' }}>{r.return_date?.slice(0, 10)}</td>
                      <td className="px-4 py-3">
                        <span className={`badge text-xs ${r.status === 'completed' ? 'badge-success' : 'badge-secondary'}`}>
                          {r.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1">
                          <button onClick={() => viewDetail(r)} className="btn-ghost btn-sm p-1.5" title="View details">
                            <Eye size={13} />
                          </button>
                          {r.status === 'completed' && (
                            <button onClick={() => cancelReturn(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-500" title="Cancel return">
                              <XCircle size={13} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
            }
          </tbody>
        </table>
      </div>

      {/* New Return Modal */}
      {showNew && (
        <Modal
          title="Process Return / Refund"
          onClose={() => setShowNew(false)}
          size="xl"
          footer={
            <>
              <button onClick={() => setShowNew(false)} className="btn-secondary">Cancel</button>
              <button onClick={submitReturn} disabled={saving || !hasItems} className="btn-primary gap-1.5">
                <RotateCcw size={14} />
                {saving ? 'Processing…' : `Process Return — ${fmt(refundTotal)}`}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            {/* Invoice search */}
            <div>
              <label className="label">Search Invoice *</label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input
                  className="input pl-8"
                  value={invoiceSearch}
                  onChange={e => handleInvoiceSearchChange(e.target.value)}
                  placeholder="Invoice number or customer name…"
                />
              </div>
              {searching && <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Searching…</p>}
              {searchResults.length > 0 && (
                <div className="mt-1 border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  {searchResults.map(inv => (
                    <button
                      key={inv.id}
                      onClick={() => selectInvoice(inv)}
                      className="w-full flex items-center justify-between px-3 py-2 text-sm hover:bg-[var(--bg-soft)] text-left border-b last:border-b-0"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{inv.invoice_number}</span>
                      <span style={{ color: 'var(--text-3)' }} className="text-xs">{inv.customer_name} · {fmt(inv.total_amount)}</span>
                    </button>
                  ))}
                </div>
              )}
              {selectedInvoice && (
                <div className="mt-2 px-3 py-2 rounded-lg border text-sm" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{selectedInvoice.invoice_number}</span>
                  <span className="ml-2" style={{ color: 'var(--text-3)' }}>{selectedInvoice.customer_name || 'Walk-in'} · {fmt(selectedInvoice.total_amount)}</span>
                </div>
              )}
            </div>

            {/* Items */}
            {invoiceItems.length > 0 && (
              <div>
                <label className="label">Select Items to Return</label>
                <div className="border rounded-lg overflow-hidden" style={{ borderColor: 'var(--border)' }}>
                  <table className="w-full text-sm">
                    <thead>
                      <tr style={{ background: 'var(--bg-soft)' }}>
                        <th className="text-left px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Product</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Unit Price</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Max Ret.</th>
                        <th className="text-center px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Return Qty</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Refund</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoiceItems.map((it, idx) => (
                        <tr key={it.id} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <Package size={13} style={{ color: 'var(--text-3)' }} />
                              <div>
                                <p className="font-medium text-xs" style={{ color: 'var(--text-1)' }}>{it.product_name}</p>
                                <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>{it.sku}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-3 py-2 text-right text-xs" style={{ color: 'var(--text-2)' }}>{fmt(it.unit_price)}</td>
                          <td className="px-3 py-2 text-right text-xs" style={{ color: it.max_return > 0 ? 'var(--text-2)' : 'var(--text-3)' }}>{it.max_return}</td>
                          <td className="px-3 py-2">
                            <input
                              type="number" min={0} max={it.max_return}
                              value={it.return_qty || ''}
                              onChange={e => changeQty(idx, e.target.value)}
                              disabled={it.max_return === 0}
                              className="input text-center py-1 text-xs w-20 mx-auto block"
                              placeholder="0"
                            />
                          </td>
                          <td className="px-3 py-2 text-right text-xs font-semibold text-green-600">
                            {it.return_qty > 0 ? fmt(it.return_qty * it.unit_price) : '—'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr style={{ background: 'var(--bg-soft)', borderTop: '2px solid var(--border)' }}>
                        <td colSpan={4} className="px-3 py-2 text-xs font-semibold text-right" style={{ color: 'var(--text-2)' }}>Total Refund</td>
                        <td className="px-3 py-2 text-right font-bold text-green-600">{fmt(refundTotal)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                {invoiceItems.every(it => it.max_return === 0) ? (
                  <p className="text-xs mt-1.5 text-amber-500">All items on this invoice have already been fully returned.</p>
                ) : refundTotal === 0 ? (
                  <p className="text-xs mt-1.5" style={{ color: 'var(--text-3)' }}>Enter a return quantity for each item to include it in this refund.</p>
                ) : null}
              </div>
            )}

            {selectedInvoice && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label">Reason *</label>
                  <textarea
                    className="input resize-none"
                    rows={3}
                    value={reason}
                    onChange={e => setReason(e.target.value)}
                    placeholder="e.g. Defective item, Wrong product, Customer changed mind"
                  />
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="label">Refund Method</label>
                    <select className="input" value={refundMethod} onChange={e => setRefundMethod(e.target.value)}>
                      {REFUND_METHODS.map(m => (
                        <option key={m} value={m}>{m.replace('_', ' ').replace(/\b\w/g, c => c.toUpperCase())}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Notes</label>
                    <input className="input" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional notes" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* View Detail Modal */}
      {viewReturn && (
        <Modal
          title={`Return Details — ${viewReturn.invoice_number || ''}`}
          onClose={() => setViewReturn(null)}
          size="lg"
          footer={<button onClick={() => setViewReturn(null)} className="btn-secondary">Close</button>}
        >
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              {[
                ['Invoice', viewReturn.invoice_number],
                ['Customer', viewReturn.customer_name || 'Walk-in'],
                ['Date', viewReturn.return_date?.slice(0, 10)],
                ['Processed By', viewReturn.created_by_name],
                ['Refund Method', viewReturn.refund_method?.replace('_', ' ')],
                ['Status', viewReturn.status],
              ].map(([k, v]) => (
                <div key={k}>
                  <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>{k}</p>
                  <p className="font-medium" style={{ color: 'var(--text-1)' }}>{v}</p>
                </div>
              ))}
            </div>
            <div>
              <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Reason</p>
              <p className="text-sm" style={{ color: 'var(--text-1)' }}>{viewReturn.reason}</p>
            </div>
            {viewReturn.notes && (
              <div>
                <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Notes</p>
                <p className="text-sm" style={{ color: 'var(--text-2)' }}>{viewReturn.notes}</p>
              </div>
            )}
            <div className="pt-2 border-t font-semibold text-lg text-green-600" style={{ borderColor: 'var(--border)' }}>
              Total Refund: {fmt(viewReturn.total_refund)}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
