import { useEffect, useState } from 'react'
import { CheckCircle, Plus, RefreshCw, Search, XCircle } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

type Invoice = Record<string, unknown>

function statusBadge(status: string, approved: unknown): JSX.Element {
  if (status === 'cancelled') return <span className="badge-red">Cancelled</span>
  if (status === 'CREDIT' && !approved) return <span className="badge-yellow">Pending Approval</span>
  if (status === 'CREDIT' && approved) return <span className="badge-green">Approved</span>
  if (status === 'paid')    return <span className="badge-green">Paid</span>
  return <span className="badge-blue">{status}</span>
}

export default function CreditBillsPage() {
  const [bills, setBills]     = useState<Invoice[]>([])
  const [search, setSearch]   = useState('')
  const [tab, setTab]         = useState<'all' | 'pending' | 'approved'>('all')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Invoice | null>(null)
  const [showPayment, setShowPayment] = useState(false)
  const [payAmount, setPayAmount]     = useState('')
  const [payMethod, setPayMethod]     = useState('cash')
  const [payNote, setPayNote]         = useState('')

  const load = async () => {
    setLoading(true)
    const res = await window.api.invoices.list({ bill_type: 'CREDIT' })
    if (res.success) setBills(res.data as Invoice[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleApprove = async (invoice: Invoice) => {
    const res = await window.api.invoices.approveCreditBill(String(invoice.id))
    if (res.success) {
      toast.success(`Credit bill ${invoice.invoice_number} approved`)
      load()
    } else {
      toast.error(String(res.error))
    }
  }

  const handleCancel = async (invoice: Invoice) => {
    if (!confirm(`Cancel credit bill ${invoice.invoice_number}? Stock will be restored.`)) return
    const res = await window.api.invoices.cancel(String(invoice.id))
    if (res.success) { toast.success('Credit bill cancelled'); load() }
    else toast.error(String(res.error))
  }

  const openPayment = (invoice: Invoice) => {
    setSelected(invoice)
    setPayAmount('')
    setPayMethod('cash')
    setPayNote('')
    setShowPayment(true)
  }

  const savePayment = async () => {
    if (!selected) return
    const amount = parseFloat(payAmount)
    if (!amount || amount <= 0) { toast.error('Enter a valid amount'); return }
    const res = await window.api.invoices.addCreditPayment(String(selected.id), {
      amount, payment_method: payMethod, notes: payNote
    })
    if (res.success) {
      toast.success('Payment recorded')
      setShowPayment(false)
      load()
    } else {
      toast.error(String(res.error))
    }
  }

  const filtered = bills.filter(b => {
    if (tab === 'pending' && b.approved_by) return false
    if (tab === 'approved' && !b.approved_by) return false
    const s = search.toLowerCase()
    return !s || String(b.invoice_number).toLowerCase().includes(s)
      || String(b.customer_name || '').toLowerCase().includes(s)
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Credit Bills"
        subtitle={`${bills.length} credit transactions`}
        actions={
          <button className="btn-ghost btn-sm gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="flex items-center gap-4 px-6 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2">
          {(['all', 'pending', 'approved'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-1.5 rounded-lg text-xs capitalize font-medium transition-colors
                ${tab === t ? 'bg-brand-600 text-white' : 'btn-secondary'}`}>
              {t === 'pending' ? 'Pending Approval' : t === 'approved' ? 'Approved' : 'All'}
            </button>
          ))}
        </div>
        <div className="relative max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9 text-sm"
            placeholder="Search by number or customer..."
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900">
            <tr>
              {['Bill #', 'Customer', 'Total', 'Due Date', 'Outstanding', 'Status', ''].map(h =>
                <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map(b => (
              <tr className="table-row" key={String(b.id)}>
                <td className="table-cell font-mono text-xs text-rose-400">{String(b.invoice_number)}</td>
                <td className="table-cell">
                  <p className="font-medium">{String(b.customer_name || '—')}</p>
                  <p className="text-xs text-slate-500">{String(b.customer_phone || '')}</p>
                </td>
                <td className="table-cell font-semibold">
                  Rs.{Number(b.total_amount || 0).toLocaleString()}
                </td>
                <td className="table-cell text-sm text-slate-400">
                  {b.due_date ? new Date(String(b.due_date)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell">
                  <span className={Number(b.outstanding_due || 0) > 0 ? 'text-red-400 font-semibold' : 'text-green-400'}>
                    Rs.{Number(b.outstanding_due || 0).toLocaleString()}
                  </span>
                </td>
                <td className="table-cell">{statusBadge(String(b.status), b.approved_by)}</td>
                <td className="table-cell">
                  <div className="flex gap-2">
                    {b.status === 'CREDIT' && !b.approved_by && (
                      <button className="btn-primary btn-sm gap-1" onClick={() => handleApprove(b)}>
                        <CheckCircle size={12} /> Approve
                      </button>
                    )}
                    {b.status === 'CREDIT' && Boolean(b.approved_by) && Number(b.outstanding_due || 0) > 0 && (
                      <button className="btn-secondary btn-sm gap-1" onClick={() => openPayment(b)}>
                        <Plus size={12} /> Payment
                      </button>
                    )}
                    {b.status === 'CREDIT' && !b.approved_by && (
                      <button className="btn-ghost btn-sm text-red-400 gap-1" onClick={() => handleCancel(b)}>
                        <XCircle size={12} /> Cancel
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-16 text-slate-500">No credit bills found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {showPayment && selected && (
        <Modal title={`Record Payment — ${selected.invoice_number}`} onClose={() => setShowPayment(false)}>
          <div className="space-y-4 p-1">
            <div>
              <p className="text-sm mb-1" style={{ color: 'var(--text-3)' }}>Outstanding Balance</p>
              <p className="text-2xl font-bold text-red-400">
                Rs.{Number(selected.outstanding_due || 0).toLocaleString()}
              </p>
            </div>
            <div>
              <label className="label">Payment Amount (Rs.)</label>
              <input
                type="number"
                className="input"
                placeholder="0.00"
                value={payAmount}
                onChange={e => setPayAmount(e.target.value)}
                autoFocus
              />
            </div>
            <div>
              <label className="label">Payment Method</label>
              <select className="input" value={payMethod} onChange={e => setPayMethod(e.target.value)}>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
              </select>
            </div>
            <div>
              <label className="label">Notes (optional)</label>
              <input className="input" placeholder="e.g. cheque no. 123456" value={payNote} onChange={e => setPayNote(e.target.value)} />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button className="btn-ghost" onClick={() => setShowPayment(false)}>Cancel</button>
              <button className="btn-primary" onClick={savePayment}>Record Payment</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
