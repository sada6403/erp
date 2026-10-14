import React, { useEffect, useState, useRef } from 'react'
import { audit as api, companies as companiesApi, type ActiveSession } from '../lib/api'
import {
  RefreshCw, Filter, X, Monitor, Laptop, Globe, Clock, Shield,
  Search, AlertCircle, CheckCircle2, PowerOff, User, Activity,
  Calendar, Layers, Eye
} from 'lucide-react'

type Log = {
  id: string
  portal: string
  actor_type: string
  actor_id: string
  actor_name: string
  company_name: string
  action: string
  resource: string
  resource_id: string
  old_values: Record<string, unknown> | null
  new_values: Record<string, unknown> | null
  ip_address: string
  user_agent: string
  pc_name: string | null
  created_at: string
}

type Company = { id: string; name: string }

function parseBrowserAndOs(ua?: string | null): string {
  if (!ua) return 'Web Browser'
  let os = 'OS'
  if (/Windows/i.test(ua)) os = 'Windows'
  else if (/Macintosh|Mac OS/i.test(ua)) os = 'macOS'
  else if (/Linux/i.test(ua)) os = 'Linux'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS'

  let browser = 'Browser'
  if (/Chrome/i.test(ua) && !/Edg/i.test(ua)) browser = 'Chrome'
  else if (/Edg/i.test(ua)) browser = 'Edge'
  else if (/Firefox/i.test(ua)) browser = 'Firefox'
  else if (/Safari/i.test(ua) && !/Chrome/i.test(ua)) browser = 'Safari'

  return `${browser} on ${os}`
}

function timeAgo(dateString: string): string {
  try {
    const diff = Math.floor((Date.now() - new Date(dateString).getTime()) / 1000)
    if (diff < 10) return 'Just now'
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`
    return `${Math.floor(diff / 86400)}d ago`
  } catch {
    return dateString
  }
}

export default function AuditLogsPage() {
  const [activeTab, setActiveTab] = useState<'sessions' | 'logs'>('sessions')

  // Sessions state
  const [sessions, setSessions] = useState<ActiveSession[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [terminatingId, setTerminatingId] = useState<string | null>(null)
  const [sessionMessage, setSessionMessage] = useState('')

  // Audit Logs state
  const [rows, setRows]         = useState<Log[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [logsLoading, setLogsLoading] = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])
  const [distinctPcs, setDistinctPcs] = useState<string[]>([])

  // Filters
  const [searchQuery, setSearchQuery] = useState('')
  const [pcNameFilter, setPcNameFilter] = useState('')
  const [action, setAction]       = useState('')
  const [companyId, setCompanyId] = useState('')
  const [from, setFrom]           = useState('')
  const [to, setTo]               = useState('')
  const [showFilters, setShowFilters] = useState(false)

  // Auto-refresh state
  const [autoRefresh, setAutoRefresh] = useState(true)
  const autoRefreshTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const limit = 50
  const [loadError, setLoadError] = useState('')

  // Load Active Sessions
  async function loadSessions() {
    setSessionsLoading(true)
    try {
      const data = await api.sessions()
      setSessions(data.sessions || [])
    } catch (err) {
      console.warn('Failed to fetch sessions:', err)
    } finally {
      setSessionsLoading(false)
    }
  }

  // Load Audit Trail Logs
  async function loadLogs(pg = page) {
    setLogsLoading(true)
    setLoadError('')
    try {
      const q: Record<string, string> = { page: String(pg), limit: String(limit) }
      if (searchQuery)  q.search     = searchQuery
      if (pcNameFilter) q.pc_name    = pcNameFilter
      if (action)       q.action     = action
      if (companyId)    q.company_id = companyId
      if (from)         q.from       = from
      if (to)           q.to         = to

      const d = await api.list(q)
      setRows(d.rows as Log[])
      setTotal(d.total)
      if (d.distinctPcs) {
        setDistinctPcs(d.distinctPcs)
      }
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLogsLoading(false)
    }
  }

  // Initial loads
  useEffect(() => {
    loadSessions()
    loadLogs(1)
    companiesApi.list({ limit: '200' })
      .then(d => setCompanies((d as { rows: Company[] }).rows))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (activeTab === 'logs') {
      loadLogs(page)
    } else {
      loadSessions()
    }
  }, [page, activeTab])

  // Periodic Auto-refresh (Every 15s)
  useEffect(() => {
    if (autoRefreshTimerRef.current) {
      clearInterval(autoRefreshTimerRef.current)
    }
    if (autoRefresh) {
      autoRefreshTimerRef.current = setInterval(() => {
        loadSessions()
        if (activeTab === 'logs') {
          loadLogs(page)
        }
      }, 15000)
    }
    return () => {
      if (autoRefreshTimerRef.current) clearInterval(autoRefreshTimerRef.current)
    }
  }, [autoRefresh, activeTab, page, searchQuery, pcNameFilter, action, companyId, from, to])

  async function handleTerminateSession(sessionId: string, pc: string) {
    if (!confirm(`Are you sure you want to disconnect PC session "${pc}"?`)) return
    setTerminatingId(sessionId)
    try {
      const res = await api.terminateSession(sessionId)
      if (res.ok) {
        setSessionMessage(`Session for ${pc} terminated.`)
        await loadSessions()
        await loadLogs(1)
        setTimeout(() => setSessionMessage(''), 4000)
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to terminate session')
    } finally {
      setTerminatingId(null)
    }
  }

  function handleApplyFilters() {
    setPage(1)
    loadLogs(1)
  }

  function handleClearFilters() {
    setSearchQuery('')
    setPcNameFilter('')
    setAction('')
    setCompanyId('')
    setFrom('')
    setTo('')
    setPage(1)
    loadLogs(1)
  }

  const hasFilters = Boolean(searchQuery || pcNameFilter || action || companyId || from || to)
  const onlineCount = sessions.filter(s => s.is_online === 1).length

  const PORTAL_BADGE: Record<string, string> = {
    superadmin: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
    admin:      'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30',
    pos:        'bg-amber-500/20 text-amber-400 border border-amber-500/30',
  }

  return (
    <div className="p-4 sm:p-6 space-y-5">
      {/* ── Top Header ──────────────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Staff & Device Tracking</h1>
            <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              {onlineCount} {onlineCount === 1 ? 'Station' : 'Stations'} Active
            </span>
          </div>
          <p className="text-xs sm:text-sm text-gray-400 mt-1">
            Tracks individual computers, login dates, and actions when multiple users share the same credentials.
          </p>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2">
          {/* Auto Refresh Toggle */}
          <button
            type="button"
            onClick={() => setAutoRefresh(r => !r)}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
              autoRefresh
                ? 'bg-blue-600/20 border-blue-500/40 text-blue-300'
                : 'bg-gray-800/80 border-gray-700 text-gray-400 hover:text-white'
            }`}
            title="Auto-refresh every 15 seconds"
          >
            <Activity className={`w-3.5 h-3.5 ${autoRefresh ? 'text-emerald-400 animate-pulse' : 'text-gray-500'}`} />
            <span>Auto Refresh (15s)</span>
          </button>

          {/* Manual Refresh */}
          <button
            onClick={() => { activeTab === 'sessions' ? loadSessions() : loadLogs() }}
            className="btn-ghost flex items-center gap-1.5 text-xs py-1.5 px-3"
            title="Refresh now"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${sessionsLoading || logsLoading ? 'animate-spin text-blue-400' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {sessionMessage && (
        <div className="bg-emerald-950/40 border border-emerald-800/50 rounded-xl px-4 py-2.5 text-xs text-emerald-300 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
          <span>{sessionMessage}</span>
        </div>
      )}

      {/* ── Navigation Tabs ─────────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 border-b border-gray-800 pb-2">
        <button
          onClick={() => setActiveTab('sessions')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'sessions'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
          }`}
        >
          <Monitor className="w-4 h-4" />
          <span>Connected PC Stations</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'sessions' ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-400'}`}>
            {sessions.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('logs')}
          className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
            activeTab === 'logs'
              ? 'bg-blue-600 text-white shadow-md shadow-blue-600/20'
              : 'text-gray-400 hover:text-white hover:bg-gray-800/60'
          }`}
        >
          <Shield className="w-4 h-4" />
          <span>Security Audit Trail</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${activeTab === 'logs' ? 'bg-white/20 text-white' : 'bg-gray-800 text-gray-400'}`}>
            {total.toLocaleString()}
          </span>
        </button>
      </div>

      {/* ── TAB 1: Connected PC Stations & Devices ─────────────────────────── */}
      {activeTab === 'sessions' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-xs text-gray-400">
              Active computers currently open in this shared SuperAdmin account.
            </p>
            <span className="text-[11px] text-gray-500">Live heartbeat updates every 40s</span>
          </div>

          {sessions.length === 0 && !sessionsLoading ? (
            <div className="card text-center py-12 space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-gray-800 flex items-center justify-center mx-auto text-gray-500">
                <Monitor className="w-6 h-6" />
              </div>
              <p className="text-sm font-semibold text-gray-300">No active stations recorded yet</p>
              <p className="text-xs text-gray-500 max-w-sm mx-auto">
                As soon as users sign in or open the portal from different computers, their PC names and live activity will show up here.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {sessions.map(s => {
                const isOnline = s.is_online === 1
                const isTerminating = terminatingId === s.id
                return (
                  <div
                    key={s.id}
                    className={`card p-4 transition-all hover:border-gray-700 flex flex-col justify-between ${
                      isOnline ? 'border-emerald-500/30 bg-gray-900/90 shadow-sm shadow-emerald-500/5' : 'border-gray-800 bg-gray-900/50'
                    }`}
                  >
                    <div>
                      {/* Card Header: PC Station Name & Status */}
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                            isOnline ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-gray-800 text-gray-400'
                          }`}>
                            <Monitor className="w-4 h-4" />
                          </div>
                          <div className="min-w-0">
                            <h3 className="text-sm font-bold text-white truncate" title={s.pc_name}>
                              {s.pc_name || 'Unnamed PC'}
                            </h3>
                            <p className="text-[11px] text-gray-400 font-mono truncate">
                              ID: {s.id.slice(0, 12)}…
                            </p>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider shrink-0 ${
                          isOnline
                            ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                            : 'bg-gray-800 text-gray-400 border border-gray-700'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${isOnline ? 'bg-emerald-400 animate-pulse' : 'bg-gray-500'}`}></span>
                          {isOnline ? 'Online Now' : 'Disconnected'}
                        </span>
                      </div>

                      {/* Current Activity Box */}
                      <div className="bg-gray-950/60 rounded-xl p-3 border border-gray-800/80 mb-3 space-y-1.5">
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-400 font-medium">Current Action:</span>
                          <span className="text-blue-400 font-semibold truncate max-w-[170px]" title={s.last_action}>
                            {s.last_action || 'Browsing'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500">Page Route:</span>
                          <span className="text-gray-300 font-mono text-[10px] truncate max-w-[170px]">
                            {s.current_path || '/'}
                          </span>
                        </div>
                        <div className="flex items-center justify-between text-[11px]">
                          <span className="text-gray-500">Last Seen:</span>
                          <span className="text-gray-300 font-medium">{timeAgo(s.last_seen_at)}</span>
                        </div>
                      </div>

                      {/* Device & Login Meta */}
                      <div className="space-y-1.5 text-xs text-gray-400 mb-4 px-1">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-gray-500">
                            <Clock className="w-3.5 h-3.5" /> Logged In:
                          </span>
                          <span className="text-gray-300 font-mono text-[11px]">
                            {new Date(s.logged_in_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}, {new Date(s.logged_in_at).toLocaleDateString()}
                          </span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-gray-500">
                            <Globe className="w-3.5 h-3.5" /> IP Address:
                          </span>
                          <span className="text-gray-300 font-mono text-[11px]">{s.ip_address || '—'}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-gray-500">
                            <Laptop className="w-3.5 h-3.5" /> System:
                          </span>
                          <span className="text-gray-300 text-[11px] truncate max-w-[160px]" title={s.user_agent || ''}>
                            {parseBrowserAndOs(s.user_agent)}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Disconnect / Kick Button */}
                    <div className="pt-2 border-t border-gray-800">
                      <button
                        onClick={() => handleTerminateSession(s.id, s.pc_name)}
                        disabled={isTerminating}
                        className="w-full flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-semibold text-red-400 hover:text-white bg-red-950/20 hover:bg-red-900/40 border border-red-900/30 transition-all disabled:opacity-50"
                      >
                        <PowerOff className="w-3.5 h-3.5" />
                        <span>{isTerminating ? 'Disconnecting…' : 'Disconnect This PC'}</span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── TAB 2: Historical Security Audit Trail ─────────────────────────── */}
      {activeTab === 'logs' && (
        <div className="space-y-4">
          {/* Quick Search & Filters Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
              <input
                className="input pl-10 text-xs sm:text-sm bg-gray-900/90"
                placeholder="Search by PC Name, Action, Actor, IP..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleApplyFilters()}
              />
              {searchQuery && (
                <button
                  onClick={() => { setSearchQuery(''); setPage(1); loadLogs(1) }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2">
              <button
                className={`btn-ghost flex items-center gap-2 text-xs py-2 px-3 ${showFilters || hasFilters ? 'text-blue-400 border-blue-500/40' : ''}`}
                onClick={() => setShowFilters(f => !f)}
              >
                <Filter className="w-3.5 h-3.5" />
                <span>Filters</span>
                {hasFilters && (
                  <span className="w-2 h-2 rounded-full bg-blue-500"></span>
                )}
              </button>

              <button className="btn-primary text-xs py-2 px-3" onClick={handleApplyFilters}>
                Apply
              </button>
            </div>
          </div>

          {/* Filter Panel */}
          {showFilters && (
            <div className="card space-y-3 bg-gray-900 border-gray-800">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Filter Options</p>
                {hasFilters && (
                  <button onClick={handleClearFilters} className="text-xs text-red-400 hover:text-red-300 flex items-center gap-1">
                    <X className="w-3 h-3" /> Clear all
                  </button>
                )}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                {/* Filter by PC Name */}
                <div>
                  <label className="label text-xs flex items-center gap-1">
                    <Monitor className="w-3 h-3 text-blue-400" /> PC Station Name
                  </label>
                  {distinctPcs.length > 0 ? (
                    <select
                      className="input text-xs"
                      value={pcNameFilter}
                      onChange={e => setPcNameFilter(e.target.value)}
                    >
                      <option value="">All PC Stations</option>
                      {distinctPcs.map(pc => (
                        <option key={pc} value={pc}>{pc}</option>
                      ))}
                    </select>
                  ) : (
                    <input
                      className="input text-xs"
                      placeholder="e.g. Manager Laptop"
                      value={pcNameFilter}
                      onChange={e => setPcNameFilter(e.target.value)}
                    />
                  )}
                </div>

                <div>
                  <label className="label text-xs">Action</label>
                  <input
                    className="input text-xs"
                    placeholder="e.g. auth.login, company.update"
                    value={action}
                    onChange={e => setAction(e.target.value)}
                  />
                </div>

                <div>
                  <label className="label text-xs">Company</label>
                  <select className="input text-xs" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                    <option value="">All companies</option>
                    {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="label text-xs">Date Range</label>
                  <div className="grid grid-cols-2 gap-2">
                    <input className="input text-xs" type="date" value={from} onChange={e => setFrom(e.target.value)} />
                    <input className="input text-xs" type="date" value={to} onChange={e => setTo(e.target.value)} />
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Audit Logs Table */}
          <div className="card p-0 overflow-hidden border-gray-800">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-gray-800 bg-gray-900/70 text-[11px] uppercase tracking-wider text-gray-400 font-semibold">
                  <tr>
                    <th className="px-4 py-3">Time</th>
                    <th className="px-4 py-3">PC Station Name</th>
                    <th className="px-4 py-3">Actor / Portal</th>
                    <th className="px-4 py-3">Action Performed</th>
                    <th className="px-4 py-3">Target / Resource</th>
                    <th className="px-4 py-3">IP Address</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800/50">
                  {rows.map(log => {
                    const isExpanded = expanded === log.id
                    return (
                      <React.Fragment key={log.id}>
                        <tr
                          className="hover:bg-gray-800/30 transition-colors cursor-pointer"
                          onClick={() => setExpanded(isExpanded ? null : log.id)}
                        >
                          {/* Time */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <p className="text-xs font-semibold text-gray-200">
                              {new Date(log.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </p>
                            <p className="text-[10px] text-gray-500 font-mono">
                              {new Date(log.created_at).toLocaleDateString()} ({timeAgo(log.created_at)})
                            </p>
                          </td>

                          {/* PC Station Name (Highlight) */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {log.pc_name ? (
                              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-950/60 border border-blue-700/50 text-blue-300 font-semibold text-xs shadow-sm">
                                <Monitor className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                                <span>{log.pc_name}</span>
                              </span>
                            ) : (
                              <span className="text-gray-500 text-xs italic flex items-center gap-1">
                                <Monitor className="w-3.5 h-3.5 opacity-40" /> System / Legacy
                              </span>
                            )}
                          </td>

                          {/* Actor / Portal */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${PORTAL_BADGE[log.portal] || 'bg-gray-800 text-gray-400'}`}>
                                {log.portal}
                              </span>
                              <span className="text-xs text-gray-200 font-medium">
                                {log.actor_name || log.actor_id?.slice(0, 8)}
                              </span>
                            </div>
                          </td>

                          {/* Action */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="font-mono text-xs text-indigo-400 font-semibold">
                              {log.action}
                            </span>
                          </td>

                          {/* Target / Resource */}
                          <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                            {log.company_name ? (
                              <span className="text-gray-200 font-medium">{log.company_name}</span>
                            ) : log.resource ? (
                              <span>{log.resource}{log.resource_id ? `:${log.resource_id.slice(0, 8)}` : ''}</span>
                            ) : (
                              <span className="text-gray-600">—</span>
                            )}
                          </td>

                          {/* IP Address */}
                          <td className="px-4 py-3 whitespace-nowrap text-xs font-mono text-gray-500">
                            {log.ip_address || '—'}
                          </td>
                        </tr>

                        {/* Expanded Payload / Changes */}
                        {isExpanded && (
                          <tr className="bg-gray-950/70">
                            <td colSpan={6} className="px-4 py-3 border-t border-b border-gray-800">
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                                  Action Details & Payload:
                                </p>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs font-mono">
                                  {log.old_values && (
                                    <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                                      <p className="text-gray-400 font-bold mb-1">Previous Values (Before)</p>
                                      <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap">
                                        {JSON.stringify(log.old_values, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {log.new_values && (
                                    <div className="bg-gray-900 rounded-xl p-3 border border-gray-800">
                                      <p className="text-blue-400 font-bold mb-1">New Values (After / Parameters)</p>
                                      <pre className="text-gray-300 overflow-x-auto whitespace-pre-wrap">
                                        {JSON.stringify(log.new_values, null, 2)}
                                      </pre>
                                    </div>
                                  )}
                                  {!log.old_values && !log.new_values && (
                                    <div className="bg-gray-900 rounded-xl p-3 border border-gray-800 text-gray-500 italic">
                                      No raw change payload recorded for this action.
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    )
                  })}

                  {loadError && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-red-400 text-sm">{loadError}</td></tr>
                  )}
                  {!logsLoading && !loadError && rows.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-500 text-sm">No audit logs matching this search</td></tr>
                  )}
                  {logsLoading && (
                    <tr><td colSpan={6} className="px-4 py-6 text-center text-gray-500 text-sm">Loading logs…</td></tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > limit && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800 bg-gray-900/40">
                <span className="text-xs text-gray-500">
                  Showing {(page-1)*limit+1}–{Math.min(page*limit, total)} of {total.toLocaleString()} records
                </span>
                <div className="flex gap-2">
                  <button
                    className="btn-ghost text-xs py-1 px-3"
                    disabled={page === 1}
                    onClick={() => setPage(p => p - 1)}
                  >
                    Previous
                  </button>
                  <button
                    className="btn-ghost text-xs py-1 px-3"
                    disabled={page * limit >= total}
                    onClick={() => setPage(p => p + 1)}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
