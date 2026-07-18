import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import PageHeader from '@/components/shared/PageHeader'
import StatCard from '@/components/shared/StatCard'
import { TrendingUp, ShoppingBag, Users, Package, FileSpreadsheet, FileText, DollarSign, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'


export default function AnalyticsPage() {
  const [salesData, setSalesData]         = useState<Record<string,unknown>[]>([])
  const [topProducts, setTopProducts]     = useState<Record<string,unknown>[]>([])
  const [branchPerf, setBranchPerf]       = useState<Record<string,unknown>[]>([])
  const [revenue, setRevenue]             = useState<Record<string,unknown> | null>(null)
  const [profit, setProfit]               = useState<Record<string,unknown> | null>(null)
  const [dateFrom, setDateFrom]           = useState(new Date(Date.now()-30*86400000).toISOString().slice(0,10))
  const [dateTo, setDateTo]               = useState(new Date().toISOString().slice(0,10))

  const load = async () => {
    try {
      const [s, t, b, r, p] = await Promise.all([
        window.api.analytics.salesSummary({ date_from: dateFrom, date_to: dateTo }),
        window.api.analytics.topProducts({ limit: 8 }),
        window.api.analytics.branchPerformance({}),
        window.api.analytics.revenue({}),
        window.api.analytics.profitSummary({ date_from: dateFrom, date_to: dateTo }),
      ])
      if (s.success) setSalesData((s.data as Record<string,unknown>[]).reverse())
      if (t.success) setTopProducts(t.data as Record<string,unknown>[])
      if (b.success) setBranchPerf(b.data as Record<string,unknown>[])
      if (r.success) setRevenue(r.data as Record<string,unknown>)
      if (p.success) setProfit(p.data as Record<string,unknown>)
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load analytics data')
    }
  }

  useEffect(() => { load() }, [dateFrom, dateTo])

  const rev = revenue as Record<string, Record<string, number>> | null
  const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

  const exportExcel = async () => {
    const filename = `analytics-report-${dateFrom}-to-${dateTo}`
    try {
    const res = await window.api.reports.exportExcel({
      filename,
      sheets: [
        {
          name: 'Profit & Loss Summary',
          rows: [{
            'Date Range': `${dateFrom} to ${dateTo}`,
            'Sales Total': profit?.sales_total || 0,
            'Buy Price (COGS)': profit?.cogs || 0,
            'Net Profit': profit?.net_profit || 0,
            'Profit Margin %': profit?.sales_total ? (Number(profit?.net_profit || 0) / Number(profit?.sales_total || 1) * 100).toFixed(1) : 0,
            'Installments Given': profit?.installment_given || 0,
            'Installment Contracts': profit?.installment_contracts || 0,
            'Installments Pending': profit?.installment_pending || 0,
          }],
        },
        {
          name: 'Daily Revenue',
          rows: salesData.map(r => ({
            Date: r.date,
            'Total Revenue': r.total_revenue,
            'Invoice Count': r.invoice_count,
          })),
        },
        {
          name: 'Top Products',
          rows: topProducts.map(r => ({
            Product: r.name,
            'Units Sold': r.total_quantity,
            'Revenue': r.total_revenue,
          })),
        },
        {
          name: 'Branch Performance',
          rows: branchPerf.map(r => ({
            Branch: r.branch_name,
            'Total Revenue': r.total_revenue,
            'Invoices': r.total_invoices,
            'Avg Invoice': r.avg_invoice_value,
          })),
        },
      ],
    }) as { success: boolean; filePath?: string; cancelled?: boolean; error?: string }
    if (res.success) {
      toast.success('Excel report saved!')
      if (res.filePath) window.api.reports.openFile(res.filePath).catch(() => toast.error('Failed to open file'))
    } else if (!res.cancelled) {
      toast.error(res.error || 'Export failed')
    }
    } catch (err) {
      toast.error((err as Error)?.message || 'Export failed')
    }
  }

  const exportPdf = async () => {
    const filename = `analytics-report-${dateFrom}-to-${dateTo}`
    try {
    const res = await window.api.reports.exportPdf({
      filename,
      title: 'Analytics Report',
      metadata: { 'Date Range': `${dateFrom} to ${dateTo}`, 'Generated Time': new Date().toLocaleString() },
      summary: [
        ['Sales Total', profit?.sales_total],
        ['Buy Price (COGS)', profit?.cogs],
        ['Net Profit', profit?.net_profit],
        ['Outstanding', rev?.outstanding?.total],
        ['Installments Given', profit?.installment_given],
        ['Installments Pending', profit?.installment_pending],
      ],
      sections: [
        {
          title: 'Daily Revenue',
          rows: salesData.map(r => ({
            Date: r.date,
            'Total Revenue': r.total_revenue,
            'Invoice Count': r.invoice_count,
          })),
        },
        {
          title: 'Top Products',
          rows: topProducts.map(r => ({
            Product: r.name,
            'Units Sold': r.total_quantity,
            'Revenue': r.total_revenue,
          })),
        },
        {
          title: 'Branch Performance',
          rows: branchPerf.map(r => ({
            Branch: r.branch_name,
            'Total Revenue': r.total_revenue,
            'Invoices': r.total_invoices,
            'Avg Invoice': r.avg_invoice_value,
          })),
        },
      ],
    }) as { success: boolean; filePath?: string; cancelled?: boolean; error?: string }
    if (res.success) {
      toast.success('PDF report saved!')
      if (res.filePath) window.api.reports.openFile(res.filePath).catch(() => toast.error('Failed to open file'))
    } else if (!res.cancelled) {
      toast.error(res.error || 'Export failed')
    }
    } catch (err) {
      toast.error((err as Error)?.message || 'Export failed')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Analytics" subtitle="Sales performance & insights"
        actions={
          <div className="flex gap-2 items-center flex-wrap">
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input py-1.5 text-sm" />
            <span className="text-slate-500 text-sm">to</span>
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input py-1.5 text-sm" />
            <div className="flex gap-1 ml-1">
              <button onClick={exportExcel} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-green-600 hover:bg-green-700 transition-colors" title="Export to Excel">
                <FileSpreadsheet size={13} />Excel
              </button>
              <button onClick={exportPdf} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white bg-red-600 hover:bg-red-700 transition-colors" title="Export to PDF">
                <FileText size={13} />PDF
              </button>
            </div>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Today Revenue" value={`Rs.${(rev?.today?.revenue || 0).toLocaleString()}`} sub={`${rev?.today?.invoices || 0} invoices`} icon={TrendingUp} color="green" />
          <StatCard label="Month Revenue" value={`Rs.${(rev?.month?.revenue || 0).toLocaleString()}`} sub={`${rev?.month?.invoices || 0} invoices`} icon={ShoppingBag} color="blue" />
          <StatCard label="Avg Invoice" value={rev?.month?.invoices ? `Rs.${((rev?.month?.revenue || 0) / (rev?.month?.invoices || 1)).toLocaleString(undefined, {maximumFractionDigits:0})}` : '—'} icon={Package} color="purple" />
          <StatCard label="Outstanding" value={`Rs.${(rev?.outstanding?.total || 0).toLocaleString()}`} icon={Users} color="yellow" />
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
          <StatCard label="Net Profit (selected range)" value={`Rs.${money(profit?.net_profit)}`} sub={`Sales Rs.${money(profit?.sales_total)} − Buy Price Rs.${money(profit?.cogs)}`} icon={DollarSign} color="green" />
          <StatCard label="Installments Given (range)" value={`Rs.${money(profit?.installment_given)}`} sub={`${profit?.installment_contracts || 0} contracts`} icon={CreditCard} color="blue" />
          <StatCard label="Installments Pending" value={`Rs.${money(profit?.installment_pending)}`} sub="Still to be collected" icon={CreditCard} color="yellow" />
          <StatCard label="Profit Margin" value={profit?.sales_total ? `${(Number(profit?.net_profit || 0) / Number(profit?.sales_total || 1) * 100).toFixed(1)}%` : '—'} sub="Net profit ÷ sales" icon={TrendingUp} color="purple" />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold text-sm mb-4">Daily Revenue</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={salesData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="date" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={d => (d as string).slice(5)} />
                <YAxis stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v)/1000).toFixed(0)}k`} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} formatter={(v) => [`Rs.${Number(v).toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="total_revenue" fill="#6366f1" radius={[4,4,0,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="card">
            <h3 className="font-semibold text-sm mb-4">Top Products by Revenue</h3>
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={topProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis type="number" stroke="#64748b" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v)/1000).toFixed(0)}k`} />
                <YAxis dataKey="name" type="category" stroke="#64748b" tick={{ fontSize: 10 }} width={90} tickFormatter={(v: string) => v.length > 12 ? v.slice(0,12)+'...' : v} />
                <Tooltip contentStyle={{ background: '#1e293b', border: '1px solid #334155', borderRadius: 8 }} formatter={(v) => [`Rs.${Number(v).toLocaleString()}`, 'Revenue']} />
                <Bar dataKey="total_revenue" fill="#22c55e" radius={[0,4,4,0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Branch performance */}
        <div className="card">
          <h3 className="font-semibold text-sm mb-4">Branch Performance</h3>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr>
                {['Branch', 'Total Revenue', 'Invoices', 'Avg Invoice Value'].map(h => <th key={h} className="table-header px-4 py-2 text-left">{h}</th>)}
              </tr></thead>
              <tbody>
                {branchPerf.map(b => (
                  <tr key={b.branch_id as string} className="table-row">
                    <td className="table-cell font-medium">{b.branch_name as string}</td>
                    <td className="table-cell text-brand-400 font-semibold">Rs.{Number(b.total_revenue || 0).toLocaleString()}</td>
                    <td className="table-cell">{b.total_invoices as number}</td>
                    <td className="table-cell text-slate-400">Rs.{Number(b.avg_invoice_value || 0).toLocaleString(undefined, {maximumFractionDigits: 0})}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  )
}
