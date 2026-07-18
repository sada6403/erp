import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts'
import { ArrowLeft, TrendingUp, ShoppingBag, CreditCard, AlertCircle, RefreshCw, Users } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import toast from 'react-hot-toast'

interface RevenueData { today: { revenue: number; invoices: number }; month: { revenue: number; invoices: number }; outstanding: { total: number } }
interface ProfitData { net_profit: number }
interface SalesData { date: string; total_revenue: number; total_invoices: number }
interface CashierSale { cashier_name: string | null; invoice_count: number; sales_total: number; paid_total: number; balance_total: number }
interface RecentTx { id: string; invoice_number: string; status: string; total_amount: number; due_amount: number; customer_name: string | null; cashier_name: string | null; created_at: string }

export default function BranchInspectDetailPage() {
  const { branchId } = useParams<{ branchId: string }>()
  const navigate = useNavigate()

  const [branchName, setBranchName] = useState('')
  const [revenue, setRevenue] = useState<RevenueData | null>(null)
  const [todayProfit, setTodayProfit] = useState<ProfitData | null>(null)
  const [monthProfit, setMonthProfit] = useState<ProfitData | null>(null)
  const [salesData, setSalesData] = useState<SalesData[]>([])
  const [topProducts, setTopProducts] = useState<Record<string, unknown>[]>([])
  const [lowStock, setLowStock] = useState<Record<string, unknown>[]>([])
  const [cashierSales, setCashierSales] = useState<CashierSale[]>([])
  const [recentTx, setRecentTx] = useState<RecentTx[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    if (!branchId) return
    setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const monthStart = `${today.slice(0, 7)}-01`
      const [branches, rev, sales, top, low, profitToday, profitMonth, advanced, tx] = await Promise.all([
        window.api.admin.branches.list(),
        window.api.analytics.revenue({ branch_id: branchId }),
        window.api.analytics.salesSummary({ branch_id: branchId }),
        window.api.analytics.topProducts({ branch_id: branchId, limit: 5 }),
        window.api.stocks.lowStock(branchId),
        window.api.analytics.profitSummary({ branch_id: branchId, date_from: today, date_to: today }),
        window.api.analytics.profitSummary({ branch_id: branchId, date_from: monthStart, date_to: today }),
        window.api.reports.advancedSummary({ branchId, dateFrom: monthStart, dateTo: today }),
        window.api.reports.transactions({ branchId, limit: 20 }),
      ])

      if (branches.success) {
        const b = (branches.data as Record<string, unknown>[]).find(x => x.id === branchId)
        setBranchName(b ? String(b.name) : 'Branch')
      }
      if (rev.success) setRevenue(rev.data as RevenueData)
      if (sales.success) setSalesData((sales.data as SalesData[]).slice(0, 14).reverse())
      if (top.success) setTopProducts(top.data as Record<string, unknown>[])
      if (low.success) setLowStock(low.data as Record<string, unknown>[])
      if (profitToday.success) setTodayProfit(profitToday.data as ProfitData)
      if (profitMonth.success) setMonthProfit(profitMonth.data as ProfitData)
      if (advanced.success) setCashierSales((advanced.data as { cashierSales: CashierSale[] }).cashierSales || [])
      if (tx.success) setRecentTx(tx.data as RecentTx[])

      const failed = [branches, rev, sales, top, low, profitToday, profitMonth, advanced, tx].find(r => !r.success)
      if (failed) toast.error(failed.error || 'Some branch data failed to load')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load branch details')
    } finally {
      setLoading(false)
    }
  }, [branchId])

  useEffect(() => { load() }, [load])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title={branchName || 'Branch Inspect'}
        subtitle="Live branch performance overview"
        actions={
          <div className="flex items-center gap-2">
            <button onClick={() => navigate('/admin/branch-inspect')} className="btn-secondary btn-sm gap-1.5">
              <ArrowLeft size={14} /> Back
            </button>
            <button onClick={load} disabled={loading} className="btn-secondary btn-sm gap-1.5">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Today's Revenue" value={`Rs.${(revenue?.today?.revenue || 0).toLocaleString()}`} sub={`${revenue?.today?.invoices || 0} invoices`} icon={TrendingUp} color="green" />
          <StatCard label="Monthly Revenue" value={`Rs.${(revenue?.month?.revenue || 0).toLocaleString()}`} sub={`${revenue?.month?.invoices || 0} invoices`} icon={ShoppingBag} color="brand" />
          <StatCard label="Today's Profit" value={`Rs.${(todayProfit?.net_profit || 0).toLocaleString()}`} sub="Sales minus cost price" icon={TrendingUp} color="green" />
          <StatCard label="Monthly Profit" value={`Rs.${(monthProfit?.net_profit || 0).toLocaleString()}`} sub="Sales minus cost price" icon={TrendingUp} color="brand" />
          <StatCard label="Outstanding Due" value={`Rs.${(revenue?.outstanding?.total || 0).toLocaleString()}`} sub="Unpaid balances" icon={CreditCard} color="yellow" />
          <StatCard label="Low Stock Alerts" value={lowStock.length} sub="Items need restocking" icon={AlertCircle} color="red" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Revenue — Last 14 Days</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={d => d.slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} formatter={(v) => [`Rs.${Number(v).toLocaleString()}`, 'Revenue']} />
                <Line type="monotone" dataKey="total_revenue" stroke="#2563eb" strokeWidth={2} dot={false} />
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
                <Bar dataKey="total_invoices" fill="#2563eb" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold mb-4 text-sm flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <Users size={14} /> Staff Sales (This Month)
            </h3>
            <div className="space-y-3">
              {cashierSales.map((c, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm truncate" style={{ color: 'var(--text-1)' }}>{c.cashier_name || 'Unassigned'}</p>
                    <p className="text-xs text-slate-500">{c.invoice_count} invoices</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-brand-400">Rs.{Number(c.sales_total).toLocaleString()}</p>
                    {c.balance_total > 0 && <p className="text-xs text-yellow-500">Rs.{Number(c.balance_total).toLocaleString()} due</p>}
                  </div>
                </div>
              ))}
              {cashierSales.length === 0 && <p className="text-sm" style={{ color: 'var(--text-3)' }}>No sales data yet</p>}
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Top Products</h3>
            <div className="space-y-3">
              {topProducts.map((p, i) => (
                <div key={p.product_id as string} className="flex items-center gap-3">
                  <span className="text-xs font-bold text-slate-500 w-4">#{i + 1}</span>
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
        </div>

        <div className="card">
          <h3 className="font-semibold mb-4 text-sm" style={{ color: 'var(--text-1)' }}>Recent Activity</h3>
          <table className="w-full">
            <thead>
              <tr>
                {['Invoice', 'Status', 'Customer', 'Cashier', 'Total', 'Due', 'Date'].map(h => (
                  <th key={h} className="table-header px-3 py-2 text-left text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recentTx.map(t => (
                <tr key={t.id} className="table-row">
                  <td className="table-cell px-3 py-2 font-mono text-xs">{t.invoice_number}</td>
                  <td className="table-cell px-3 py-2 text-xs">{t.status}</td>
                  <td className="table-cell px-3 py-2 text-xs">{t.customer_name || 'Walk-in'}</td>
                  <td className="table-cell px-3 py-2 text-xs">{t.cashier_name || '—'}</td>
                  <td className="table-cell px-3 py-2 text-xs">Rs.{Number(t.total_amount).toLocaleString()}</td>
                  <td className="table-cell px-3 py-2 text-xs">{t.due_amount > 0 ? `Rs.${Number(t.due_amount).toLocaleString()}` : '—'}</td>
                  <td className="table-cell px-3 py-2 text-xs text-slate-500">{new Date(t.created_at).toLocaleString()}</td>
                </tr>
              ))}
              {recentTx.length === 0 && (
                <tr><td colSpan={7} className="text-center py-8 text-sm text-slate-500">No recent activity</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
