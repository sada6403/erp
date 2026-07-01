import { useEffect, useState } from 'react'
import { stats as statsApi } from '../lib/api'
import {
  Building2, AlertTriangle, Monitor,
  RefreshCw, CheckCircle2, XCircle, ArrowUpRight, Clock,
  DollarSign, Wifi,
} from 'lucide-react'

type StatsData = {
  companies: { total:number; active:number; trial:number; suspended:number; cancelled:number; newThisMonth:number }
  revenue:   { mrr:number }
  devices:   { total:number; active:number }
  sync:      { last24h:number; success:number; failed:number }
  recentCompanies: Record<string,string>[]
  expiringTrials:  Record<string,string>[]
}

const STATUS_BADGE: Record<string, string> = {
  active:    'badge-green',
  trial:     'badge-yellow',
  suspended: 'badge-red',
  cancelled: 'bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-xs',
}

function fmt(n: number) { return n.toLocaleString() }

function MetricCard({
  icon: Icon, label, value, sub, color, trend,
}: {
  icon: typeof Building2
  label: string
  value: string | number
  sub?: string
  color: string
  trend?: string
}) {
  return (
    <div className="card flex items-start gap-4">
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-2xl font-bold text-white leading-tight">{value}</p>
        <p className="text-sm text-gray-400 mt-0.5">{label}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </div>
      {trend && (
        <span className="text-xs text-green-400 flex items-center gap-0.5 flex-shrink-0">
          <ArrowUpRight className="w-3 h-3" />{trend}
        </span>
      )}
    </div>
  )
}

function SyncHealthBar({ success, failed, total }: { success:number; failed:number; total:number }) {
  const pct = total > 0 ? Math.round((success / total) * 100) : 100
  const color = pct >= 95 ? 'bg-green-500' : pct >= 80 ? 'bg-yellow-500' : 'bg-red-500'
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>Sync Health (last 24h)</span>
        <span className={pct >= 95 ? 'text-green-400' : pct >= 80 ? 'text-yellow-400' : 'text-red-400'}>
          {pct}%
        </span>
      </div>
      <div className="w-full bg-gray-800 rounded-full h-2">
        <div className={`${color} h-2 rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <div className="flex gap-3 mt-1.5 text-xs text-gray-500">
        <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3 text-green-400" />{fmt(success)} ok</span>
        {failed > 0 && <span className="flex items-center gap-1"><XCircle className="w-3 h-3 text-red-400" />{fmt(failed)} failed</span>}
      </div>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData]       = useState<StatsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [lastRefresh, setLastRefresh] = useState(new Date())

  async function load() {
    setLoading(true); setError('')
    try {
      const d = await statsApi.get()
      setData(d as StatsData)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load stats')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Platform Dashboard</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Last updated {lastRefresh.toLocaleTimeString()}
          </p>
        </div>
        <button
          onClick={load}
          className="btn-ghost flex items-center gap-2 text-sm"
          disabled={loading}
        >
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </button>
      </div>

      {error && (
        <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Metric Cards — Row 1: Companies */}
      {data && (
        <>
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Companies</p>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <MetricCard
                icon={Building2} label="Total Companies" value={fmt(data.companies.total)}
                sub={`+${data.companies.newThisMonth} this month`}
                color="bg-blue-900/40 text-blue-400"
                trend={data.companies.newThisMonth > 0 ? `+${data.companies.newThisMonth}` : undefined}
              />
              <MetricCard
                icon={CheckCircle2} label="Active" value={fmt(data.companies.active)}
                sub={`${data.companies.total > 0 ? Math.round((data.companies.active/data.companies.total)*100) : 0}% of total`}
                color="bg-green-900/40 text-green-400"
              />
              <MetricCard
                icon={Clock} label="On Trial" value={fmt(data.companies.trial)}
                sub={data.expiringTrials.length > 0 ? `${data.expiringTrials.length} expiring this week` : 'None expiring soon'}
                color="bg-yellow-900/40 text-yellow-400"
              />
              <MetricCard
                icon={AlertTriangle} label="Suspended" value={fmt(data.companies.suspended)}
                color="bg-red-900/40 text-red-400"
              />
            </div>
          </div>

          {/* Metric Cards — Row 2: Platform health */}
          <div>
            <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">Platform Health</p>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <MetricCard
                icon={DollarSign} label="Monthly Recurring Revenue"
                value={`$${data.revenue.mrr.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                sub="Active subscriptions only"
                color="bg-emerald-900/40 text-emerald-400"
              />
              <MetricCard
                icon={Monitor} label="POS Devices Registered"
                value={fmt(data.devices.total)}
                sub={`${fmt(data.devices.active)} active devices`}
                color="bg-indigo-900/40 text-indigo-400"
              />
              <div className="card">
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 bg-cyan-900/40 text-cyan-400">
                    <Wifi className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold text-white">{fmt(data.sync.last24h)}</p>
                    <p className="text-sm text-gray-400">Sync Events (24h)</p>
                  </div>
                </div>
                <SyncHealthBar
                  success={data.sync.success}
                  failed={data.sync.failed}
                  total={data.sync.last24h}
                />
              </div>
            </div>
          </div>

          {/* Bottom row: Recent companies + Expiring trials */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Recent Companies */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">Recent Companies</h2>
                <span className="text-xs text-gray-500">Last 5 signups</span>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-800">
                    <th className="text-left text-gray-400 font-medium text-xs pb-2">Company</th>
                    <th className="text-left text-gray-400 font-medium text-xs pb-2">Package</th>
                    <th className="text-left text-gray-400 font-medium text-xs pb-2">Status</th>
                    <th className="text-left text-gray-400 font-medium text-xs pb-2">Joined</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recentCompanies.map(c => (
                    <tr key={c.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                      <td className="py-2.5">
                        <p className="font-medium text-white text-xs">{c.name}</p>
                        <p className="text-gray-500 text-xs">{c.slug}</p>
                      </td>
                      <td className="py-2.5 text-gray-400 text-xs">{c.package_name ?? '—'}</td>
                      <td className="py-2.5">
                        <span className={STATUS_BADGE[c.status] ?? ''}>{c.status}</span>
                      </td>
                      <td className="py-2.5 text-gray-400 text-xs">
                        {new Date(c.created_at).toLocaleDateString()}
                      </td>
                    </tr>
                  ))}
                  {data.recentCompanies.length === 0 && (
                    <tr><td colSpan={4} className="py-6 text-center text-gray-500 text-xs">No companies yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Expiring Trials */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-white">Trials Expiring This Week</h2>
                <span className="text-xs text-gray-500">{data.expiringTrials.length} companies</span>
              </div>
              {data.expiringTrials.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center">
                  <CheckCircle2 className="w-8 h-8 text-green-500 mb-2" />
                  <p className="text-sm text-gray-400">No trials expiring this week</p>
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      <th className="text-left text-gray-400 font-medium text-xs pb-2">Company</th>
                      <th className="text-left text-gray-400 font-medium text-xs pb-2">Email</th>
                      <th className="text-left text-gray-400 font-medium text-xs pb-2">Expires</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.expiringTrials.map(c => {
                      const days = Math.ceil(
                        (new Date(c.trial_ends_at).getTime() - Date.now()) / 86400000
                      )
                      return (
                        <tr key={c.id} className="border-b border-gray-800/40 hover:bg-gray-800/20">
                          <td className="py-2.5">
                            <p className="font-medium text-white text-xs">{c.name}</p>
                            <p className="text-gray-500 text-xs">{c.slug}</p>
                          </td>
                          <td className="py-2.5 text-gray-400 text-xs">{c.email}</td>
                          <td className="py-2.5">
                            <span className={`text-xs font-medium ${days <= 2 ? 'text-red-400' : 'text-yellow-400'}`}>
                              {days <= 0 ? 'Today' : `${days}d left`}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* Loading skeleton */}
      {loading && !data && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="card animate-pulse h-24 bg-gray-800/50" />
          ))}
        </div>
      )}
    </div>
  )
}
