import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Shield, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'

export default function AuditLogsPage() {
  const [logs, setLogs]     = useState<Record<string,unknown>[]>([])
  const [filter, setFilter] = useState('')
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.admin.auditLogs.list(filter ? { action: filter } : {})
      if (res.success) setLogs(res.data as Record<string,unknown>[])
      else toast.error(res.error || 'Failed to load audit logs')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load audit logs')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [filter])

  const actionColor: Record<string,string> = {
    LOGIN: 'badge-blue', CREATE_INVOICE: 'badge-green', STOCK_ADJUST: 'badge-yellow',
    CANCEL_INVOICE: 'badge-red', STOCK_TRANSFER: 'badge-purple'
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Audit Logs" subtitle="Complete system activity trail"
        actions={<button onClick={load} className="btn-secondary btn-sm gap-1.5"><RefreshCw size={14} /> Refresh</button>}
      />
      <div className="flex gap-2 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter by action..." className="input text-sm max-w-xs" />
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>{['Timestamp', 'User', 'Action', 'Table', 'Record ID', 'Branch'].map(h => <th key={h} className="table-header px-4 py-3 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6} className="text-center py-16 text-slate-500">Loading...</td></tr>
            : logs.map(l => (
              <tr key={l.id as string} className="table-row">
                <td className="table-cell text-xs text-slate-400 font-mono whitespace-nowrap">{new Date(l.created_at as string).toLocaleString()}</td>
                <td className="table-cell">{l.user_name as string || 'System'}</td>
                <td className="table-cell"><span className={actionColor[l.action as string] || 'badge-gray'}>{l.action as string}</span></td>
                <td className="table-cell text-slate-400 text-xs">{l.table_name as string || '—'}</td>
                <td className="table-cell text-xs font-mono text-slate-500 max-w-xs truncate">{l.record_id as string || '—'}</td>
                <td className="table-cell text-slate-400 text-xs">{l.branch_id as string || 'Global'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
