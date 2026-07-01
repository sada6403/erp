import React, { useEffect, useState } from 'react'
import { audit as api, companies as companiesApi } from '../lib/api'
import { RefreshCw, Filter, X } from 'lucide-react'

type Log = {
  id: string; portal: string; actor_type: string; actor_id: string; actor_name: string
  company_name: string; action: string; resource: string; resource_id: string
  old_values: Record<string, unknown> | null; new_values: Record<string, unknown> | null
  ip_address: string; created_at: string
}

type Company = { id: string; name: string }

export default function AuditLogsPage() {
  const [rows, setRows]         = useState<Log[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [loading, setLoading]   = useState(false)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [companies, setCompanies] = useState<Company[]>([])

  // Filters
  const [action,    setAction]    = useState('')
  const [companyId, setCompanyId] = useState('')
  const [from,      setFrom]      = useState('')
  const [to,        setTo]        = useState('')
  const [showFilters, setShowFilters] = useState(false)

  const limit = 50

  const [loadError, setLoadError] = useState('')

  async function load(pg = page) {
    setLoading(true)
    setLoadError('')
    try {
      const q: Record<string, string> = { page: String(pg), limit: String(limit) }
      if (action)    q.action     = action
      if (companyId) q.company_id = companyId
      if (from)      q.from       = from
      if (to)        q.to         = to
      const d = await api.list(q)
      setRows(d.rows as Log[])
      setTotal(d.total)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [page])

  useEffect(() => {
    companiesApi.list({ limit: '200' })
      .then(d => setCompanies((d as { rows: Company[] }).rows))
      .catch(() => {})
  }, [])

  function search() { setPage(1); load(1) }
  function clearFilters() {
    setAction(''); setCompanyId(''); setFrom(''); setTo('')
    setPage(1); load(1)
  }

  const hasFilters = action || companyId || from || to

  const PORTAL_BADGE: Record<string, string> = {
    superadmin: 'badge-blue',
    admin:      'badge-green',
    pos:        'badge-yellow',
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Audit Logs</h1>
          <p className="text-sm text-gray-400">{total.toLocaleString()} total entries</p>
        </div>
        <div className="flex gap-2">
          <button
            className={`btn-ghost flex items-center gap-2 text-sm ${showFilters ? 'text-indigo-400' : ''}`}
            onClick={() => setShowFilters(f => !f)}
          >
            <Filter className="w-4 h-4" /> Filters {hasFilters && <span className="bg-indigo-600 text-white text-xs rounded-full w-4 h-4 flex items-center justify-center">!</span>}
          </button>
          <button className="btn-ghost flex items-center gap-2" onClick={() => load()}>
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Filter Panel */}
      {showFilters && (
        <div className="card space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest">Filters</p>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="label">Action</label>
              <input className="input text-sm" placeholder="e.g. company.update"
                value={action} onChange={e => setAction(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && search()} />
            </div>
            <div>
              <label className="label">Company</label>
              <select className="input text-sm" value={companyId} onChange={e => setCompanyId(e.target.value)}>
                <option value="">All companies</option>
                {companies.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">From Date</label>
              <input className="input text-sm" type="date" value={from} onChange={e => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label">To Date</label>
              <input className="input text-sm" type="date" value={to} onChange={e => setTo(e.target.value)} />
            </div>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary text-sm" onClick={search}>Apply Filters</button>
            {hasFilters && (
              <button className="btn-ghost text-sm flex items-center gap-1" onClick={clearFilters}>
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-800">
            <tr>
              {['Time','Portal','Actor','Company','Action','Resource','IP'].map(h => (
                <th key={h} className="text-left text-gray-400 font-medium px-4 py-3 text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(log => (
              <React.Fragment key={log.id}>
                <tr
                  className="border-b border-gray-800/50 hover:bg-gray-800/20 cursor-pointer"
                  onClick={() => setExpanded(expanded === log.id ? null : log.id)}
                >
                  <td className="px-4 py-2.5 text-gray-400 text-xs whitespace-nowrap">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={PORTAL_BADGE[log.portal] ?? 'badge-yellow'}>{log.portal}</span>
                  </td>
                  <td className="px-4 py-2.5 text-white text-xs">{log.actor_name ?? log.actor_id?.slice(0,8)}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">{log.company_name ?? '—'}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-blue-400">{log.action}</td>
                  <td className="px-4 py-2.5 text-gray-400 text-xs">
                    {log.resource ?? '—'}{log.resource_id ? `:${log.resource_id.slice(0,8)}` : ''}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500 text-xs">{log.ip_address ?? '—'}</td>
                </tr>
                {expanded === log.id && (log.old_values || log.new_values) && (
                  <tr className="bg-gray-800/30">
                    <td colSpan={7} className="px-4 py-3">
                      <div className="grid grid-cols-2 gap-4 text-xs">
                        {log.old_values && (
                          <div>
                            <p className="text-gray-500 mb-1 font-medium">Before</p>
                            <pre className="text-gray-300 whitespace-pre-wrap bg-gray-900/60 rounded p-2">
                              {JSON.stringify(log.old_values, null, 2)}
                            </pre>
                          </div>
                        )}
                        {log.new_values && (
                          <div>
                            <p className="text-gray-500 mb-1 font-medium">After</p>
                            <pre className="text-gray-300 whitespace-pre-wrap bg-gray-900/60 rounded p-2">
                              {JSON.stringify(log.new_values, null, 2)}
                            </pre>
                          </div>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
            {loadError && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-red-400 text-sm">{loadError}</td></tr>
            )}
            {!loading && !loadError && rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-500">No logs yet</td></tr>
            )}
            {loading && (
              <tr><td colSpan={7} className="px-4 py-6 text-center text-gray-500 text-sm">Loading…</td></tr>
            )}
          </tbody>
        </table>

        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              {(page-1)*limit+1}–{Math.min(page*limit, total)} of {total.toLocaleString()}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs py-1 px-2" disabled={page===1}
                onClick={() => setPage(p => p-1)}>Prev</button>
              <button className="btn-ghost text-xs py-1 px-2" disabled={page*limit>=total}
                onClick={() => setPage(p => p+1)}>Next</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
