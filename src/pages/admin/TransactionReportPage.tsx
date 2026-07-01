import { useState, useEffect, useCallback, useRef } from 'react'
import { Search, Filter, Download, FileText, Eye, RefreshCw, X, ChevronLeft, ChevronRight } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

interface TxRow {
  id: string
  invoice_number: string
  status: string
  bill_type: string
  branch_name: string
  customer_name: string | null
  customer_phone: string | null
  cashier_name: string
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  due_amount: number
  payment_methods: string
  notes: string | null
  created_at: string
  updated_at: string
}

interface TxDetail {
  id: string
  invoice_number: string
  status: string
  bill_type: string
  branch_name: string
  customer_name: string | null
  customer_phone: string | null
  cashier_name: string
  subtotal: number
  discount_amount: number
  tax_amount: number
  total_amount: number
  paid_amount: number
  due_amount: number
  notes: string | null
  created_at: string
  items: Array<{
    id: string
    product_name: string
    sku: string
    barcode: string
    unit: string
    quantity: number
    unit_price: number
    discount: number
    tax: number
    total: number
  }>
  payments: Array<{
    id: string
    method: string
    amount: number
    reference: string | null
    paid_at: string
  }>
}

interface Filters {
  search: string
  dateFrom: string
  dateTo: string
  branchId: string
  cashierId: string
  paymentMethod: string
  status: string
  billType: string
}

const PAGE_SIZE = 50

const fmt = (n: number) => n?.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? '0.00'
const fmtDate = (s: string) => s ? new Date(s).toLocaleString() : '-'

const STATUS_COLORS: Record<string, string> = {
  paid: 'bg-green-500/10 text-green-400 border border-green-500/20',
  partial: 'bg-yellow-500/10 text-yellow-400 border border-yellow-500/20',
  pending: 'bg-blue-500/10 text-blue-400 border border-blue-500/20',
  credit: 'bg-orange-500/10 text-orange-400 border border-orange-500/20',
  cancelled: 'bg-red-500/10 text-red-400 border border-red-500/20',
  returned: 'bg-purple-500/10 text-purple-400 border border-purple-500/20',
  held: 'bg-slate-500/10 text-slate-400 border border-slate-500/20',
}

export default function TransactionReportPage() {
  const [filters, setFilters] = useState<Filters>({
    search: '', dateFrom: '', dateTo: '', branchId: '', cashierId: '',
    paymentMethod: '', status: '', billType: '',
  })
  const [rows, setRows] = useState<TxRow[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<TxDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [branches, setBranches] = useState<Array<{ id: string; name: string }>>([])
  const [cashiers, setCashiers] = useState<Array<{ id: string; name: string }>>([])
  const [showFilters, setShowFilters] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  // Load branch / cashier dropdowns
  useEffect(() => {
    window.api?.admin.branches.list().then((r: { success: boolean; data: Array<{ id: string; name: string }> }) => {
      if (r?.success) setBranches(r.data)
    })
    window.api?.admin.users.list().then((r: { success: boolean; data: Array<{ id: string; name: string }> }) => {
      if (r?.success) setCashiers(r.data)
    })
  }, [])

  const load = useCallback(async (pg = page) => {
    setLoading(true)
    try {
      const res = await window.api?.reports.transactions({
        ...filters,
        search: filters.search || undefined,
        dateFrom: filters.dateFrom || undefined,
        dateTo: filters.dateTo || undefined,
        branchId: filters.branchId || undefined,
        cashierId: filters.cashierId || undefined,
        paymentMethod: filters.paymentMethod || undefined,
        status: filters.status || undefined,
        billType: filters.billType || undefined,
        limit: PAGE_SIZE,
        offset: pg * PAGE_SIZE,
      })
      if (res?.success) {
        setRows(res.data)
        setTotal(res.total)
      }
    } finally {
      setLoading(false)
    }
  }, [filters, page])

  useEffect(() => { load(page) }, [page]) // eslint-disable-line react-hooks/exhaustive-deps

  const applyFilters = () => { setPage(0); load(0) }

  const clearFilters = () => {
    const empty: Filters = { search: '', dateFrom: '', dateTo: '', branchId: '', cashierId: '', paymentMethod: '', status: '', billType: '' }
    setFilters(empty)
    setPage(0)
  }

  const openDetail = async (id: string) => {
    setDetailLoading(true)
    setDetail(null)
    const res = await window.api?.reports.transactionDetail(id)
    if (res?.success) setDetail(res.data)
    setDetailLoading(false)
  }

  const exportCsv = async () => {
    setExporting(true)
    await window.api?.reports.exportTransactionsCsv({
      ...filters,
      search: filters.search || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      branchId: filters.branchId || undefined,
      cashierId: filters.cashierId || undefined,
      status: filters.status || undefined,
    })
    setExporting(false)
  }

  const exportExcel = async () => {
    setExporting(true)
    const res = await window.api?.reports.transactions({
      ...filters,
      search: filters.search || undefined,
      dateFrom: filters.dateFrom || undefined,
      dateTo: filters.dateTo || undefined,
      limit: 50000,
      offset: 0,
    })
    if (res?.success) {
      const xlsRows = res.data.map((r: TxRow) => ({
        'Bill No': r.invoice_number,
        'Date & Time': fmtDate(r.created_at),
        'Type': r.bill_type,
        'Status': r.status,
        'Branch': r.branch_name ?? '',
        'Cashier': r.cashier_name ?? '',
        'Customer': r.customer_name ?? '',
        'Phone': r.customer_phone ?? '',
        'Payment Method': r.payment_methods ?? '',
        'Subtotal': r.subtotal,
        'Discount': r.discount_amount,
        'Tax': r.tax_amount,
        'Total': r.total_amount,
        'Paid': r.paid_amount,
        'Balance': r.due_amount,
      }))
      await window.api?.reports.exportExcel({
        filename: `transactions-${new Date().toISOString().slice(0, 10)}`,
        sheets: [{ name: 'Transactions', rows: xlsRows }],
      })
    }
    setExporting(false)
  }

  const exportPdf = async () => {
    setExporting(true)
    await window.api?.reports.exportPdf({ filename: `transactions-${new Date().toISOString().slice(0, 10)}` })
    setExporting(false)
  }

  const totalPages = Math.ceil(total / PAGE_SIZE)
  const activeFilterCount = Object.values(filters).filter(v => v !== '').length

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Transaction Report"
        subtitle={`${total.toLocaleString()} total transaction${total !== 1 ? 's' : ''}`}
      />

      {/* Toolbar */}
      <div className="px-6 py-3 flex flex-wrap gap-2 items-center border-b border-surface-700">
        {/* Search */}
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            ref={searchRef}
            value={filters.search}
            onChange={e => setFilters(p => ({ ...p, search: e.target.value }))}
            onKeyDown={e => e.key === 'Enter' && applyFilters()}
            placeholder="Bill no, customer, phone…"
            className="w-full pl-9 pr-3 py-2 bg-surface-800 border border-surface-600 rounded-lg text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-brand-500"
          />
        </div>

        {/* Quick date shortcuts */}
        <div className="flex gap-1">
          {[
            { label: 'Today', from: new Date().toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) },
            { label: 'This Week', from: (() => { const d = new Date(); d.setDate(d.getDate() - d.getDay()); return d.toISOString().slice(0,10) })(), to: new Date().toISOString().slice(0,10) },
            { label: 'This Month', from: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10), to: new Date().toISOString().slice(0,10) },
          ].map(s => (
            <button
              key={s.label}
              onClick={() => { setFilters(p => ({ ...p, dateFrom: s.from, dateTo: s.to })); setTimeout(applyFilters, 0) }}
              className="px-2 py-1 text-xs rounded bg-surface-700 hover:bg-surface-600 text-slate-300 whitespace-nowrap"
            >{s.label}</button>
          ))}
        </div>

        <button
          onClick={() => setShowFilters(p => !p)}
          className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-colors ${showFilters || activeFilterCount > 0 ? 'bg-brand-600 border-brand-500 text-white' : 'bg-surface-800 border-surface-600 text-slate-300 hover:border-brand-500'}`}
        >
          <Filter className="w-4 h-4" />
          Filters {activeFilterCount > 0 && <span className="bg-white/20 rounded-full px-1.5 text-xs">{activeFilterCount}</span>}
        </button>

        {activeFilterCount > 0 && (
          <button onClick={clearFilters} className="flex items-center gap-1 px-3 py-2 text-sm text-slate-400 hover:text-slate-200 rounded-lg hover:bg-surface-700">
            <X className="w-3.5 h-3.5" /> Clear
          </button>
        )}

        <button onClick={() => load(page)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-surface-800 border border-surface-600 text-slate-300 hover:border-brand-500">
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Export buttons */}
        <div className="flex gap-1 ml-auto">
          <button
            onClick={exportCsv}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-surface-800 border border-surface-600 text-slate-300 hover:border-green-500 hover:text-green-400 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> CSV
          </button>
          <button
            onClick={exportExcel}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-surface-800 border border-surface-600 text-slate-300 hover:border-green-500 hover:text-green-400 disabled:opacity-50"
          >
            <Download className="w-4 h-4" /> Excel
          </button>
          <button
            onClick={exportPdf}
            disabled={exporting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-surface-800 border border-surface-600 text-slate-300 hover:border-red-500 hover:text-red-400 disabled:opacity-50"
          >
            <FileText className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {/* Advanced Filters Panel */}
      {showFilters && (
        <div className="px-6 py-3 bg-surface-800/50 border-b border-surface-700 grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
          <div>
            <label className="block text-xs text-slate-400 mb-1">From Date</label>
            <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">To Date</label>
            <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500" />
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Branch</label>
            <select value={filters.branchId} onChange={e => setFilters(p => ({ ...p, branchId: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">All Branches</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Cashier</label>
            <select value={filters.cashierId} onChange={e => setFilters(p => ({ ...p, cashierId: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">All Cashiers</option>
              {cashiers.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Payment Method</label>
            <select value={filters.paymentMethod} onChange={e => setFilters(p => ({ ...p, paymentMethod: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">All Methods</option>
              {['CASH','CARD','BANK_TRANSFER','CHEQUE','ONLINE','CREDIT','LOYALTY','SPLIT'].map(m =>
                <option key={m} value={m}>{m.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Status</label>
            <select value={filters.status} onChange={e => setFilters(p => ({ ...p, status: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">All Statuses</option>
              {['paid','partial','pending','credit','cancelled','returned','held'].map(s =>
                <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs text-slate-400 mb-1">Bill Type</label>
            <select value={filters.billType} onChange={e => setFilters(p => ({ ...p, billType: e.target.value }))}
              className="w-full px-2 py-1.5 bg-surface-700 border border-surface-600 rounded text-sm text-slate-200 focus:outline-none focus:border-brand-500">
              <option value="">All Types</option>
              {['RETAIL','WHOLESALE','CREDIT','QUOTATION'].map(t =>
                <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <button onClick={applyFilters}
              className="w-full px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white rounded text-sm font-medium">
              Apply
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards */}
      {rows.length > 0 && (
        <div className="px-6 py-2 flex gap-4 text-xs border-b border-surface-700 bg-surface-800/30 flex-wrap">
          {[
            { label: 'Subtotal', value: rows.reduce((a, r) => a + (r.subtotal || 0), 0) },
            { label: 'Discount', value: rows.reduce((a, r) => a + (r.discount_amount || 0), 0) },
            { label: 'Tax', value: rows.reduce((a, r) => a + (r.tax_amount || 0), 0) },
            { label: 'Revenue (Page)', value: rows.reduce((a, r) => a + (r.total_amount || 0), 0) },
            { label: 'Collected', value: rows.reduce((a, r) => a + (r.paid_amount || 0), 0) },
            { label: 'Outstanding', value: rows.reduce((a, r) => a + (r.due_amount || 0), 0) },
          ].map(s => (
            <div key={s.label} className="flex gap-1.5 items-baseline">
              <span className="text-slate-500">{s.label}:</span>
              <span className={`font-semibold ${s.label === 'Outstanding' && s.value > 0 ? 'text-yellow-400' : 'text-slate-200'}`}>
                {fmt(s.value)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-slate-400">
            <RefreshCw className="w-6 h-6 animate-spin mr-2" /> Loading transactions…
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-slate-500">
            <FileText className="w-10 h-10 mb-3 opacity-30" />
            <p>No transactions found</p>
            {activeFilterCount > 0 && (
              <button onClick={clearFilters} className="mt-2 text-brand-400 hover:underline text-sm">Clear filters</button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm min-w-[1200px]">
            <thead className="sticky top-0 bg-surface-800 border-b border-surface-700 z-10">
              <tr>
                {['Bill No','Date & Time','Type','Branch','Cashier','Customer','Payment','Subtotal','Discount','Tax','Total','Paid','Balance','Status',''].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-medium text-slate-400 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-700/50">
              {rows.map(r => (
                <tr key={r.id} className="hover:bg-surface-700/30 transition-colors group">
                  <td className="px-3 py-2 font-mono text-brand-400 font-medium whitespace-nowrap">{r.invoice_number}</td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap text-xs">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-2 text-slate-400 text-xs">{r.bill_type || 'RETAIL'}</td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap max-w-[120px] truncate">{r.branch_name || '-'}</td>
                  <td className="px-3 py-2 text-slate-300 whitespace-nowrap">{r.cashier_name || '-'}</td>
                  <td className="px-3 py-2">
                    {r.customer_name ? (
                      <div>
                        <p className="text-slate-200 text-xs whitespace-nowrap">{r.customer_name}</p>
                        {r.customer_phone && <p className="text-slate-500 text-xs">{r.customer_phone}</p>}
                      </div>
                    ) : <span className="text-slate-500 text-xs">Walk-in</span>}
                  </td>
                  <td className="px-3 py-2 text-slate-300 text-xs whitespace-nowrap">{r.payment_methods || '-'}</td>
                  <td className="px-3 py-2 text-right text-slate-300 whitespace-nowrap">{fmt(r.subtotal)}</td>
                  <td className="px-3 py-2 text-right text-orange-400 whitespace-nowrap">{r.discount_amount > 0 ? `-${fmt(r.discount_amount)}` : '-'}</td>
                  <td className="px-3 py-2 text-right text-slate-400 whitespace-nowrap">{r.tax_amount > 0 ? fmt(r.tax_amount) : '-'}</td>
                  <td className="px-3 py-2 text-right font-semibold text-slate-100 whitespace-nowrap">{fmt(r.total_amount)}</td>
                  <td className="px-3 py-2 text-right text-green-400 whitespace-nowrap">{fmt(r.paid_amount)}</td>
                  <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${r.due_amount > 0 ? 'text-yellow-400' : 'text-slate-500'}`}>{r.due_amount > 0 ? fmt(r.due_amount) : '-'}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-slate-500/10 text-slate-400'}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => openDetail(r.id)}
                      className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 px-2 py-1 rounded bg-surface-600 hover:bg-surface-500 text-slate-300 text-xs"
                    >
                      <Eye className="w-3 h-3" /> View
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="px-6 py-3 border-t border-surface-700 flex items-center justify-between text-sm">
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

      {/* Detail Modal */}
      {(detail || detailLoading) && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={e => e.target === e.currentTarget && setDetail(null)}>
          <div className="bg-surface-800 rounded-xl border border-surface-600 w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-surface-700">
              <div>
                <h2 className="text-lg font-semibold text-slate-100">
                  {detailLoading ? 'Loading…' : detail?.invoice_number}
                </h2>
                {detail && (
                  <p className="text-xs text-slate-400 mt-0.5">{fmtDate(detail.created_at)} · {detail.branch_name} · {detail.cashier_name}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {detail && (
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[detail.status] || ''}`}>{detail.status}</span>
                )}
                <button onClick={() => setDetail(null)} className="p-1.5 rounded-lg hover:bg-surface-700 text-slate-400 hover:text-slate-200">
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {detailLoading ? (
              <div className="flex items-center justify-center h-48 text-slate-400">
                <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Loading…
              </div>
            ) : detail ? (
              <div className="overflow-y-auto flex-1 px-6 py-4 space-y-5">
                {/* Customer + Payment Summary */}
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="bg-surface-700/50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Customer</p>
                    <p className="text-slate-200 font-medium">{detail.customer_name || 'Walk-in Customer'}</p>
                    {detail.customer_phone && <p className="text-slate-400 text-xs mt-0.5">{detail.customer_phone}</p>}
                  </div>
                  <div className="bg-surface-700/50 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Payments</p>
                    <div className="space-y-1">
                      {detail.payments.map(p => (
                        <div key={p.id} className="flex justify-between text-xs">
                          <span className="text-slate-300">{p.method}{p.reference ? ` (${p.reference})` : ''}</span>
                          <span className="text-green-400 font-medium">{fmt(p.amount)}</span>
                        </div>
                      ))}
                      {detail.payments.length === 0 && <p className="text-slate-500 text-xs">No payment records</p>}
                    </div>
                  </div>
                </div>

                {/* Items Table */}
                <div>
                  <p className="text-xs font-medium text-slate-400 mb-2">Items ({detail.items.length})</p>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-surface-600">
                        {['Product','SKU','Qty','Unit Price','Discount','Tax','Total'].map(h => (
                          <th key={h} className="py-1 pr-3 text-left text-slate-500 font-medium">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-700/50">
                      {detail.items.map(item => (
                        <tr key={item.id}>
                          <td className="py-1.5 pr-3 text-slate-200">{item.product_name}</td>
                          <td className="py-1.5 pr-3 text-slate-400 font-mono">{item.sku || '-'}</td>
                          <td className="py-1.5 pr-3 text-slate-300">{item.quantity} {item.unit || ''}</td>
                          <td className="py-1.5 pr-3 text-slate-300">{fmt(item.unit_price)}</td>
                          <td className="py-1.5 pr-3 text-orange-400">{item.discount > 0 ? `-${fmt(item.discount)}` : '-'}</td>
                          <td className="py-1.5 pr-3 text-slate-400">{item.tax > 0 ? fmt(item.tax) : '-'}</td>
                          <td className="py-1.5 pr-3 text-slate-100 font-medium">{fmt(item.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Totals */}
                <div className="border-t border-surface-600 pt-3 space-y-1.5 text-sm">
                  {[
                    { label: 'Subtotal', value: detail.subtotal, cls: 'text-slate-300' },
                    { label: 'Discount', value: -detail.discount_amount, cls: 'text-orange-400' },
                    { label: 'Tax', value: detail.tax_amount, cls: 'text-slate-400' },
                    { label: 'Total', value: detail.total_amount, cls: 'text-slate-100 font-bold text-base' },
                    { label: 'Paid', value: detail.paid_amount, cls: 'text-green-400' },
                    { label: 'Balance Due', value: detail.due_amount, cls: detail.due_amount > 0 ? 'text-yellow-400 font-semibold' : 'text-slate-500' },
                  ].map(t => t.value !== 0 || t.label === 'Balance Due' ? (
                    <div key={t.label} className="flex justify-between">
                      <span className="text-slate-400 text-xs">{t.label}</span>
                      <span className={t.cls}>{fmt(Math.abs(t.value))}{t.value < 0 ? ' off' : ''}</span>
                    </div>
                  ) : null)}
                </div>

                {detail.notes && (
                  <div className="bg-surface-700/40 rounded-lg p-3">
                    <p className="text-xs text-slate-400 mb-1">Notes</p>
                    <p className="text-sm text-slate-300">{detail.notes}</p>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  )
}
