import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Ticket, Download, FileSpreadsheet, FileText, Search } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const TABS = [
  { key: 'issued',          label: 'Issued' },
  { key: 'redeemed',        label: 'Redeemed' },
  { key: 'completed',       label: 'Fully Used' },
  { key: 'expired',         label: 'Expired' },
  { key: 'customerSummary', label: 'Customer Summary' },
] as const

type TabKey = typeof TABS[number]['key']

const money = (n: unknown) => `Rs.${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// Column layouts per report type: [key, header, isMoney]
const COLUMNS: Record<TabKey, Array<[string, string, boolean?]>> = {
  issued: [
    ['created_at', 'Issued On'], ['code', 'Code'], ['name', 'Name'], ['customer_name', 'Customer'],
    ['initial_value', 'Value', true], ['used_amount', 'Used', true], ['balance', 'Balance', true],
    ['status', 'Status'], ['valid_until', 'Valid Until'], ['branch_name', 'Branch'], ['issued_by_name', 'Issued By'],
  ],
  redeemed: [
    ['created_at', 'Date'], ['code', 'Code'], ['coupon_name', 'Coupon'], ['customer_name', 'Customer'],
    ['invoice_number', 'Invoice'], ['amount', 'Amount', true], ['balance_after', 'Balance After', true],
    ['branch_name', 'Branch'], ['redeemed_by_name', 'Cashier'],
  ],
  completed: [
    ['created_at', 'Issued On'], ['code', 'Code'], ['name', 'Name'], ['customer_name', 'Customer'],
    ['initial_value', 'Value', true], ['used_amount', 'Used', true], ['branch_name', 'Branch'],
  ],
  expired: [
    ['created_at', 'Issued On'], ['code', 'Code'], ['name', 'Name'], ['customer_name', 'Customer'],
    ['initial_value', 'Value', true], ['used_amount', 'Used', true], ['balance', 'Forfeited', true],
    ['valid_until', 'Expired On'], ['branch_name', 'Branch'],
  ],
  customerSummary: [
    ['customer_name', 'Customer'], ['customer_phone', 'Phone'], ['coupons_issued', 'Coupons'],
    ['total_value', 'Total Value', true], ['total_used', 'Used', true], ['total_remaining', 'Remaining', true],
  ],
}

export default function CouponReportsPage() {
  const [tab, setTab]           = useState<TabKey>('issued')
  const [rows, setRows]         = useState<Row[]>([])
  const [summary, setSummary]   = useState<Record<string, unknown>>({})
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [search, setSearch]     = useState('')
  const [loading, setLoading]   = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.coupons.reports({
        type: tab,
        dateFrom: dateFrom || undefined,
        dateTo: dateTo || undefined,
        search: search || undefined,
      })
      if (res.success) {
        const data = res.data as { rows: Row[]; summary: Record<string, unknown> }
        setRows(data.rows || [])
        setSummary(data.summary || {})
      } else toast.error(String(res.error || 'Failed to load report'))
    } finally { setLoading(false) }
  }, [tab, dateFrom, dateTo, search])

  useEffect(() => { load() }, [load])

  const columns = COLUMNS[tab]

  const exportRows = () => rows.map(r => {
    const out: Record<string, unknown> = {}
    for (const [key, header, isMoney] of columns) {
      out[header] = isMoney ? Number(r[key] || 0) : (r[key] ?? '')
    }
    return out
  })

  const exportCsv = async () => {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const res = await window.api.reports.exportCsvRows({
      filename: `coupon-report-${tab}-${new Date().toISOString().slice(0, 10)}`,
      rows: exportRows(),
      metadata: { Report: `Coupons — ${TABS.find(t => t.key === tab)?.label}`, From: dateFrom || 'All', To: dateTo || 'All' },
    })
    if ((res as { success: boolean }).success) toast.success('CSV exported')
  }

  const exportExcel = async () => {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const res = await window.api.reports.exportExcel({
      filename: `coupon-report-${tab}-${new Date().toISOString().slice(0, 10)}`,
      sheets: [{ name: TABS.find(t => t.key === tab)?.label || 'Coupons', rows: exportRows() }],
    })
    if ((res as { success: boolean }).success) toast.success('Excel exported')
  }

  const summaryCards: Array<[string, unknown, boolean?]> =
    tab === 'redeemed' ? [['Redemptions', summary.count], ['Total Redeemed', summary.total_redeemed, true]]
    : tab === 'customerSummary' ? [['Customers', summary.customers], ['Total Value', summary.total_value, true], ['Total Used', summary.total_used, true]]
    : tab === 'expired' ? [['Coupons', summary.count], ['Total Value', summary.total_value, true], ['Used Before Expiry', summary.total_used, true], ['Forfeited Balance', summary.forfeited_balance, true]]
    : [['Coupons', summary.count], ['Total Value', summary.total_value, true], ['Used', summary.total_used, true], ['Remaining', summary.total_remaining, true]]

  const exportPdf = async () => {
    if (!rows.length) { toast.error('Nothing to export'); return }
    const res = await window.api.reports.exportPdf({
      filename: `coupon-report-${tab}-${new Date().toISOString().slice(0, 10)}`,
      title: `Coupons — ${TABS.find(t => t.key === tab)?.label}`,
      metadata: { Report: `Coupons — ${TABS.find(t => t.key === tab)?.label}`, From: dateFrom || 'All', To: dateTo || 'All' },
      summary: summaryCards.map(([label, value]) => [label, value] as [string, unknown]),
      rows: exportRows(),
    })
    if ((res as { success: boolean }).success) toast.success('PDF exported')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Coupon Reports"
        subtitle="Issued, redeemed, completed and expired gift coupons"
        actions={
          <div className="flex gap-2">
            <button onClick={exportCsv} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF</button>
          </div>
        }
      />

      {/* Tabs + filters */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-6 pt-3 pb-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-colors ${
                tab === t.key ? 'bg-[var(--bg-card)] text-blue-500' : 'text-[var(--text-3)] hover:text-[var(--text-1)]'
              }`}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input py-1.5 text-xs w-36" />
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>to</span>
          <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input py-1.5 text-xs w-36" />
          <div className="relative w-56">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="input py-1.5 pl-8 text-xs" placeholder="Search…" />
          </div>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 px-6 py-4 flex-shrink-0">
        {summaryCards.map(([label, value, isMoney]) => (
          <div key={label} className="rounded-xl border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</p>
            <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>
              {isMoney ? money(value) : String(value ?? 0)}
            </p>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6 pb-6">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {columns.map(([key, header]) => (
                <th key={key} className="table-header px-3 py-2.5 text-left">{header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className="table-row">
                {columns.map(([key, , isMoney]) => (
                  <td key={key} className={`table-cell text-xs ${isMoney ? 'font-semibold' : ''}`}>
                    {isMoney
                      ? money(r[key])
                      : key === 'created_at' || key === 'valid_until'
                        ? (r[key] ? String(r[key]).slice(0, 10) : '—')
                        : String(r[key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
            {rows.length === 0 && !loading && (
              <tr><td colSpan={columns.length} className="text-center py-16 text-slate-500">
                <Ticket size={28} className="mx-auto mb-2 opacity-40" />
                No data for this report
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
