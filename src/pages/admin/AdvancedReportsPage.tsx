import { useCallback, useEffect, useMemo, useState } from 'react'
import { Download, FileText, RefreshCw, Search, Table2 } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
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

function DataTable({ rows }: { rows: Row[] }) {
  const columns = rows[0] ? Object.keys(rows[0]) : []
  if (!rows.length) {
    return (
      <div className="h-40 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--text-3)' }}>
        <Table2 size={28} />
        <p className="text-sm">No records for the selected filters</p>
      </div>
    )
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[900px] text-sm">
        <thead>
          <tr style={{ background: 'var(--bg-soft)', color: 'var(--text-3)' }}>
            {columns.map(col => (
              <th key={col} className="px-3 py-2 text-left text-xs font-semibold whitespace-nowrap">
                {displayKey(col)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, idx) => (
            <tr key={idx} className="border-t" style={{ borderColor: 'var(--border)' }}>
              {columns.map(col => {
                const value = row[col]
                const numeric = typeof value === 'number' || /amount|total|balance|paid|tax|discount|price|profit|cogs|quantity|count|rate/i.test(col)
                return (
                  <td key={col} className={`px-3 py-2 whitespace-nowrap ${numeric ? 'text-right tabular-nums' : ''}`} style={{ color: 'var(--text-2)' }}>
                    {numeric ? money(value) : text(value)}
                  </td>
                )
              })}
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
  const authUser = useAuthStore(state => state.user)

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
    'Company': companyName || 'Nature Plantation',
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
    <div className="h-full overflow-auto" style={{ background: 'var(--bg-page)' }}>
      <PageHeader title="Advanced Reports" subtitle="Sales, transactions, stock, expenses, installments, and audit-ready exports" />

      <div className="p-4 lg:p-6 space-y-4">
        <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              From
              <input type="date" value={filters.dateFrom} onChange={e => setFilters(p => ({ ...p, dateFrom: e.target.value }))} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              To
              <input type="date" value={filters.dateTo} onChange={e => setFilters(p => ({ ...p, dateTo: e.target.value }))} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              Period
              <select value={filters.groupBy} onChange={e => setFilters(p => ({ ...p, groupBy: e.target.value }))} className="input mt-1 w-full">
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="monthly">Monthly</option>
                <option value="yearly">Yearly</option>
              </select>
            </label>
            <label className="text-xs font-semibold md:col-span-2" style={{ color: 'var(--text-3)' }}>
              Search current report
              <div className="relative mt-1">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input value={filters.search} onChange={e => setFilters(p => ({ ...p, search: e.target.value }))} className="input w-full pl-9" placeholder="Bill no, customer, product, phone..." />
              </div>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button onClick={load} disabled={loading} className="btn-primary gap-2">
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} /> Generate
            </button>
            <button onClick={exportCsv} disabled={exporting || !filteredRows.length} className="btn-secondary gap-2">
              <Download size={15} /> CSV
            </button>
            <button onClick={exportExcel} disabled={exporting || !data} className="btn-secondary gap-2">
              <Download size={15} /> Excel
            </button>
            <button onClick={exportPdf} disabled={exporting || !data} className="btn-secondary gap-2">
              <FileText size={15} /> PDF
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
          {([
            ['Bills', s.invoice_count],
            ['Sales', s.sales_total],
            ['Paid', s.paid_total],
            ['Balance', s.balance_total],
            ['Profit / Loss', s.profit],
            ['Expenses', s.expenses],
          ] as Array<[string, unknown]>).map(([label, value]) => (
            <div key={String(label)} className="rounded-lg border p-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</p>
              <p className="text-lg font-bold mt-1" style={{ color: Number(value || 0) < 0 ? '#ef4444' : 'var(--text-1)' }}>
                {label === 'Bills' ? text(value) : money(value)}
              </p>
            </div>
          ))}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <div className="lg:col-span-4 rounded-lg border overflow-hidden" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex gap-2 overflow-x-auto p-3 border-b" style={{ borderColor: 'var(--border)' }}>
              {reportTabs.map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setActive(tab.key)}
                  className="px-3 py-2 rounded-lg text-xs font-semibold whitespace-nowrap"
                  style={active === tab.key
                    ? { background: 'var(--brand-primary)', color: 'white' }
                    : { background: 'var(--bg-soft)', color: 'var(--text-2)' }}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="p-3">
              <DataTable rows={filteredRows} />
            </div>
          </div>

          <div className="rounded-lg border p-4 space-y-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div>
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Installment Tracking</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Customer paid, balance, due date, overdue status.</p>
            </div>
            {([
              ['Contracts', installment.contract_count],
              ['Installment Sales', installment.installment_sales_total],
              ['Down Payments', installment.down_payment_total],
              ['Interest', installment.interest_total],
              ['Paid', installment.paid_total],
              ['Pending Balance', installment.balance_total],
              ['Overdue Customers', installment.overdue_count],
            ] as Array<[string, unknown]>).map(([label, value]) => (
              <div key={String(label)} className="flex justify-between gap-3 text-sm">
                <span style={{ color: 'var(--text-3)' }}>{label}</span>
                <strong className="text-right" style={{ color: label === 'Overdue Customers' && Number(value) > 0 ? '#ef4444' : 'var(--text-1)' }}>
                  {label === 'Contracts' || label === 'Overdue Customers' ? text(value) : money(value)}
                </strong>
              </div>
            ))}
            <div className="pt-3 border-t text-xs space-y-2" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
              <p>Bank transfer proof URL, receipt number, receiver, paid date, and status are included in paid installment history.</p>
              <p>Every generated report/export is recorded in audit logs.</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
