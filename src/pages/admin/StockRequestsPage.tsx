import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import {
  AlertTriangle, ArrowRightLeft, CheckCircle2, XCircle, Truck,
  Package, Search, Plus, Clock, Eye, Building2, TrendingDown,
  RefreshCw, ChevronRight, MapPin, Layers, AlertCircle
} from 'lucide-react'
import toast from 'react-hot-toast'

type Transfer = Record<string, unknown>
type StockItem = Record<string, unknown>
type BranchStat = Record<string, unknown>

const TRANSFER_PIPELINE = [
  { status: 'pending_approval', label: 'Pending',    cls: 'badge-yellow',  icon: <Clock size={11} /> },
  { status: 'approved',         label: 'Approved',   cls: 'badge-blue',    icon: <CheckCircle2 size={11} /> },
  { status: 'dispatched',       label: 'Dispatched', cls: 'badge-purple',  icon: <Truck size={11} /> },
  { status: 'in_transit',       label: 'In Transit', cls: 'badge-orange',  icon: <Truck size={11} /> },
  { status: 'received',         label: 'Received',   cls: 'badge-green',   icon: <CheckCircle2 size={11} /> },
  { status: 'partially_received', label: 'Partial',  cls: 'badge-yellow',  icon: <AlertTriangle size={11} /> },
  { status: 'rejected',         label: 'Rejected',   cls: 'badge-red',     icon: <XCircle size={11} /> },
  { status: 'cancelled',        label: 'Cancelled',  cls: 'badge-gray',    icon: <XCircle size={11} /> },
  { status: 'discrepancy',      label: 'Discrepancy',cls: 'badge-red',     icon: <AlertTriangle size={11} /> },
]

const PIPELINE_ORDER = ['pending_approval','approved','dispatched','in_transit','received','partially_received']

function getPipelineMeta(status: string) {
  return TRANSFER_PIPELINE.find(p => p.status === status) ?? { label: status, cls: 'badge-gray', icon: null }
}

function nextStatus(status: string) {
  const idx = PIPELINE_ORDER.indexOf(status)
  if (idx < 0 || idx >= PIPELINE_ORDER.length - 1) return null
  return PIPELINE_ORDER[idx + 1]
}

const STOCK_STATUS_COLORS: Record<string, string> = {
  out: 'badge-red',
  low: 'badge-yellow',
  ok:  'badge-green',
}

const fmt = (n: unknown) => `Rs.${Number(n || 0).toLocaleString()}`

export default function StockRequestsPage() {
  const { user } = useAuthStore()
  const isAdmin = Boolean(
    ((user?.role as unknown as Record<string,unknown>)?.permissions as Record<string,unknown> || {})?.all
  )
  const userBranchId: string = (user?.branch?.id || (user as unknown as Record<string,unknown>)?.branch_id as string) ?? ''

  const [tab, setTab] = useState<'my-stock' | 'requests' | 'branches'>('my-stock')
  const [stockFilter, setStockFilter] = useState<'all' | 'low' | 'out'>('all')
  const [stockSearch, setStockSearch] = useState('')
  const [myStock, setMyStock]         = useState<StockItem[]>([])
  const [transfers, setTransfers]     = useState<Transfer[]>([])
  const [branchStats, setBranchStats] = useState<BranchStat[]>([])
  const [branches, setBranches]       = useState<Record<string,string>[]>([])
  const [loading, setLoading]         = useState(false)
  const [tfFilter, setTfFilter]       = useState('')
  const [requestItem, setRequestItem] = useState<StockItem | null>(null)
  const [drillBranch, setDrillBranch] = useState<BranchStat | null>(null)
  const [drillStock, setDrillStock]   = useState<StockItem[]>([])
  const [selectedTf, setSelectedTf]   = useState<Transfer | null>(null)
  const [showNewRequest, setShowNewRequest] = useState(false)

  const loadMyStock = useCallback(async () => {
    if (!userBranchId) return
    setLoading(true)
    const res = await window.api.stocks.branchDetail(userBranchId)
    setLoading(false)
    if (res.success) setMyStock(res.data as StockItem[])
  }, [userBranchId])

  const loadTransfers = useCallback(async () => {
    const res = await window.api.stocks.listTransfers(tfFilter ? { status: tfFilter } : {})
    if (res.success) setTransfers(res.data as Transfer[])
  }, [tfFilter])

  const loadBranchStats = useCallback(async () => {
    const res = await window.api.stocks.branchSummary()
    if (res.success) setBranchStats(res.data as BranchStat[])
  }, [])

  const loadBranches = useCallback(async () => {
    const res = await window.api.admin.branches.list()
    if (res.success) setBranches((res.data as Record<string,unknown>[]).map(b => ({ id: String(b.id), name: String(b.name) })))
  }, [])

  useEffect(() => {
    loadBranches()
    if (tab === 'my-stock') loadMyStock()
    if (tab === 'requests') loadTransfers()
    if (tab === 'branches') loadBranchStats()
  }, [tab, loadMyStock, loadTransfers, loadBranchStats, loadBranches])

  useEffect(() => {
    if (tab === 'requests') loadTransfers()
  }, [tfFilter, tab, loadTransfers])

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (tab === 'my-stock') loadMyStock()
      if (tab === 'requests') loadTransfers()
      if (tab === 'branches') loadBranchStats()
    }, 12000)
    return () => window.clearInterval(timer)
  }, [tab, loadMyStock, loadTransfers, loadBranchStats])

  const drillIntoBranch = async (b: BranchStat) => {
    setDrillBranch(b)
    const res = await window.api.stocks.branchDetail(String(b.id))
    if (res.success) setDrillStock(res.data as StockItem[])
  }

  const handleAdvanceTransfer = async (tf: Transfer, status: string, extra: Record<string,unknown> = {}) => {
    const res = await window.api.stocks.updateTransfer(String(tf.id), status, extra)
    if (res.success) {
      toast.success(`Transfer marked as ${status.replace(/_/g, ' ')}`)
      loadTransfers()
      if (tab === 'my-stock') loadMyStock()
      if (tab === 'branches') loadBranchStats()
      setSelectedTf(null)
    } else {
      toast.error(res.error || 'Failed')
    }
  }

  // Filtered stock for My Stock tab
  const filteredStock = myStock.filter(s => {
    if (stockFilter !== 'all' && s.stock_status !== stockFilter) return false
    if (stockSearch) {
      const q = stockSearch.toLowerCase()
      return String(s.product_name).toLowerCase().includes(q) ||
             String(s.sku).toLowerCase().includes(q)
    }
    return true
  })

  const lowCount = myStock.filter(s => s.stock_status === 'low').length
  const outCount = myStock.filter(s => s.stock_status === 'out').length
  const pendingCount = transfers.filter(t => t.status === 'pending_approval' && String(t.to_branch_id) === userBranchId).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Stock Requests"
        subtitle="Request stock from other branches — track from request to delivery"
        actions={
          <button className="btn-primary btn-sm gap-1.5" onClick={() => setShowNewRequest(true)}>
            <Plus size={14} /> New Request
          </button>
        }
      />

      {/* Summary chips */}
      <div className="flex gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <Chip icon={<TrendingDown size={13} />} label="Low Stock" value={lowCount} color="text-yellow-500"
          onClick={() => { setTab('my-stock'); setStockFilter('low') }} active={tab === 'my-stock' && stockFilter === 'low'} />
        <Chip icon={<AlertCircle size={13} />} label="Out of Stock" value={outCount} color="text-red-500"
          onClick={() => { setTab('my-stock'); setStockFilter('out') }} active={tab === 'my-stock' && stockFilter === 'out'} />
        <Chip icon={<Clock size={13} />} label="My Pending" value={pendingCount} color="text-blue-400"
          onClick={() => { setTab('requests'); setTfFilter('pending_approval') }} active={tab === 'requests' && tfFilter === 'pending_approval'} />
      </div>

      {/* Tabs */}
      <div className="flex gap-1 px-6 py-2 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        {(['my-stock', 'requests', ...(isAdmin ? ['branches'] : [])] as const).map(t => (
          <button key={t} onClick={() => setTab(t as typeof tab)}
            className={`px-4 py-2 rounded-lg text-xs font-medium capitalize transition-all ${
              tab === t ? 'bg-blue-600 text-white' : 'text-[var(--text-3)] hover:bg-[var(--bg-soft)]'
            }`}>
            {t === 'my-stock' ? 'My Branch Stock' : t === 'requests' ? 'Transfer Requests' : 'All Branches'}
          </button>
        ))}
      </div>

      {/* ── Tab: My Branch Stock ─────────────────────────────────────────── */}
      {tab === 'my-stock' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            <div className="relative flex-1 max-w-xs">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input value={stockSearch} onChange={e => setStockSearch(e.target.value)}
                placeholder="Search product / SKU..." className="input pl-9 py-1.5 text-sm" />
            </div>
            {(['all', 'low', 'out'] as const).map(f => (
              <button key={f} onClick={() => setStockFilter(f)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
                  stockFilter === f ? 'bg-blue-600 text-white' : 'bg-[var(--bg-soft)] text-[var(--text-3)]'
                }`}>
                {f === 'out' ? 'Out of Stock' : f === 'low' ? 'Low Stock' : 'All'}
              </button>
            ))}
            <button onClick={loadMyStock} className="btn-ghost btn-sm gap-1">
              <RefreshCw size={13} /> Refresh
            </button>
          </div>

          {loading ? (
            <div className="flex-1 flex items-center justify-center">
              <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
            </div>
          ) : (
            <div className="flex-1 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
                  <tr>
                    {['Product', 'SKU', 'Category', 'Current Qty', 'Min Level', 'Status', ''].map(h => (
                      <th key={h} className="table-header">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {filteredStock.map(s => (
                    <tr key={String(s.id)} className="table-row">
                      <td className="table-cell">
                        <div className="flex items-center gap-2">
                          {(s.image_url as string) ? (
                            <img src={s.image_url as string} alt="" className="w-8 h-8 rounded object-cover border" style={{ borderColor: 'var(--border)' }} />
                          ) : (
                            <div className="w-8 h-8 rounded flex items-center justify-center border" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
                              <Package size={14} style={{ color: 'var(--text-3)' }} />
                            </div>
                          )}
                          <span className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{s.product_name as string}</span>
                        </div>
                      </td>
                      <td className="table-cell font-mono text-xs text-blue-400">{s.sku as string}</td>
                      <td className="table-cell text-xs" style={{ color: 'var(--text-3)' }}>{(s.category_name as string) || '—'}</td>
                      <td className="table-cell">
                        <span className={`font-bold text-base ${Number(s.quantity) === 0 ? 'text-red-400' : Number(s.quantity) <= Number(s.min_stock_level) ? 'text-yellow-400' : 'text-green-400'}`}>
                          {Number(s.quantity)}
                        </span>
                        <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>{s.unit as string}</span>
                      </td>
                      <td className="table-cell text-xs" style={{ color: 'var(--text-3)' }}>{Number(s.min_stock_level) || '—'}</td>
                      <td className="table-cell">
                        <span className={STOCK_STATUS_COLORS[s.stock_status as string] || 'badge-gray'}>
                          {s.stock_status === 'out' ? 'Out of Stock' : s.stock_status === 'low' ? 'Low Stock' : 'In Stock'}
                        </span>
                      </td>
                      <td className="table-cell">
                        <button
                          onClick={() => setRequestItem(s)}
                          className="btn-primary btn-sm gap-1">
                          <ArrowRightLeft size={11} /> Request
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredStock.length === 0 && (
                    <tr><td colSpan={7} className="py-16 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                      {stockSearch || stockFilter !== 'all' ? 'No items match the filter' : 'No stock data for this branch'}
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Transfer Requests ───────────────────────────────────────── */}
      {tab === 'requests' && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-2 px-6 py-3 border-b flex-shrink-0 overflow-x-auto" style={{ borderColor: 'var(--border)' }}>
            {[{ v: '', l: 'All' }, ...TRANSFER_PIPELINE.map(p => ({ v: p.status, l: p.label }))].map(({ v, l }) => (
              <button key={v} onClick={() => setTfFilter(v)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-all ${
                  tfFilter === v ? 'bg-blue-600 text-white' : 'bg-[var(--bg-soft)] text-[var(--text-3)]'
                }`}>{l}</button>
            ))}
            <button onClick={loadTransfers} className="btn-ghost btn-sm gap-1 ml-2 shrink-0">
              <RefreshCw size={12} />
            </button>
          </div>

          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
                <tr>
                  {['#', 'Product', 'From → To', 'Qty', 'Status', 'Date', 'Notes', ''].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {transfers.map(tf => {
                  const meta = getPipelineMeta(String(tf.status))
                  const next = nextStatus(String(tf.status))
                  const isMyRequest = String(tf.to_branch_id) === userBranchId || String(tf.from_branch_id) === userBranchId
                  return (
                    <tr key={String(tf.id)} className={`table-row ${isMyRequest ? 'bg-blue-500/3' : ''}`}>
                      <td className="table-cell font-mono text-xs text-blue-400">{String(tf.transfer_number)}</td>
                      <td className="table-cell">
                        <p className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{String(tf.product_name)}</p>
                        <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{String(tf.sku)}</p>
                      </td>
                      <td className="table-cell text-xs">
                        <div className="flex items-center gap-1" style={{ color: 'var(--text-2)' }}>
                          <span className="font-medium">{String(tf.from_branch_name)}</span>
                          <ChevronRight size={11} style={{ color: 'var(--text-3)' }} />
                          <span className="font-medium text-blue-400">{String(tf.to_branch_name)}</span>
                        </div>
                      </td>
                      <td className="table-cell font-bold" style={{ color: 'var(--text-1)' }}>{Number(tf.quantity)}</td>
                      <td className="table-cell">
                        <span className={`${meta.cls} flex items-center gap-1 w-fit`}>
                          {meta.icon}{meta.label}
                        </span>
                      </td>
                      <td className="table-cell text-xs" style={{ color: 'var(--text-3)' }}>
                        {tf.initiated_at ? new Date(String(tf.initiated_at)).toLocaleDateString() : '—'}
                      </td>
                      <td className="table-cell text-xs max-w-[120px] truncate" style={{ color: 'var(--text-3)' }}>
                        {(tf.notes as string) || '—'}
                      </td>
                      <td className="table-cell">
                        <div className="flex items-center gap-1.5">
                          <button onClick={() => setSelectedTf(tf)} className="btn-ghost btn-sm gap-1">
                            <Eye size={12} /> View
                          </button>
                          {next && (isAdmin || (next === 'received' && String(tf.to_branch_id) === userBranchId)) && (
                            <button
                              onClick={() => {
                                if (next === 'dispatched' || next === 'received' || next === 'partially_received' || next === 'discrepancy') {
                                  setSelectedTf(tf)
                                } else {
                                  handleAdvanceTransfer(tf, next)
                                }
                              }}
                              className="btn-primary btn-sm gap-1 capitalize whitespace-nowrap">
                              {next === 'approved' ? '✓ Approve' :
                               next === 'dispatched' ? '🚚 Dispatch' :
                               next === 'received' ? '✓ Receive' :
                               next.replace(/_/g, ' ')}
                            </button>
                          )}
                          {String(tf.status) === 'pending_approval' && isAdmin && (
                            <button
                              onClick={() => {
                                const reason = prompt('Reject reason:')
                                if (reason) handleAdvanceTransfer(tf, 'rejected', { reject_reason: reason })
                              }}
                              className="btn-danger btn-sm">Reject</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {transfers.length === 0 && (
                  <tr><td colSpan={8} className="py-16 text-center text-sm" style={{ color: 'var(--text-3)' }}>
                    No transfers found
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Tab: All Branches (admin only) ──────────────────────────────── */}
      {tab === 'branches' && !drillBranch && (
        <div className="flex-1 overflow-auto p-6">
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {branchStats.map(b => (
              <div key={String(b.id)} className="card cursor-pointer hover:shadow-lg transition-shadow"
                onClick={() => drillIntoBranch(b)}>
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{String(b.name)}</p>
                    <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{String(b.code || '')}</p>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--text-3)' }} />
                </div>
                {(b.address as string) && (
                  <p className="text-xs flex items-center gap-1 mb-3" style={{ color: 'var(--text-3)' }}>
                    <MapPin size={10} />{String(b.address).slice(0, 40)}
                  </p>
                )}
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg py-2 px-1" style={{ background: 'var(--bg-soft)' }}>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{Number(b.product_count)}</p>
                    <p style={{ color: 'var(--text-3)' }}>SKUs</p>
                  </div>
                  <div className="rounded-lg py-2 px-1" style={{ background: 'var(--bg-soft)' }}>
                    <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{Number(b.total_units).toLocaleString()}</p>
                    <p style={{ color: 'var(--text-3)' }}>Units</p>
                  </div>
                </div>
                <div className="flex gap-2 mt-3">
                  {Number(b.out_of_stock_count) > 0 && (
                    <span className="badge-red text-xs">{Number(b.out_of_stock_count)} Out</span>
                  )}
                  {Number(b.low_stock_count) > 0 && (
                    <span className="badge-yellow text-xs">{Number(b.low_stock_count)} Low</span>
                  )}
                  {Number(b.pending_requests) > 0 && (
                    <span className="badge-blue text-xs">{Number(b.pending_requests)} Pending</span>
                  )}
                  {Number(b.in_transit_count) > 0 && (
                    <span className="badge-purple text-xs">{Number(b.in_transit_count)} Transit</span>
                  )}
                </div>
                <div className="mt-2 pt-2 border-t flex justify-between text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                  <span>Value</span>
                  <span className="font-medium" style={{ color: 'var(--text-2)' }}>{fmt(b.total_value)}</span>
                </div>
              </div>
            ))}
            {branchStats.length === 0 && (
              <div className="col-span-full text-center py-20" style={{ color: 'var(--text-3)' }}>
                <Layers size={36} className="mx-auto mb-3 opacity-30" />
                <p>No branches found</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Branch drill-down */}
      {tab === 'branches' && drillBranch && (
        <div className="flex flex-col flex-1 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
            <button onClick={() => setDrillBranch(null)} className="btn-ghost btn-sm gap-1">
              ← Back
            </button>
            <Building2 size={16} className="text-blue-400" />
            <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{String(drillBranch.name)}</span>
            <span className="badge-blue">{drillStock.length} SKUs</span>
            <span className="badge-red">{drillStock.filter(s => s.stock_status === 'out').length} Out</span>
            <span className="badge-yellow">{drillStock.filter(s => s.stock_status === 'low').length} Low</span>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="w-full">
              <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
                <tr>
                  {['Product', 'SKU', 'Qty', 'Min', 'Status', 'Value', ''].map(h => (
                    <th key={h} className="table-header">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {drillStock.map(s => (
                  <tr key={String(s.id)} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-2">
                        {(s.image_url as string) ? (
                          <img src={s.image_url as string} alt="" className="w-7 h-7 rounded object-cover border" style={{ borderColor: 'var(--border)' }} />
                        ) : <Package size={14} style={{ color: 'var(--text-3)' }} />}
                        <span className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{s.product_name as string}</span>
                      </div>
                    </td>
                    <td className="table-cell font-mono text-xs text-blue-400">{s.sku as string}</td>
                    <td className="table-cell font-bold" style={{ color: Number(s.quantity) === 0 ? '#ef4444' : Number(s.quantity) <= Number(s.min_stock_level) ? '#eab308' : '#22c55e' }}>
                      {Number(s.quantity)} <span className="font-normal text-xs" style={{ color: 'var(--text-3)' }}>{s.unit as string}</span>
                    </td>
                    <td className="table-cell text-xs" style={{ color: 'var(--text-3)' }}>{Number(s.min_stock_level) || '—'}</td>
                    <td className="table-cell"><span className={STOCK_STATUS_COLORS[s.stock_status as string] || 'badge-gray'}>
                      {s.stock_status === 'out' ? 'Out' : s.stock_status === 'low' ? 'Low' : 'OK'}
                    </span></td>
                    <td className="table-cell text-xs" style={{ color: 'var(--text-2)' }}>{fmt(Number(s.quantity) * Number(s.cost_price))}</td>
                    <td className="table-cell">
                      <button onClick={() => setRequestItem({ ...s, _toBranchId: drillBranch.id })} className="btn-secondary btn-sm gap-1">
                        <ArrowRightLeft size={11} /> Transfer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {(requestItem || showNewRequest) && (
        <StockRequestModal
          item={requestItem}
          branches={branches}
          defaultToBranchId={String(requestItem?._toBranchId || userBranchId)}
          defaultFromBranchId={branches.find(b => b.id !== userBranchId)?.id || ''}
          onClose={() => { setRequestItem(null); setShowNewRequest(false) }}
          onDone={() => {
            setRequestItem(null); setShowNewRequest(false)
            loadMyStock(); loadTransfers()
            if (isAdmin) loadBranchStats()
            toast.success('Stock request submitted — pending approval')
          }}
        />
      )}

      {selectedTf && (
        <TransferDetailModal
          tf={selectedTf}
          isAdmin={isAdmin}
          userBranchId={userBranchId}
          onClose={() => setSelectedTf(null)}
          onAction={(status, extra) => handleAdvanceTransfer(selectedTf, status, extra)}
        />
      )}
    </div>
  )
}

// ─── Chip ────────────────────────────────────────────────────────────────────
function Chip({ icon, label, value, color, onClick, active }: {
  icon: React.ReactNode; label: string; value: number
  color: string; onClick: () => void; active?: boolean
}) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
        active ? 'border-blue-500 bg-blue-500/10' : 'hover:bg-[var(--bg-soft)]'
      }`}
      style={{ borderColor: active ? undefined : 'var(--border)' }}>
      <span className={color}>{icon}</span>
      <span style={{ color: 'var(--text-2)' }}>{label}</span>
      <span className={`font-bold text-sm ${color}`}>{value}</span>
    </button>
  )
}

// ─── Stock Request Modal ─────────────────────────────────────────────────────
function StockRequestModal({ item, branches, defaultToBranchId, defaultFromBranchId, onClose, onDone }: {
  item: StockItem | null
  branches: Record<string, string>[]
  defaultToBranchId: string
  defaultFromBranchId: string
  onClose: () => void
  onDone: () => void
}) {
  const [productId, setProductId]   = useState(item ? String(item.product_id) : '')
  const [products, setProducts]     = useState<Record<string, unknown>[]>([])
  const [fromBranch, setFromBranch] = useState(defaultFromBranchId)
  const [toBranch, setToBranch]     = useState(defaultToBranchId)
  const [qty, setQty]               = useState(1)
  const [notes, setNotes]           = useState('')
  const [availability, setAvailability] = useState<Record<string, unknown>[]>([])
  const [saving, setSaving]         = useState(false)

  useEffect(() => {
    window.api.products.list({ is_active: true }).then((r: {success:boolean;data:unknown}) => {
      if (r.success) setProducts(r.data as Record<string, unknown>[])
    })
  }, [])

  useEffect(() => {
    if (!productId) { setAvailability([]); return }
    window.api.stocks.availability(productId).then((r: {success:boolean;data:unknown}) => {
      if (r.success) setAvailability(r.data as Record<string, unknown>[])
    })
  }, [productId])

  const sourceStock = availability.find(a => String(a.branch_id) === fromBranch)
  const available = Number(sourceStock?.available_quantity || 0)

  const save = async () => {
    if (!productId || !fromBranch || !toBranch || fromBranch === toBranch) {
      toast.error('Fill all required fields — source and destination branches must differ')
      return
    }
    if (qty <= 0) { toast.error('Enter a valid quantity'); return }
    if (available > 0 && qty > available) {
      toast.error(`Only ${available} unit(s) available at the source branch`)
      return
    }
    setSaving(true)
    const res = await window.api.stocks.transfer({
      product_id: productId,
      from_branch_id: fromBranch,
      to_branch_id: toBranch,
      quantity: qty,
      notes: notes || `Stock request from branch`,
    })
    setSaving(false)
    if (res.success) onDone()
    else toast.error(res.error || 'Failed to submit request')
  }

  return (
    <Modal
      title={item ? `Request: ${String(item.product_name)}` : 'New Stock Request'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving || (available > 0 && qty > available)} className="btn-primary gap-1">
            <ArrowRightLeft size={13} /> {saving ? 'Submitting…' : 'Submit Request'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        {!item && (
          <div>
            <label className="label">Product *</label>
            <select value={productId} onChange={e => setProductId(e.target.value)} className="input">
              <option value="">Select product…</option>
              {products.map(p => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.name)} — {String(p.sku)}</option>
              ))}
            </select>
          </div>
        )}

        {item && (
          <div className="card flex items-center gap-3">
            {(item.image_url as string) ? (
              <img src={item.image_url as string} alt="" className="w-12 h-12 rounded object-cover" />
            ) : <Package size={20} style={{ color: 'var(--text-3)' }} />}
            <div>
              <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{item.product_name as string}</p>
              <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{item.sku as string}</p>
              <p className="text-xs mt-0.5">Current stock: <strong className="text-yellow-400">{Number(item.quantity)}</strong></p>
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Request From (Source) *</label>
            <select value={fromBranch} onChange={e => setFromBranch(e.target.value)} className="input">
              <option value="">Select source branch…</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            {fromBranch && (
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Available: <strong className={available > 0 ? 'text-green-400' : 'text-red-400'}>{available}</strong>
              </p>
            )}
          </div>
          <div>
            <label className="label">Send To (Destination) *</label>
            <select value={toBranch} onChange={e => setToBranch(e.target.value)} className="input">
              <option value="">Select destination…</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        </div>

        {/* Cross-branch availability */}
        {availability.length > 0 && (
          <div>
            <p className="label">Stock Across All Branches</p>
            <div className="grid grid-cols-2 gap-2">
              {availability.map(a => (
                <div key={String(a.branch_id)}
                  onClick={() => setFromBranch(String(a.branch_id))}
                  className={`rounded-lg p-2.5 border cursor-pointer transition-all text-xs ${
                    fromBranch === String(a.branch_id)
                      ? 'border-blue-500 bg-blue-500/10'
                      : 'border-[var(--border)] hover:bg-[var(--bg-soft)]'
                  }`}>
                  <p className="font-medium" style={{ color: 'var(--text-1)' }}>{a.branch_name as string}</p>
                  <p className={`font-bold text-base ${Number(a.available_quantity) > 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {Number(a.available_quantity)} available
                  </p>
                </div>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label">Quantity to Request *</label>
          <input type="number" value={qty} onChange={e => setQty(Number(e.target.value))} className="input text-xl font-bold text-center"
            min="1" max={available || 9999} />
          {available > 0 && qty > available && (
            <p className="text-xs text-red-400 mt-1">Exceeds available stock ({available})</p>
          )}
        </div>
        <div>
          <label className="label">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="input" placeholder="Reason for request, urgency…" />
        </div>
      </div>
    </Modal>
  )
}

// ─── Transfer Detail Modal ───────────────────────────────────────────────────
function TransferDetailModal({ tf, isAdmin, userBranchId, onClose, onAction }: {
  tf: Transfer; isAdmin: boolean; userBranchId: string
  onClose: () => void; onAction: (status: string, extra?: Record<string,unknown>) => void
}) {
  const [dispatchForm, setDispatchForm] = useState({ driver_name: '', driver_phone: '', vehicle_number: '' })
  const [receivedQty, setReceivedQty]   = useState(Number(tf.quantity))
  const [damagedQty, setDamagedQty]     = useState(0)
  const [note, setNote]                 = useState('')
  const meta = getPipelineMeta(String(tf.status))

  const status = String(tf.status)
  const isToBranch   = String(tf.to_branch_id) === userBranchId
  const isFromBranch = String(tf.from_branch_id) === userBranchId

  return (
    <Modal title={`Transfer ${String(tf.transfer_number)}`} onClose={onClose}
      footer={<button onClick={onClose} className="btn-secondary">Close</button>}>
      <div className="space-y-4">
        {/* Status pipeline */}
        <div className="flex items-center gap-1 overflow-x-auto pb-1">
          {['pending_approval','approved','dispatched','in_transit','received'].map((s, i, arr) => {
            const m = getPipelineMeta(s)
            const isDone = PIPELINE_ORDER.indexOf(status) >= PIPELINE_ORDER.indexOf(s)
            const isCurrent = status === s
            return (
              <div key={s} className="flex items-center gap-1 shrink-0">
                <div className={`flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium border ${
                  isCurrent ? 'border-blue-500 bg-blue-500/15 text-blue-400' :
                  isDone    ? 'border-green-500/40 bg-green-500/10 text-green-400' :
                              'border-[var(--border)]'
                }`} style={!isCurrent && !isDone ? { color: 'var(--text-3)' } : {}}>
                  {isDone && !isCurrent ? <CheckCircle2 size={10} /> : m.icon}
                  <span className="hidden sm:inline">{m.label}</span>
                </div>
                {i < arr.length - 1 && <ChevronRight size={12} style={{ color: 'var(--text-3)' }} />}
              </div>
            )
          })}
        </div>

        {/* Details */}
        <div className="grid grid-cols-2 gap-3 text-sm">
          <InfoCell label="Product"  value={`${String(tf.product_name)} (${String(tf.sku)})`} />
          <InfoCell label="Quantity"  value={String(Number(tf.quantity))} />
          <InfoCell label="From"      value={String(tf.from_branch_name)} />
          <InfoCell label="To"        value={String(tf.to_branch_name)} />
          <InfoCell label="Status"    value={meta.label} />
          <InfoCell label="Date"      value={tf.initiated_at ? new Date(String(tf.initiated_at)).toLocaleString() : '—'} />
          {(tf.notes as string) && <InfoCell label="Notes" value={String(tf.notes)} className="col-span-2" />}
          {(tf.driver_name as string) && <InfoCell label="Driver" value={`${String(tf.driver_name)} | ${String(tf.driver_phone)} | ${String(tf.vehicle_number)}`} className="col-span-2" />}
          {(tf.reject_reason as string) && <InfoCell label="Reject Reason" value={String(tf.reject_reason)} className="col-span-2 text-red-400" />}
        </div>

        {/* Action forms */}
        {status === 'pending_approval' && isAdmin && (
          <div className="rounded-xl p-4 border border-green-500/30 bg-green-500/5 space-y-3">
            <p className="font-semibold text-sm text-green-400">Approve this request?</p>
            <div className="flex gap-2">
              <button onClick={() => onAction('approved')} className="btn-success flex-1">✓ Approve</button>
              <button onClick={() => {
                const r = prompt('Reject reason:')
                if (r) onAction('rejected', { reject_reason: r })
              }} className="btn-danger flex-1">✗ Reject</button>
            </div>
          </div>
        )}

        {status === 'approved' && (isAdmin || isFromBranch) && (
          <div className="rounded-xl p-4 border space-y-3" style={{ borderColor: 'var(--border)' }}>
            <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Dispatch Details (optional)</p>
            <div className="grid grid-cols-3 gap-2">
              <input placeholder="Driver name" value={dispatchForm.driver_name}
                onChange={e => setDispatchForm(p => ({ ...p, driver_name: e.target.value }))} className="input text-sm" />
              <input placeholder="Driver phone" value={dispatchForm.driver_phone}
                onChange={e => setDispatchForm(p => ({ ...p, driver_phone: e.target.value }))} className="input text-sm" />
              <input placeholder="Vehicle no." value={dispatchForm.vehicle_number}
                onChange={e => setDispatchForm(p => ({ ...p, vehicle_number: e.target.value }))} className="input text-sm" />
            </div>
            <button onClick={() => onAction('dispatched', dispatchForm)} className="btn-primary w-full gap-1.5">
              <Truck size={14} /> Mark Ready / Dispatched
            </button>
          </div>
        )}

        {(status === 'dispatched' || status === 'in_transit') && isToBranch && (
          <div className="rounded-xl p-4 border border-blue-500/30 bg-blue-500/5 space-y-3">
            <p className="font-semibold text-sm text-blue-400">Receive Stock</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="label">Received Qty</label>
                <input type="number" value={receivedQty} onChange={e => setReceivedQty(Number(e.target.value))}
                  className="input" min="0" max={Number(tf.quantity)} />
              </div>
              <div>
                <label className="label">Damaged Qty</label>
                <input type="number" value={damagedQty} onChange={e => setDamagedQty(Number(e.target.value))}
                  className="input" min="0" />
              </div>
            </div>
            <div className="flex gap-2">
              <button onClick={() => onAction('received', { received_quantity: Number(tf.quantity), damaged_quantity: damagedQty })}
                className="btn-success flex-1">✓ Fully Received</button>
              {receivedQty < Number(tf.quantity) && (
                <button onClick={() => onAction('partially_received', { received_quantity: receivedQty, damaged_quantity: damagedQty })}
                  className="btn-secondary flex-1">Partial</button>
              )}
            </div>
            <div>
              <label className="label">Discrepancy note</label>
              <div className="flex gap-2">
                <input value={note} onChange={e => setNote(e.target.value)} className="input flex-1" placeholder="Describe issue…" />
                <button onClick={() => onAction('discrepancy', { discrepancy_note: note, received_quantity: receivedQty })}
                  disabled={!note} className="btn-danger shrink-0">Flag</button>
              </div>
            </div>
          </div>
        )}
      </div>
    </Modal>
  )
}

function InfoCell({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className={className}>
      <p className="text-xs mb-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
  )
}
