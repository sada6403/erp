import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, RefreshCw, Search, GitBranch, Package, ArrowDownUp, Download, FileText } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'

type Row = Record<string, unknown>

const movementTypes = ['', 'SALE', 'TRANSFER', 'RECEIVE', 'ADJUSTMENT'] as const

function money(n: unknown) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

export default function StockIntelligencePage() {
  const [branches, setBranches] = useState<Row[]>([])
  const [branchSummary, setBranchSummary] = useState<Row[]>([])
  const [branchId, setBranchId] = useState('')
  const [branchStock, setBranchStock] = useState<Row[]>([])
  const [movements, setMovements] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [movementType, setMovementType] = useState<(typeof movementTypes)[number]>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    window.api?.settings?.get?.().then((res: { success: boolean; data?: Record<string, unknown> }) => {
      if (res?.success && res.data) setCompanyName(String(res.data.company_name || ''))
    })
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      const [branchList, summary, stockRes, moveRes] = await Promise.all([
        window.api.admin.branches.list(),
        window.api.stocks.branchSummary(),
        branchId ? window.api.stocks.branchDetail(branchId) : Promise.resolve({ success: true, data: [] }),
        window.api.stocks.movements({
          branch_id: branchId || undefined,
          movement_type: movementType || undefined,
          date_from: dateFrom || undefined,
          date_to: dateTo || undefined,
        }),
      ])
      if (branchList.success) setBranches(branchList.data as Row[])
      if (summary.success) setBranchSummary(summary.data as Row[])
      if (stockRes.success) setBranchStock(stockRes.data as Row[])
      if (moveRes.success) setMovements(moveRes.data as Row[])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [branchId, movementType, dateFrom, dateTo])

  const filteredMovements = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return movements
    return movements.filter(row => Object.values(row).some(v => String(v ?? '').toLowerCase().includes(q)))
  }, [movements, search])

  const currentRows = branchId ? branchStock : branchSummary
  const currentTitle = branchId ? 'Current Stock for Selected Branch' : 'Current Stock by Branch'
  const currentHint = branchId
    ? 'Live product rows for the branch you selected.'
    : 'Branch matrix with stock health, units, and alert counts.'

  const lowStock = useMemo(() => {
    if (branchStock.length) {
      return branchStock.filter(row => {
        const qty = Number(row.quantity ?? 0)
        return qty >= 1 && qty <= 5
      })
    }
    return branchSummary.filter(row => Number(row.low_stock_count ?? 0) > 0 || Number(row.out_of_stock_count ?? 0) > 0)
  }, [branchStock, branchSummary])

  const exportRows = async () => {
    setExporting(true)
    try {
      await window.api.reports.exportCsvRows({
        filename: `stock-intelligence-${new Date().toISOString().slice(0, 10)}`,
        rows: branchId ? branchStock : branchSummary,
        metadata: {
          Company: companyName || 'Nature Plantation',
          Branch: branchId || 'All Branches',
          Period: `${dateFrom || 'Start'} to ${dateTo || 'Today'}`,
          Movement: movementType || 'All',
        },
      })
    } finally {
      setExporting(false)
    }
  }

  const exportMovements = async () => {
    setExporting(true)
    try {
      await window.api.reports.exportCsvRows({
        filename: `stock-movements-${new Date().toISOString().slice(0, 10)}`,
        rows: filteredMovements,
        metadata: {
          Company: companyName || 'Nature Plantation',
          Branch: branchId || 'All Branches',
          Period: `${dateFrom || 'Start'} to ${dateTo || 'Today'}`,
          Movement: movementType || 'All',
        },
      })
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="h-full overflow-auto" style={{ background: 'var(--bg-page)' }}>
      <PageHeader
        title="Stock Intelligence"
        subtitle="Branch matrix, current stock, transfer history, and movement audit"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={exportRows} disabled={exporting} className="btn-secondary btn-sm gap-1.5">
              <Download size={14} /> Export Stock
            </button>
            <button onClick={exportMovements} disabled={exporting} className="btn-secondary btn-sm gap-1.5">
              <FileText size={14} /> Export Movements
            </button>
            <button onClick={load} className="btn-primary btn-sm gap-1.5">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      <div className="p-4 lg:p-6 space-y-4">
        <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              Branch
              <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input mt-1 w-full">
                <option value="">All Branches</option>
                {branches.map(b => <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              Movement Type
              <select value={movementType} onChange={e => setMovementType(e.target.value as typeof movementType)} className="input mt-1 w-full">
                {movementTypes.map(type => <option key={type || 'all'} value={type}>{type || 'All'}</option>)}
              </select>
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              From
              <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              To
              <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input mt-1 w-full" />
            </label>
            <label className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>
              Search
              <div className="relative mt-1">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input value={search} onChange={e => setSearch(e.target.value)} className="input w-full pl-9" placeholder="Product, SKU, branch, ref..." />
              </div>
            </label>
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[
            { label: 'Branches', value: branchSummary.length, icon: GitBranch },
            { label: 'Low Stock Items', value: lowStock.length, icon: AlertTriangle },
            { label: 'Current Rows', value: branchStock.length, icon: Package },
            { label: 'Movements', value: filteredMovements.length, icon: ArrowDownUp },
          ].map(card => {
            const Icon = card.icon
            return (
              <div key={card.label} className="rounded-lg border p-3 flex items-center gap-3" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <div className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: 'var(--bg-soft)' }}>
                  <Icon size={16} style={{ color: 'var(--brand-primary)' }} />
                </div>
                <div>
                  <p className="text-xs" style={{ color: 'var(--text-3)' }}>{card.label}</p>
                  <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{card.value}</p>
                </div>
              </div>
            )
          })}
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="xl:col-span-2 rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--text-1)' }}>{currentTitle}</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{currentHint}</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
                {branchId ? 'Branch scoped' : 'All branches'}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-3)' }}>
                    {branchId ? (
                      <>
                        <th className="py-2 text-left">Product</th>
                        <th className="py-2 text-left">SKU</th>
                        <th className="py-2 text-left">Category</th>
                        <th className="py-2 text-right">Qty</th>
                        <th className="py-2 text-right">Min</th>
                        <th className="py-2 text-left">Status</th>
                      </>
                    ) : (
                      <>
                        <th className="py-2 text-left">Branch</th>
                        <th className="py-2 text-left">Code</th>
                        <th className="py-2 text-right">Products</th>
                        <th className="py-2 text-right">Units</th>
                        <th className="py-2 text-right">Low</th>
                        <th className="py-2 text-right">Out</th>
                        <th className="py-2 text-left">Status</th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {(currentRows as Row[]).map(row => {
                    if (branchId) {
                      const qty = Number(row.quantity || 0)
                      const status = String(row.stock_status || (qty === 0 ? 'out' : qty <= 5 ? 'low' : 'ok'))
                      return (
                        <tr key={String(row.id)} className="border-t" style={{ borderColor: 'var(--border)' }}>
                          <td className="py-2 pr-3" style={{ color: 'var(--text-1)' }}>{String(row.product_name || '-')}</td>
                          <td className="py-2 pr-3 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{String(row.sku || '-')}</td>
                          <td className="py-2 pr-3" style={{ color: 'var(--text-2)' }}>{String(row.category_name || '-')}</td>
                          <td className="py-2 pr-3 text-right font-semibold" style={{ color: qty === 0 ? '#ef4444' : qty <= 5 ? '#eab308' : '#22c55e' }}>{qty}</td>
                          <td className="py-2 pr-3 text-right" style={{ color: 'var(--text-2)' }}>{Number(row.min_stock_level || 0)}</td>
                          <td className="py-2">
                            <span className={`badge-${status === 'out' ? 'red' : status === 'low' ? 'yellow' : 'green'}`}>
                              {status === 'out' ? 'Out of stock' : status === 'low' ? 'Low stock' : 'In stock'}
                            </span>
                          </td>
                        </tr>
                      )
                    }

                    const out = Number(row.out_of_stock_count || 0)
                    const low = Number(row.low_stock_count || 0)
                    const healthy = out === 0 && low === 0
                    return (
                      <tr key={String(row.id)} className="border-t" style={{ borderColor: 'var(--border)' }}>
                        <td className="py-2 pr-3">
                          <p className="font-medium" style={{ color: 'var(--text-1)' }}>{String(row.name || '-')}</p>
                          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{String(row.address || '-') || 'No address'}</p>
                        </td>
                        <td className="py-2 pr-3 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{String(row.code || '-')}</td>
                        <td className="py-2 pr-3 text-right font-semibold" style={{ color: 'var(--text-1)' }}>{Number(row.product_count || 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold" style={{ color: 'var(--text-1)' }}>{Number(row.total_units || 0)}</td>
                        <td className="py-2 pr-3 text-right font-semibold" style={{ color: low > 0 ? '#eab308' : 'var(--text-1)' }}>{low}</td>
                        <td className="py-2 pr-3 text-right font-semibold" style={{ color: out > 0 ? '#ef4444' : 'var(--text-1)' }}>{out}</td>
                        <td className="py-2">
                          <span className={`badge-${healthy ? 'green' : out > 0 ? 'red' : 'yellow'}`}>
                            {healthy ? 'Healthy' : out > 0 ? 'Action needed' : 'Monitor'}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                  {!currentRows.length && (
                    <tr>
                      <td colSpan={branchId ? 6 : 7} className="py-10 text-center" style={{ color: 'var(--text-3)' }}>
                        {branchId ? 'No stock rows found for this branch' : 'No branch summary available'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Low Stock Alerts</h3>
            <div className="space-y-2">
              {lowStock.length === 0 ? (
                <div className="rounded-lg border p-3 text-sm" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                  No low stock items
                </div>
              ) : lowStock.slice(0, 12).map(row => (
                <div key={String(row.id)} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{String(row.product_name || row.name || '-')}</p>
                      <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    SKU: {String(row.sku || '-')} · Qty: {Number(row.quantity || row.total_units || 0)} · Range: 1-5 low, 0 out
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <div className="flex items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--text-1)' }}>Movement Log</h3>
                <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>SALE, TRANSFER, RECEIVE, ADJUSTMENT</p>
              </div>
              <span className="text-xs px-2 py-1 rounded-full" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
                {filteredMovements.length} rows
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead>
                  <tr style={{ color: 'var(--text-3)' }}>
                    <th className="py-2 text-left">Date</th>
                    <th className="py-2 text-left">Product</th>
                    <th className="py-2 text-left">From</th>
                    <th className="py-2 text-left">To</th>
                    <th className="py-2 text-right">Qty</th>
                    <th className="py-2 text-left">Type</th>
                    <th className="py-2 text-left">Done By</th>
                    <th className="py-2 text-left">Order Ref</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredMovements.map(row => (
                    <tr key={String(row.id)} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="py-2 pr-3 text-xs" style={{ color: 'var(--text-3)' }}>{String(row.created_at || '-')}</td>
                      <td className="py-2 pr-3">
                        <p className="font-medium" style={{ color: 'var(--text-1)' }}>{String(row.product_name || '-')}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{String(row.sku || '-')}</p>
                      </td>
                      <td className="py-2 pr-3" style={{ color: 'var(--text-2)' }}>{String(row.from_branch_name || '-')}</td>
                      <td className="py-2 pr-3" style={{ color: 'var(--text-2)' }}>{String(row.to_branch_name || '-')}</td>
                      <td className="py-2 pr-3 text-right font-semibold" style={{ color: 'var(--text-1)' }}>{Number(row.quantity || 0)}</td>
                      <td className="py-2 pr-3">
                        <span className={`badge-${String(row.movement_type) === 'SALE' ? 'red' : String(row.movement_type) === 'TRANSFER' ? 'blue' : String(row.movement_type) === 'RECEIVE' ? 'green' : 'yellow'}`}>
                          {String(row.movement_type || '-')}
                        </span>
                      </td>
                      <td className="py-2 pr-3" style={{ color: 'var(--text-2)' }}>{String(row.done_by_name || '-')}</td>
                      <td className="py-2 pr-3 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{String(row.invoice_number || row.transfer_number || '-')}</td>
                    </tr>
                  ))}
                  {!filteredMovements.length && (
                    <tr>
                      <td colSpan={8} className="py-10 text-center" style={{ color: 'var(--text-3)' }}>No movements found</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="rounded-lg border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <h3 className="font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Branch Matrix</h3>
            <div className="space-y-2">
              {branchSummary.map(row => (
                <div key={String(row.id)} className="rounded-lg border p-3 flex items-center justify-between gap-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <div>
                    <p className="font-medium" style={{ color: 'var(--text-1)' }}>{String(row.name || '-')}</p>
                    <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                      Products {Number(row.product_count || 0)} · Units {Number(row.total_units || 0)} · Low {Number(row.low_stock_count || 0)}
                    </p>
                  </div>
                  <span className={`badge-${Number(row.out_of_stock_count || 0) > 0 ? 'red' : Number(row.low_stock_count || 0) > 0 ? 'yellow' : 'green'}`}>
                    {Number(row.out_of_stock_count || 0) > 0 ? 'Action needed' : Number(row.low_stock_count || 0) > 0 ? 'Monitor' : 'Healthy'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
