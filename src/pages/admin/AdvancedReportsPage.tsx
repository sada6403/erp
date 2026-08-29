import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, Eye, FileText, Printer, RefreshCw, Search, Table2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import InvoiceDetailModal from '@/components/shared/InvoiceDetailModal'
import { buildInvoicePrintPayload, type InvoiceDetail } from '@/lib/invoicePrint'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

type ReportData = {
  summary: Row
  periodSales: Row[]
  periodProfitLoss: Row[]
  productSales: Row[]
  customerSales: Row[]
  cashierSales: Row[]
  branchSales: Row[]
  paymentMethods: Row[]
  refundCancelled: Row[]
  stockMovements: Row[]
  lowStock: Row[]
  expenses: Row[]
  transferHistory: Row[]
  installmentSummary: Row
  installmentCustomers: Row[]
  paidInstallmentHistory: Row[]
  generatedAt: string
}

const reportTabs = [
  { key: 'periodSales', label: 'Daily / Weekly / Monthly / Yearly Sales' },
  { key: 'periodProfitLoss', label: 'Profit & Loss (by Period)' },
  { key: 'productSales', label: 'Product-wise Profit & Loss' },
  { key: 'customerSales', label: 'Customer-wise' },
  { key: 'cashierSales', label: 'Cashier-wise' },
  { key: 'branchSales', label: 'Branch-wise' },
  { key: 'paymentMethods', label: 'Payment Methods' },
  { key: 'refundCancelled', label: 'Refund / Cancelled Bills' },
  { key: 'stockMovements', label: 'Stock Movement' },
  { key: 'transferHistory', label: 'Transfer History' },
  { key: 'lowStock', label: 'Low Stock' },
  { key: 'expenses', label: 'Expenses' },
  { key: 'installmentCustomers', label: 'Installment Balances' },
  { key: 'paidInstallmentHistory', label: 'Paid Installment History' },
] as const

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const text = (v: unknown) => v == null || v === '' ? '-' : String(v)

function displayKey(key: string) {
  return key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

function cleanRows(rows: Row[]) {
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([k, v]) => [displayKey(k), v ?? ''])))
}

function isColumnNumeric(col: string, sampleValue?: unknown): boolean {
  if (typeof sampleValue === 'number') return true
  return /amount|total|balance|paid|tax|discount|price|profit|cogs|quantity|count|rate|bills/i.test(col)
}

function DataTable({ rows, hiddenColumns, renderActions }: {
  rows: Row[]
  hiddenColumns?: string[]
  renderActions?: (row: Row) => React.ReactNode
}) {
  const columns = (rows[0] ? Object.keys(rows[0]) : []).filter(c => !hiddenColumns?.includes(c))
  if (!rows.length) {
    return (
      <div className="h-48 flex flex-col items-center justify-center gap-2 text-slate-400">
        <Table2 size={32} className="opacity-50" />
        <p className="text-sm font-medium">No records found for the selected filters</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }} className="border-b border-slate-700/50">
            {columns.map(col => {
              const numeric = isColumnNumeric(col, rows[0]?.[col])
              return (
                <th key={col} className={`px-4 py-3 text-xs font-bold uppercase tracking-wider whitespace-nowrap ${numeric ? 'text-right' : 'text-left'}`}>
                  {displayKey(col)}
                </th>
              )
            })}
            {renderActions && <th className="px-4 py-3 text-left text-xs font-bold uppercase tracking-wider whitespace-nowrap">Actions</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-b transition-colors hover:bg-slate-800/30" style={{ borderColor: 'var(--border)' }}>
              {columns.map(col => {
                const value = row[col]
                const numeric = isColumnNumeric(col, value)
                return (
                  <td key={col} className={`px-4 py-3 whitespace-nowrap ${numeric ? 'text-right font-mono text-xs font-semibold' : 'text-left'}`} style={{ color: 'var(--text-1)' }}>
                    {numeric ? (typeof value === 'number' || !isNaN(Number(value)) ? money(value) : text(value)) : text(value)}
                  </td>
                )
              })}
              {renderActions && <td className="px-4 py-3 whitespace-nowrap">{renderActions(row)}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function AdvancedReportsPage() {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const [filters, setFilters] = useState({ dateFrom: monthStart, dateTo: today, groupBy: 'daily', search: '' })
  const [active, setActive] = useState<(typeof reportTabs)[number]['key']>('periodSales')
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [viewingId, setViewingId] = useState<string | null>(null)
  const [printingId, setPrintingId] = useState<string | null>(null)
  const authUser = useAuthStore(state => state.user)

  const quickPrint = async (id: string) => {
    setPrintingId(id)
    try {
      const res = await window.api.reports.transactionDetail(id)
      if (!res.success) { toast.error(res.error || 'Failed to load bill'); return }
      const printRes = await window.api.printer.printInvoice(buildInvoicePrintPayload(res.data as InvoiceDetail))
      if (printRes.success) toast.success('Sent to printer')
      else toast.error(printRes.error || 'Failed to print')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to print')
    } finally {
      setPrintingId(null)
    }
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api?.reports?.advancedSummary?.(filters)
      if (res?.success) setData(res.data as ReportData)
      else toast.error(res?.error || 'Failed to generate report')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to generate report')
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    window.api?.settings?.get?.().then((res: { success: boolean; data?: Record<string, unknown> }) => {
      if (res?.success && res.data) setCompanyName(String(res.data.company_name || ''))
    }).catch(() => {})
  }, [])

  const filteredRows = useMemo(() => {
    const rows = ((data?.[active] as Row[] | undefined) || [])
    if (!filters.search.trim()) return rows
    const q = filters.search.toLowerCase()
    return rows.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
  }, [active, data, filters.search])

  const s = data?.summary || {}
  const installment = data?.installmentSummary || {}
  const reportTitle = reportTabs.find(t => t.key === active)?.label || active

  const metadata = {
    'Company': companyName || 'POS ERP Enterprise',
    'Branch': authUser?.branch?.name || 'All Branches',
    'Report': reportTitle,
    'Date Range': `${filters.dateFrom || 'Start'} to ${filters.dateTo || 'Today'}`,
    'Generated By': authUser?.name || '-',
    'Generated Time': new Date().toLocaleString(),
  }

  const summaryEntries: Array<[string, unknown]> = [
    ['Bills', s.invoice_count],
    ['Sales', s.sales_total],
    ['Paid', s.paid_total],
    ['Balance', s.balance_total],
    ['Profit / Loss', s.profit],
    ['Expenses', s.expenses],
  ]

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await window.api?.reports?.exportCsvRows?.({
        filename: `${active}-${today}`,
        rows: cleanRows(filteredRows),
        metadata,
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'CSV export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'CSV export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportExcel = async () => {
    if (!data) return
    setExporting(true)
    try {
      const res = await window.api?.reports?.exportExcel?.({
        filename: `advanced-reports-${today}`,
        sheets: [
          { name: 'Report Info', rows: Object.entries(metadata).map(([Field, Value]) => ({ Field, Value })) },
          { name: reportTitle.slice(0, 31), rows: cleanRows(filteredRows) },
          { name: 'Installment Summary', rows: [data.installmentSummary] },
        ],
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Excel export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Excel export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await window.api?.reports?.exportPdf?.({
        filename: `${active}-${today}`,
        title: reportTitle,
        metadata,
        summary: summaryEntries,
        rows: cleanRows(filteredRows),
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'PDF export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--bg-page)' }}>
      <PageHeader title="Advanced Reports" subtitle="Sales, transactions, stock, expenses, installments, and audit-ready exports" />

      <div className="flex-1 overflow-y-auto p-4 lg:p-6 space-y-6">
        {/* Filters Card */}
        <div className="rounded-xl border p-4 shadow-sm" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 items-end">
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>From</label>
              <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className="input w-full py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>To</label>
              <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className="input w-full py-1.5 text-sm" />
            </div>
            <div>
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Period</label>
              <select value={filters.groupBy} onChange={e => setFilters(p => ({ ...p, groupBy: e.target.value }))} className="input w-full py-1.5 text-sm">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>
            <div className="lg:col-span-2">
              <label className="block text-xs font-semibold mb-1" style={{ color: 'var(--text-3)' }}>Search current report</label>
              <div className="relative">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="input w-full pl-9 py-1.5 text-sm" placeholder="Bill no, customer, product, phone..." />
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
            <button onClick={load} disabled={loading} className="btn-primary gap-2 text-sm py-1.5 px-4">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Generate
            </button>
            <button onClick={exportCsv} disabled={exporting || !filteredRows.length} className="btn-secondary gap-2 text-sm py-1.5 px-3">
              <Download size={15} /> CSV
            </button>
            <button onClick={exportExcel} disabled={exporting || !data} className="btn-secondary gap-2 text-sm py-1.5 px-3">
              <Download size={15} /> Excel
            </button>
            <button onClick={exportPdf} disabled={exporting || !data} className="btn-secondary gap-2 text-sm py-1.5 px-3">
              <FileText size={15} /> PDF
            </button>
          </div>
        </div>

        {/* Stat Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {([
            ['Bills', s.invoice_count],
            ['Sales', s.sales_total],
            ['Paid', s.paid_total],
            ['Balance', s.balance_total],
            ['Profit / Loss', s.profit],
            ['Expenses', s.expenses],
          ] as Array<[string, unknown]>).map(([label, value]) => (
            <div key={String(label)} className="rounded-xl border p-3.5 shadow-sm flex flex-col justify-between" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <p className="text-xs uppercase tracking-wider font-semibold" style={{ color: 'var(--text-3)' }}>{label}</p>
              <p className="text-xl font-bold mt-1.5 font-mono" style={{ color: Number(value || 0) < 0 ? '#ef4444' : 'var(--text-1)' }}>
                {label === 'Bills' ? text(value) : money(value)}
              </p>
            </div>
          ))}
        </div>

        {/* Main Content Layout */}
        <div className="grid grid-cols-1 xl:grid-cols-4 gap-6 items-start">
          {/* Table Container */}
          <div className="xl:col-span-3 rounded-xl border overflow-hidden shadow-sm flex flex-col" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex gap-1.5 overflow-x-auto p-3 border-b scrollbar-thin" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
              {reportTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className={`px-3 py-2 rounded-lg text-xs font-bold whitespace-nowrap transition-all ${
                    active === tab.key
                      ? 'bg-brand-600 text-white shadow'
                      : 'text-slate-400 hover:text-white hover:bg-slate-800/50'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="p-4 overflow-x-auto">
              <DataTable
                rows={filteredRows}
                hiddenColumns={active === 'refundCancelled' ? ['id'] : undefined}
                renderActions={active === 'refundCancelled' ? (row => (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => setViewingId(String(row.id))}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                      <Eye size={12} /> View
                    </button>
                    <button onClick={() => quickPrint(String(row.id))} disabled={printingId === row.id}
                      className="flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border disabled:opacity-50" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)', color: 'var(--text-2)' }}>
                      <Printer size={12} /> {printingId === row.id ? '…' : 'Print'}
                    </button>
                  </div>
                )) : undefined}
              />
            </div>
          </div>

          {/* Sidebar */}
          <div className="rounded-xl border p-4 space-y-4 shadow-sm" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="border-b pb-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Installment Tracking</p>
              <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Customer paid, balance, due date & overdue status.</p>
            </div>
            <div className="space-y-2.5">
              {([
                ['Contracts', installment.contract_count],
                ['Installment Sales', installment.installment_sales_total],
                ['Down Payments', installment.down_payment_total],
                ['Interest', installment.interest_total],
                ['Paid', installment.paid_total],
                ['Pending Balance', installment.balance_total],
                ['Overdue Customers', installment.overdue_count],
              ] as Array<[string, unknown]>).map(([label, value]) => (
                <div key={String(label)} className="flex justify-between items-center text-xs py-1 border-b border-slate-800/30">
                  <span className="font-medium" style={{ color: 'var(--text-3)' }}>{label}</span>
                  <strong className="font-mono text-sm font-bold text-right" style={{ color: label === 'Overdue Customers' && Number(value) > 0 ? '#ef4444' : 'var(--text-1)' }}>
                    {label === 'Contracts' || label === 'Overdue Customers' ? text(value) : money(value)}
                  </strong>
                </div>
              ))}
            </div>
            <div className="pt-3 border-t text-[11px] space-y-2 leading-relaxed" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
              <p>• Bank transfer proof URL, receipt number, receiver, paid date, and status are included in paid installment history.</p>
              <p>• Every generated report/export is recorded in audit logs.</p>
            </div>
          </div>
        </div>
      </div>

      {viewingId && (
        <InvoiceDetailModal invoiceId={viewingId} onClose={() => setViewingId(null)} />
      )}
    </div>
  )
}
