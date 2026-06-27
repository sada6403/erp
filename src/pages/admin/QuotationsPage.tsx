import { useEffect, useState } from 'react'
import { FileText, RefreshCw, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import toast from 'react-hot-toast'

function statusBadge(status: string) {
  if (status === 'QUOTATION') return <span className="badge-yellow">Quotation</span>
  if (status === 'converted') return <span className="badge-green">Converted</span>
  if (status === 'cancelled') return <span className="badge-red">Cancelled</span>
  return <span className="badge-blue">{status}</span>
}

export default function QuotationsPage() {
  const [quotes, setQuotes]   = useState<Record<string, unknown>[]>([])
  const [search, setSearch]   = useState('')
  const [loading, setLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    const res = await window.api.invoices.list({ bill_type: 'QUOTATION' })
    if (res.success) setQuotes(res.data as Record<string, unknown>[])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const handleConvert = async (id: string, invNum: string) => {
    if (!confirm(`Convert quotation ${invNum} to a retail invoice? Stock will be deducted.`)) return
    const res = await window.api.invoices.convert(id)
    if (res.success) {
      toast.success(`Quotation converted — Invoice ${(res.data as Record<string, unknown>).invoice_number}`)
      load()
    } else {
      toast.error(String(res.error))
    }
  }

  const handleCancel = async (id: string) => {
    if (!confirm('Cancel this quotation?')) return
    const res = await window.api.invoices.cancel(id)
    if (res.success) { toast.success('Quotation cancelled'); load() }
    else toast.error(String(res.error))
  }

  const visible = quotes.filter(q => {
    const s = search.toLowerCase()
    return !s || String(q.invoice_number).toLowerCase().includes(s)
      || String(q.customer_name || '').toLowerCase().includes(s)
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Quotations"
        subtitle={`${quotes.length} quotations`}
        actions={
          <button className="btn-ghost btn-sm gap-1.5" onClick={load} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="px-6 py-3 border-b border-slate-800">
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
              {['Quote #', 'Customer', 'Branch', 'Items', 'Total', 'Valid Until', 'Created', 'Status', ''].map(h =>
                <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {visible.map(q => (
              <tr className="table-row" key={String(q.id)}>
                <td className="table-cell font-mono text-xs text-amber-400">{String(q.invoice_number)}</td>
                <td className="table-cell">
                  <p className="font-medium">{String(q.customer_name || 'Walk-in')}</p>
                  <p className="text-xs text-slate-500">{String(q.customer_phone || '')}</p>
                </td>
                <td className="table-cell text-slate-400 text-sm">{String(q.branch_name || '—')}</td>
                <td className="table-cell text-center">{String(q.item_count ?? '—')}</td>
                <td className="table-cell font-semibold">
                  Rs.{Number(q.total_amount || 0).toLocaleString()}
                </td>
                <td className="table-cell text-sm text-slate-400">
                  {q.valid_until
                    ? new Date(String(q.valid_until)).toLocaleDateString()
                    : '—'}
                </td>
                <td className="table-cell text-xs text-slate-500">
                  {q.created_at ? new Date(String(q.created_at)).toLocaleDateString() : '—'}
                </td>
                <td className="table-cell">{statusBadge(String(q.status))}</td>
                <td className="table-cell">
                  {q.status === 'QUOTATION' && (
                    <div className="flex gap-2">
                      <button
                        className="btn-primary btn-sm gap-1"
                        onClick={() => handleConvert(String(q.id), String(q.invoice_number))}
                      >
                        <FileText size={12} /> Convert
                      </button>
                      <button
                        className="btn-ghost btn-sm text-red-400"
                        onClick={() => handleCancel(String(q.id))}
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {visible.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-16 text-slate-500">No quotations found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
