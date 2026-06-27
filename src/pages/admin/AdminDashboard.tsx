import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { ShoppingBag, TrendingUp, AlertCircle, Package, CreditCard, Truck, RefreshCw, Building2, ShieldCheck, Warehouse, Wifi } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'

interface RevenueData { today: { revenue: number; invoices: number }; month: { revenue: number; invoices: number }; outstanding: { total: number } }
interface SalesData { date: string; total_revenue: number; total_invoices: number }

export default function AdminDashboard() {
  const [revenue, setRevenue]         = useState<RevenueData | null>(null)
  const [salesData, setSalesData]     = useState<SalesData[]>([])
  const [topProducts, setTopProducts] = useState<Record<string,unknown>[]>([])
  const [lowStock, setLowStock]       = useState<Record<string,unknown>[]>([])
  const [loading, setLoading]         = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [rev, sales, top, low] = await Promise.all([
        window.api.analytics.revenue({}),
        window.api.analytics.salesSummary({}),
        window.api.analytics.topProducts({ limit: 5 }),
        window.api.stocks.lowStock()
      ])
      if (rev.success)  setRevenue(rev.data as RevenueData)
      if (sales.success) setSalesData((sales.data as SalesData[]).slice(0, 14).reverse())
      if (top.success)  setTopProducts(top.data as Record<string,unknown>[])
      if (low.success)  setLowStock(low.data as Record<string,unknown>[])
    } finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Dashboard"
        subtitle="Branch performance overview"
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary btn-sm gap-1.5">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />
      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        {/* Stats */}
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Today's Revenue" value={`Rs.${(revenue?.today?.revenue || 0).toLocaleString()}`} sub={`${revenue?.today?.invoices || 0} invoices`} icon={TrendingUp} color="green" />
          <StatCard label="Monthly Revenue" value={`Rs.${(revenue?.month?.revenue || 0).toLocaleString()}`} sub={`${revenue?.month?.invoices || 0} invoices`} icon={ShoppingBag} color="blue" />
          <StatCard label="Outstanding Due" value={`Rs.${(revenue?.outstanding?.total || 0).toLocaleString()}`} sub="Unpaid balances" icon={CreditCard} color="yellow" />
          <StatCard label="Low Stock Alerts" value={lowStock.length} sub="Items need restocking" icon={AlertCircle} color="red" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
          <div className="card xl:col-span-2">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Enterprise Control Center</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Branch operations, approvals, stock health, and cashier activity</p>
              </div>
              <span className="badge-blue">Head Office View</span>
            </div>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              {[
                { label: 'Branch Monitor', value: 'Active', icon: Building2, color: 'text-blue-400' },
                { label: 'Transfer Approvals', value: lowStock.length ? `${Math.min(lowStock.length, 9)} attention` : 'Clear', icon: Warehouse, color: 'text-amber-400' },
                { label: 'Role Controls', value: 'RBAC Ready', icon: ShieldCheck, color: 'text-emerald-400' },
                { label: 'Sync Readiness', value: 'Local-first', icon: Wifi, color: 'text-cyan-400' },
              ].map(item => {
                const Icon = item.icon
                return (
                  <div key={item.label} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                    <Icon size={17} className={item.color} />
                    <p className="text-xs mt-3" style={{ color: 'var(--text-3)' }}>{item.label}</p>
                    <p className="text-sm font-semibold mt-1" style={{ color: 'var(--text-1)' }}>{item.value}</p>
                  </div>
                )
              })}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-sm mb-4 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Truck size={15} className="text-blue-400" /> Branch Workflow
            </h3>
            <div className="space-y-3">
              {['Stock requests', 'Manager approvals', 'Warehouse receiving', 'Cashier billing'].map((step, i) => (
                <div key={step} className="flex items-center gap-3">
                  <span className="w-6 h-6 rounded-full bg-blue-500/10 text-blue-400 flex items-center justify-center text-xs font-bold">{i + 1}</span>
                  <span className="text-sm" style={{ color: 'var(--text-2)' }}>{step}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Charts */}
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Revenue - Last 14 Days</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={v => `${(v/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} formatter={(v) => [`Rs.${Number(v).toLocaleString()}`, 'Revenue']} />
                <Line type="monotone" dataKey="total_revenue" stroke="#6366f1" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Daily Invoices</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} />
                <Bar dataKey="total_invoices" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          {/* Top products */}
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Top Products</h3>
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.product_id as string} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 w-4">#{i+1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate" style={{ color: 'var(--text-1)' }}>{p.name as string}</p>
                    <p className="text-xs text-slate-500 font-mono">{p.sku as string}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-brand-400">Rs.{Number(p.total_revenue).toLocaleString()}</p>
                    <p className="text-xs text-slate-500">{p.total_qty as number} sold</p>
                  </div>
                </div>
              ))}
              {topProducts.length === 0 && <p className="text-sm" style={{ color: 'var(--text-3)' }}>No sales data yet</p>}
            </div>
          </div>

          {/* Low stock */}
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <AlertCircle size={14} className="text-red-400" /> Low Stock Alerts
            </h3>
            <div className="space-y-2">
              {lowStock.slice(0, 8).map((s) => (
                <div key={s.id as string} className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'var(--text-1)' }}>{s.product_name as string}</p>
                    <p className="text-xs text-slate-500 font-mono">{s.sku as string}</p>
                  </div>
                  <div className="text-right ml-4 flex-shrink-0">
                    <span className={`badge-red text-xs`}>{s.quantity as number} left</span>
                    <p className="text-xs text-slate-500">Min: {s.min_stock_level as number}</p>
                  </div>
                </div>
              ))}
              {lowStock.length === 0 && <p className="text-sm" style={{ color: 'var(--text-3)' }}>All stock levels OK</p>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
