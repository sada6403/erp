import { useState, useEffect, useCallback } from 'react'
import { Search, Eye, Printer, RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import InvoiceDetailModal from '@/components/shared/InvoiceDetailModal'
import { buildInvoicePrintPayload, type InvoiceDetail } from '@/lib/invoicePrint'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const PAGE_SIZE = 50

const STATUS_COLORS: Record<string, string> = {
  completed: 'bg-green-500/10 text-green-400',
  cancelled: 'bg-red-500/10 text-red-400',
  returned: 'bg-orange-500/10 text-orange-400',
}

export default function BillsPage() {
  const { user } = useAuthStore()
  const isAdmin = Boolean((user?.role?.permissions as Record<string, boolean>)?.all)

  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [branchId, setBranchId] = useState('')
  const [branches, setBranches] = useState<Row[]>([])
  const [page, setPage] = useState(0)
  const [total, setTotal] = useState(0)
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [rowPrintingId, setRowPrintingId] = useState<string | null>(null)

  // Branch filtering is admin-only — non-admins are already auto-scoped to
  // their own branch server-side, so there's nothing for them to pick.
  useEffect(() => {
    if (!isAdmin) return
    window.api.admin.branches.list().then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setBranches(res.data || [])
      else toast.error(res.error || 'Failed to load branches')
    }).catch((err: Error) => toast.error(err.message || 'Failed to load branches'))
  }, [isAdmin])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.reports.transactions({
        status: 'completed',
        search: search.trim() || undefined,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        branchId: (isAdmin && branchId) || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      })
      if (res.success) {
        setRows(res.data as Row[])
        setTotal((res.total as number) ?? (res.data as Row[]).length)
      } else {
        toast.error(res.error || 'Failed to load bills')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load bills')
    } finally {
      setLoading(false)
    }
  }, [search, dateFrom, dateTo, branchId, isAdmin, page])

  useEffect(() => { load() }, [load])

  const quickPrint = async (id: string) => {
    setRowPrintingId(id)
    try {
      const res = await window.api.reports.transactionDetail(id)
      if (!res.success) { toast.error(res.error || 'Failed to load bill'); return }
      const printRes = await window.api.printer.printInvoice(buildInvoicePrintPayload(res.data as InvoiceDetail))
      if (printRes.success) toast.success('Sent to printer')
      else toast.error(printRes.error || 'Failed to print')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to print')
    } finally {
      setRowPrintingId(null)
    }
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Bills" subtitle={`${total.toLocaleString()} completed bill(s)`}
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary btn-sm gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => { setPage(0); setSearch(e.target.value) }}
            placeholder="Search by bill number or customer..." className="input pl-8 text-sm" />
        </div>
        {isAdmin && (
          <select value={branchId} onChange={e => { setPage(0); setBranchId(e.target.value) }} className="input text-sm w-auto">
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">From</span>
          <input type="date" value={dateFrom} onChange={e => { setPage(0); setDateFrom(e.target.value) }} className="input text-sm" />
          <span className="text-slate-500">To</span>
          <input type="date" value={dateTo} onChange={e => { setPage(0); setDateTo(e.target.value) }} className="input text-sm" />
          {(dateFrom || dateTo) && (
            <button onClick={() => { setPage(0); setDateFrom(''); setDateTo('') }} className="btn-ghost btn-sm">Clear</button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Bill #', 'Date', 'Customer', 'Branch', 'Total', 'Payment', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">No bills found</td></tr>
            ) : rows.map(r => (
              <tr key={r.id as string} className="table-row group cursor-pointer" onClick={() => setViewingId(r.id as string)}>
                <td className="table-cell font-mono text-xs text-amber-400">{r.invoice_number as string}</td>
                <td className="table-cell text-xs text-slate-400 whitespace-nowrap">{new Date(r.created_at as string).toLocaleString()}</td>
                <td className="table-cell">
                  {r.customer_name ? (
                    <div>
                      <p className="text-sm">{r.customer_name as string}</p>
                      {Boolean(r.customer_phone) && <p className="text-xs text-slate-500">{r.customer_phone as string}</p>}
                    </div>
                  ) : <span className="text-xs text-slate-500">Walk-in</span>}
                </td>
                <td className="table-cell text-slate-400 text-sm">{(r.branch_name as string) || '—'}</td>
                <td className="table-cell font-semibold">Rs.{Number(r.total_amount).toLocaleString()}</td>
                <td className="table-cell text-xs text-slate-400">{(r.payment_methods as string) || '—'}</td>
                <td className="table-cell">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status as string] || 'bg-slate-500/10 text-slate-400'}`}>
                    {r.status as string}
                  </span>
                </td>
                <td className="table-cell">
                  <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                    <button onClick={e => { e.stopPropagation(); setViewingId(r.id as string) }}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-600 hover:bg-surface-500 text-slate-300 text-xs">
                      <Eye className="w-3 h-3" /> View
                    </button>
                    <button onClick={e => { e.stopPropagation(); quickPrint(r.id as string) }}
                      disabled={rowPrintingId === r.id}
                      className="flex items-center gap-1 px-2 py-1 rounded bg-surface-600 hover:bg-surface-500 text-slate-300 text-xs disabled:opacity-50">
                      <Printer className="w-3 h-3" /> {rowPrintingId === r.id ? '…' : 'Print'}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-surface-700 flex items-center justify-between text-sm flex-shrink-0">
          <span className="text-slate-400">
            Showing {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, total)} of {total.toLocaleString()}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setPage(p => p - 1)} disabled={page === 0}
              className="p-1.5 rounded hover:bg-surface-700 disabled:opacity-30 text-slate-300">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="text-slate-300 min-w-[80px] text-center">Page {page + 1} / {totalPages}</span>
            <button onClick={() => setPage(p => p + 1)} disabled={page >= totalPages - 1}
              className="p-1.5 rounded hover:bg-surface-700 disabled:opacity-30 text-slate-300">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {viewingId && (
        <InvoiceDetailModal invoiceId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  )
}
