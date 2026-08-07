import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Coins, Users, Wallet, Shuffle, AlertCircle, GitBranch, Check, X, Package, Trophy, Clock, TrendingUp, Layers } from 'lucide-react'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SmartBuyDashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Row | null>(null)
  const [invites, setInvites] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const [res, inv] = await Promise.all([window.api.chits.dashboard(), window.api.chits.branches.pendingInvites()])
      if (res.success) setData(res.data)
      else toast.error(res.error || 'Failed to load Smart Buy dashboard')
      if (inv.success) setInvites(inv.data as Row[])
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load Smart Buy dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const respondInvite = async (id: string, action: 'approve' | 'reject') => {
    try {
      const res = await window.api.chits.branches.respond(id, action)
      if (res.success) { toast.success(action === 'approve' ? 'Collaboration approved' : 'Invitation rejected'); load() }
      else toast.error(res.error || 'Failed to respond')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to respond')
    }
  }

  if (loading || !data) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>Loading...</div>
  }

  const recentDraws = (data.recent_draws || []) as Row[]
  const agentsWithBalance = (data.agents_with_balance || []) as Row[]
  const pendingFinalClaims = (data.pending_final_claims || []) as Row[]
  const branchRanking = (data.branch_ranking || []) as Row[]
  const agentRanking = (data.agent_ranking || []) as Row[]
  const topSellingProducts = (data.top_selling_products || []) as Row[]
  const monthlyCollectionTrend = ((data.monthly_collection_trend || []) as Row[]).map(r => ({ month: (r.month as string)?.slice(5), total: Number(r.total || 0) }))
  const commissionTrend = ((data.commission_trend || []) as Row[]).map(r => ({ month: (r.month as string)?.slice(5), total: Number(r.total || 0) }))
  const newCustomersTrend = ((data.monthly_new_customers || []) as Row[]).map(r => ({ month: (r.month as string)?.slice(5), total: Number(r.total || 0) }))
  const schemeRegistrationsTrend = ((data.monthly_scheme_registrations || []) as Row[]).map(r => ({ month: (r.month as string)?.slice(5), total: Number(r.total || 0) }))
  const winnerTimeline = ((data.winner_timeline || []) as Row[]).map(r => ({ month: (r.month as string)?.slice(5), winners: Number(r.winners || 0) }))
  const tooltipStyle = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy Dashboard" subtitle="Schemes, collections, agents, and lottery activity overview" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        {invites.length > 0 && (
          <div className="rounded-xl border p-4" style={{ background: 'color-mix(in srgb, #f59e0b 8%, transparent)', borderColor: '#f59e0b' }}>
            <p className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: '#a16207' }}><GitBranch size={14} /> Branch Collaboration Invites Awaiting Your Response</p>
            <div className="space-y-2">
              {invites.map(inv => (
                <div key={inv.id as string} className="flex items-center justify-between gap-3 rounded-lg px-3 py-2" style={{ background: 'var(--bg-card)' }}>
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate" style={{ color: 'var(--text-1)' }}>{inv.scheme_name as string} <span className="font-mono text-xs" style={{ color: 'var(--text-3)' }}>({inv.scheme_number as string})</span></p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>Invited by {(inv.home_branch_name as string) || 'another branch'} — {Number(inv.members_enrolled || 0)} / {Number(inv.min_members || 0)} members so far</p>
                  </div>
                  <div className="flex gap-1.5 flex-shrink-0">
                    <button onClick={() => respondInvite(inv.id as string, 'approve')} className="btn-primary btn-sm gap-1"><Check size={13} /> Approve</button>
                    <button onClick={() => respondInvite(inv.id as string, 'reject')} className="btn-secondary btn-sm gap-1"><X size={13} /> Reject</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {pendingFinalClaims.length > 0 && (
          <div className="rounded-xl border p-4" style={{ background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)', borderColor: 'var(--brand-primary)' }}>
            <p className="flex items-center gap-1.5 text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}><Package size={14} /> Final Month Product Claims Pending</p>
            <div className="flex flex-wrap gap-2">
              {pendingFinalClaims.map(c => (
                <button key={c.scheme_id as string} onClick={() => navigate(`/admin/chits/${c.scheme_id}`)}
                  className="flex items-center gap-2 rounded-lg px-3 py-2 text-left hover:border-[var(--brand-primary)] border" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                  <span className="text-sm" style={{ color: 'var(--text-1)' }}>{c.scheme_name as string}</span>
                  <span className="badge-yellow">{Number(c.pending_count || 0)} pending</span>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button onClick={() => navigate('/admin/chits')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Layers size={13} /> Total Schemes</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.total_schemes || 0)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>
              {Number(data.active_schemes || 0)} active · {Number(data.pending_schemes || 0)} pending · {Number(data.completed_schemes || 0)} completed · {Number(data.cancelled_schemes || 0)} cancelled
            </p>
          </button>
          <button onClick={() => navigate('/admin/chit-customers')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Users size={13} /> Members Enrolled</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.members_enrolled || 0)}</p>
          </button>
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Coins size={13} /> Collected This Month</p>
            <p className="text-2xl font-bold mt-1 text-brand-400">Rs.{money(data.collected_this_month)}</p>
            <p className="text-[11px] mt-0.5" style={{ color: 'var(--text-3)' }}>Rs.{money(data.collected_today)} today</p>
          </div>
          <button onClick={() => navigate('/admin/smart-buy-agents')}
            className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]"
            style={{ background: Number(data.pending_remittance_total) > 0 ? 'color-mix(in srgb, #f59e0b 10%, transparent)' : 'var(--bg-card)', borderColor: Number(data.pending_remittance_total) > 0 ? '#f59e0b' : 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Wallet size={13} /> Pending Agent Remittance</p>
            <p className="text-2xl font-bold mt-1" style={{ color: Number(data.pending_remittance_total) > 0 ? '#f59e0b' : 'var(--text-1)' }}>Rs.{money(data.pending_remittance_total)}</p>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Trophy size={13} /> Winners Settled</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.winner_count || 0)}</p>
          </div>
          <div className="rounded-xl border p-4" style={{ background: Number(data.pending_payments) > 0 ? 'color-mix(in srgb, #f59e0b 10%, transparent)' : 'var(--bg-card)', borderColor: Number(data.pending_payments) > 0 ? '#f59e0b' : 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Clock size={13} /> Pending Payments (Bank Transfer)</p>
            <p className="text-2xl font-bold mt-1" style={{ color: Number(data.pending_payments) > 0 ? '#f59e0b' : 'var(--text-1)' }}>Rs.{money(data.pending_payments)}</p>
          </div>
          <div className="rounded-xl border p-4" style={{ background: Number(data.pending_withdrawal_requests) > 0 ? 'color-mix(in srgb, #f59e0b 10%, transparent)' : 'var(--bg-card)', borderColor: Number(data.pending_withdrawal_requests) > 0 ? '#f59e0b' : 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><X size={13} /> Pending Withdrawal Requests</p>
            <p className="text-2xl font-bold mt-1" style={{ color: Number(data.pending_withdrawal_requests) > 0 ? '#f59e0b' : 'var(--text-1)' }}>{Number(data.pending_withdrawal_requests || 0)}</p>
          </div>
          <button onClick={() => navigate('/admin/smart-buy-reports')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: Number(data.delayed_claims_count) > 0 ? 'color-mix(in srgb, #f59e0b 10%, transparent)' : 'var(--bg-card)', borderColor: Number(data.delayed_claims_count) > 0 ? '#f59e0b' : 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Clock size={13} /> Delayed Claims</p>
            <p className="text-2xl font-bold mt-1" style={{ color: Number(data.delayed_claims_count) > 0 ? '#f59e0b' : 'var(--text-1)' }}>{Number(data.delayed_claims_count || 0)}</p>
          </button>
          <button onClick={() => navigate('/admin/smart-buy-reports')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Wallet size={13} /> Total SmartBuy Wallet Balance</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>Rs.{money(data.total_wallet_balance)}</p>
          </button>
          <button onClick={() => navigate('/admin/commission-rules')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><TrendingUp size={13} /> Total Commission</p>
            <p className="text-2xl font-bold mt-1 text-brand-400">Rs.{money(data.total_commission)}</p>
          </button>
          <button onClick={() => navigate('/admin/smart-buy-reports')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Coins size={13} /> Full Reports</p>
            <p className="text-sm font-semibold mt-1" style={{ color: 'var(--text-1)' }}>View all Smart Buy reports →</p>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Users size={13} /> Total Customers</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.total_customers || 0)}</p>
          </div>
          {data.total_branches !== undefined && (
            <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><GitBranch size={13} /> Total Branches</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.total_branches || 0)}</p>
            </div>
          )}
          {data.total_smartbuy_managers !== undefined && (
            <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
              <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Users size={13} /> SmartBuy Managers</p>
              <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.total_smartbuy_managers || 0)}</p>
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Monthly Collection Trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={monthlyCollectionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`Rs.${money(v)}`, 'Collected']} />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Commission Trend</h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={commissionTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`Rs.${money(v)}`, 'Commission']} />
                <Line type="monotone" dataKey="total" stroke="#22c55e" strokeWidth={2} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Branch Ranking (by Collection)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={branchRanking} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <YAxis dataKey="branch_name" type="category" stroke="var(--text-3)" tick={{ fontSize: 10 }} width={90} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`Rs.${money(v)}`, 'Collected']} />
                <Bar dataKey="collected" fill="#6366f1" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Agent Ranking (by Commission)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={agentRanking} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <YAxis dataKey="code" type="category" stroke="var(--text-3)" tick={{ fontSize: 10 }} width={70} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`Rs.${money(v)}`, 'Commission']} />
                <Bar dataKey="commission_earned" fill="#22c55e" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Top Selling Products (Redemptions)</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={topSellingProducts} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis type="number" stroke="var(--text-3)" tick={{ fontSize: 10 }} tickFormatter={v => `${(Number(v) / 1000).toFixed(0)}k`} />
                <YAxis dataKey="product_name" type="category" stroke="var(--text-3)" tick={{ fontSize: 10 }} width={90} tickFormatter={(v: string) => v?.length > 12 ? v.slice(0, 12) + '...' : v} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [`Rs.${money(v)}`, 'Value']} />
                <Bar dataKey="total_value" fill="#a855f7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>New Customers</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={newCustomersTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'New Customers']} />
                <Bar dataKey="total" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Scheme Registrations</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={schemeRegistrationsTrend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Registrations']} />
                <Bar dataKey="total" fill="#6366f1" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Winner Timeline</h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={winnerTimeline}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="month" stroke="var(--text-3)" tick={{ fontSize: 10 }} />
                <YAxis stroke="var(--text-3)" tick={{ fontSize: 10 }} allowDecimals={false} />
                <Tooltip contentStyle={tooltipStyle} formatter={(v) => [v, 'Winners']} />
                <Bar dataKey="winners" fill="#f59e0b" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><TrendingUp size={14} /> Agent Performance Ranking</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Rank', 'Agent', 'Code', 'Sales', 'Customers', 'Commission'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {agentRanking.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No agent activity yet</td></tr>
                ) : agentRanking.map((a, i) => (
                  <tr key={a.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 text-xs font-semibold" style={{ color: 'var(--text-3)' }}>#{i + 1}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{a.name as string}</td>
                    <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-3)' }}>{a.code as string}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--text-2)' }}>Rs.{money(a.sales)}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--text-2)' }}>{Number(a.customers || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-400">Rs.{money(a.commission_earned)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><Shuffle size={14} /> Recent Draws</h3>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    {['Date', 'Scheme', 'Winner', 'Product'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentDraws.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No draws yet</td></tr>
                  ) : recentDraws.map((d, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{d.draw_date ? new Date(String(d.draw_date)).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{d.scheme_name as string}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{d.method === 'final_batch' ? 'Final settlement' : (d.winner_name as string) || '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{d.redeemed_product_name ? `${d.redeemed_product_name as string} × ${d.redeemed_qty as number}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><AlertCircle size={14} /> Agents With Outstanding Cash</h3>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    {['Agent', 'Balance to Submit'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentsWithBalance.length === 0 ? (
                    <tr><td colSpan={2} className="text-center py-8" style={{ color: 'var(--text-3)' }}>All agents are settled up</td></tr>
                  ) : agentsWithBalance.map(a => (
                    <tr key={a.id as string} className="border-t cursor-pointer hover:bg-[var(--bg-soft)]" style={{ borderColor: 'var(--border)' }}
                      onClick={() => navigate('/admin/smart-buy-agents')}>
                      <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{a.name as string} <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>({a.code as string})</span></td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: '#f59e0b' }}>Rs.{money(a.cash_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
