import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'
import { colomboToday } from '../../lib/datetime'

const today = () => colomboToday()
const money = (n: unknown) => `Rs.${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`
export default function SupermarketOverview({ view = 'stock' }: { view?: 'stock' | 'investments' }) {
  const { hash } = useLocation()
  const { user } = useAuthStore()
  const u = user as unknown as Record<string, any>
  const perms = u?.role?.permissions || u?.permissions || {}
  const owner = Boolean(perms.all)
  const [data, setData] = useState<Record<string, number> | null>(null)
  const [rows, setRows] = useState<Record<string, unknown>[]>([])
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const load = async () => {
    try {
      if (owner || perms.reports) {
        const r = await window.api.analytics.supermarketOverview()
        if (!r.success) throw new Error(r.error)
        setData(r.data as Record<string, number>)
      }
      if (owner) {
        const r = await window.api.investments.list({ from, to })
        if (!r.success) throw new Error(r.error)
        setRows((r.data as { rows: Record<string, unknown>[] }).rows)
      }
      setError('')
    } catch (e) { setError(String(e)) }
  }
  useEffect(() => {
    load()
    const refresh = () => { if (!document.hidden) load() }
    window.addEventListener('focus', refresh)
    const timer = window.setInterval(refresh, 15000)
    return () => { window.removeEventListener('focus', refresh); clearInterval(timer) }
  }, [from, to])
  const save = async () => {
    setSaving(true)
    try {
      const r = await window.api.investments.create({ transaction_type: 'investment', amount: Number(amount), transaction_date: date, owner_name: u?.name || 'Owner' })
      if (!r.success) throw new Error(r.error)
      setAmount(''); await load(); toast.success('Investment recorded')
    } catch (e) { toast.error(String(e)) } finally { setSaving(false) }
  }
  useEffect(() => {
    if (hash === '#owner-investments') document.getElementById('owner-investments')?.scrollIntoView?.()
  }, [hash])
  return <div className="h-full overflow-auto">
    <PageHeader title={view === 'stock' ? 'Stock & Profit' : 'Owner Investments'} subtitle={view === 'stock' ? 'Stock valuation and earned profit' : 'Owner capital and date-wise investment history'} actions={<button className="btn-secondary" onClick={load}>Refresh</button>} />
    <div className="p-6 space-y-6">
      {error && <p role="alert" className="text-red-400">{error}</p>}
      {view === 'stock' && <><div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {[
          ['Total Available Stock Value (Purchase Cost)', 'stock_cost'],
          ['Total Expected Sales Value', 'expected_sales'],
          ['Expected Profit from Remaining Stock', 'expected_profit'],
          ['Actual Profit Earned from Sales', 'actual_profit'],
          ['Total Owner Investment', 'investment'],
        ].map(([label, key]) => <div key={key} className="card"><p className="text-sm text-slate-400">{label}</p><p className="text-2xl font-semibold mt-2">{data ? money(data[key]) : '?'}</p></div>)}
      </div>
      {data && (data.unknown_stock_qty > 0 || data.unknown_sold_qty > 0) && <p className="text-sm text-amber-400">Historical purchase cost is unknown for {data.unknown_stock_qty} remaining units and {data.unknown_sold_qty} sold units. Cost and profit totals include only known costs.</p>}
      <div className="flex gap-3"><Link className="btn-secondary" to="/admin/purchase-orders">Stock Purchases & Bills</Link><Link className="btn-secondary" to="/admin/batches">Purchase Batches</Link></div>
      </>}
      {view === 'investments' && owner && <section id="owner-investments" className="card space-y-4">
        <h2 className="font-semibold">Owner investments</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <label>Amount<input aria-label="Investment amount" type="number" min="0.01" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} className="input" /></label>
          <label>Date<input aria-label="Investment date" type="date" value={date} onChange={e => setDate(e.target.value)} className="input" /></label>
          <button className="btn-primary" disabled={saving || !(Number(amount)>0) || !date} onClick={save}>{saving ? 'Saving...' : 'Record investment'}</button>
        </div>
        <p className="text-sm text-slate-400">Investments are recorded separately from sales and profit.</p>
        <div className="flex gap-3"><label>From<input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input" /></label><label>To<input type="date" value={to} onChange={e => setTo(e.target.value)} className="input" /></label></div>
        <table className="w-full text-sm"><thead><tr><th className="text-left">Date</th><th className="text-left">Owner</th><th className="text-left">Type</th><th className="text-right">Amount</th></tr></thead><tbody>{rows.map(r => <tr key={String(r.id)}><td className="py-2">{String(r.transaction_date)}</td><td>{String(r.owner_name)}</td><td>{String(r.transaction_type)}</td><td className="text-right">{money(r.amount)}</td></tr>)}</tbody></table>
        {!rows.length && <p className="text-sm text-slate-400">No investments in this date range.</p>}
      </section>}
    </div>
  </div>
}
