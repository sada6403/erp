import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import { RefreshCw, Wifi, WifiOff, CheckCircle2, AlertCircle, Clock, FlaskConical, Trash2, Activity } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type QueueItem = {
  id: string
  table_name: string
  operation: string
  status: string
  attempts: number
  last_error: string | null
  created_at: string
}

type DiagStep = { step: string; ok: boolean; detail: string }

export default function SyncMonitorPage() {
  const { status, triggerSync } = useSyncStatus()
  const { user } = useAuthStore()
  const permissions = (user?.role?.permissions ||
    (user as unknown as Record<string, unknown>)?.permissions) as Record<string, unknown> || {}
  const canManageSync = Boolean(permissions.all)
  const [syncing, setSyncing] = useState(false)
  const [diagnosing, setDiagnosing] = useState(false)
  const [diagSteps, setDiagSteps] = useState<DiagStep[]>([])
  const [queue, setQueue] = useState<QueueItem[]>([])

  const loadQueue = useCallback(async () => {
    try {
      const res = await window.api.sync.queue()
      if (res.success) setQueue(res.data as QueueItem[])
      else toast.error(res.error || 'Failed to load sync queue')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load sync queue')
    }
  }, [])

  useEffect(() => { loadQueue() }, [loadQueue])

  const handleSync = async () => {
    setSyncing(true)
    await triggerSync()
    await loadQueue()
    setSyncing(false)
  }

  const handleResetFailed = async () => {
    try {
      const res = await window.api.sync.resetFailed()
      if (res.success) {
        toast.success(`Reset ${res.data as number} failed item(s) - click Sync Now`)
        await loadQueue()
      } else {
        toast.error(res.error || 'Failed to reset failed items')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reset failed items')
    }
  }

  const handleFixAndSync = async () => {
    setSyncing(true)
    try {
      const res = await window.api.sync.fixInvoices()
      if (!res.success) {
        toast.error(res.error || 'Failed to fix invoices')
        return
      }
      await triggerSync()
      await loadQueue()
      toast.success('Fixed and synced')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to fix and sync')
    } finally {
      setSyncing(false)
    }
  }

  const handleDiagnose = async () => {
    setDiagnosing(true)
    setDiagSteps([])
    try {
      const res = await window.api.sync.diagnose()
      if (res.success) {
        const steps = res.data as DiagStep[]
        setDiagSteps(steps)
        if (steps.every(s => s.ok)) toast.success('All checks passed - sync should work')
        else toast.error('Issue found - check diagnosis below')
      } else {
        toast.error('Diagnose failed: ' + (res as { error?: string }).error)
      }
    } catch (e: any) {
      toast.error(e?.message || 'Diagnose failed')
    } finally {
      setDiagnosing(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Sync Dashboard"
        subtitle="Offline-first queue, conflict, and cloud synchronization status"
        actions={
          <div className="flex gap-2">
            {canManageSync && (status.failed > 0 || status.pending > 0) && (
              <button onClick={handleFixAndSync} disabled={syncing} className="btn-secondary btn-sm gap-1.5 text-yellow-400">
                <AlertCircle size={14} /> Fix & Retry
              </button>
            )}
            {canManageSync && status.failed > 0 && (
              <button onClick={handleResetFailed} className="btn-secondary btn-sm gap-1.5 text-slate-400">
                <AlertCircle size={14} /> Reset Failed
              </button>
            )}
            {canManageSync ? (
              <>
                <button onClick={handleDiagnose} disabled={diagnosing} className="btn-secondary btn-sm gap-1.5">
                  <FlaskConical size={14} className={diagnosing ? 'animate-pulse' : ''} />
                  {diagnosing ? 'Diagnosing...' : 'Diagnose'}
                </button>
                <button onClick={handleSync} disabled={syncing} className="btn-primary btn-sm gap-1.5">
                  <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                  {syncing ? 'Syncing...' : 'Sync Now'}
                </button>
              </>
            ) : (
              <span className="badge-blue">Auto sync enabled</span>
            )}
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <StatusCard
            icon={status.online ? Wifi : WifiOff}
            tone={status.online ? 'green' : 'red'}
            value={status.online ? 'Online' : 'Offline'}
            label={status.online ? 'Connected to cloud' : 'Working locally'}
          />
          <StatusCard icon={Clock} tone={status.pending > 0 ? 'yellow' : 'green'} value={status.pending} label="Pending sync items" />
          <StatusCard icon={status.failed > 0 ? AlertCircle : CheckCircle2} tone={status.failed > 0 ? 'red' : 'green'} value={status.failed} label="Failed sync items" />
          <StatusCard icon={Activity} tone="blue" value={syncing ? 'Syncing' : 'Ready'} label={canManageSync ? 'Manual and background sync' : 'Automatic background sync'} spinning={syncing} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="card xl:col-span-2">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Sync Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <InfoRow label="Connection Status" value={status.online ? 'Online' : 'Offline'} valueClass={status.online ? 'text-green-400' : 'text-red-400'} />
              <InfoRow label="Last Successful Sync" value={status.last_sync ? new Date(status.last_sync).toLocaleString() : 'Never'} />
              <InfoRow label="Pending Items" value={String(status.pending)} valueClass={status.pending > 0 ? 'text-yellow-400' : 'text-green-400'} />
              <InfoRow label="Failed Items" value={String(status.failed)} valueClass={status.failed > 0 ? 'text-red-400' : 'text-green-400'} />
            </div>
          </div>

          <div className="card">
            <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Offline Guarantees</h3>
            <div className="space-y-3 text-sm" style={{ color: 'var(--text-3)' }}>
              <p>POS billing, product search, invoice hold, receipt printing, returns, and credit sales continue locally.</p>
              <p>Each transaction is stored in SQLite first, then queued for cloud sync when connectivity returns.</p>
            </div>
          </div>
        </div>

        {diagSteps.length > 0 && (
          <div className="card">
            <h3 className="font-semibold text-sm mb-3 flex items-center gap-2" style={{ color: 'var(--text-1)' }}>
              <FlaskConical size={14} className="text-brand-400" /> Diagnosis Results
            </h3>
            <div className="space-y-2">
              {diagSteps.map(s => (
                <div key={s.step} className="flex items-start gap-3 text-sm">
                  {s.ok
                    ? <CheckCircle2 size={16} className="text-green-400 mt-0.5 flex-shrink-0" />
                    : <AlertCircle size={16} className="text-red-400 mt-0.5 flex-shrink-0" />
                  }
                  <div>
                    <span className="font-medium" style={{ color: 'var(--text-1)' }}>{s.step}</span>
                    <span className={`ml-2 text-xs ${s.ok ? 'text-slate-400' : 'text-red-400'}`}>{s.detail}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Sync Queue</h3>
            <span className="badge-blue">{queue.length} item{queue.length === 1 ? '' : 's'}</span>
          </div>

          {queue.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr>
                    <th className="table-header">Table</th>
                    <th className="table-header">Operation</th>
                    <th className="table-header">Status</th>
                    <th className="table-header">Attempts</th>
                    <th className="table-header">Last Error</th>
                    <th className="table-header"></th>
                  </tr>
                </thead>
                <tbody>
                  {queue.map(item => (
                    <tr key={item.id} className="table-row">
                      <td className="table-cell font-mono">{item.table_name}</td>
                      <td className="table-cell"><span className={operationClass(item.operation)}>{item.operation}</span></td>
                      <td className="table-cell"><span className={item.status === 'failed' ? 'badge-red' : 'badge-yellow'}>{item.status}</span></td>
                      <td className="table-cell">{item.attempts}</td>
                      <td className="table-cell text-red-400 max-w-xs truncate" title={item.last_error || ''}>{item.last_error || '-'}</td>
                      <td className="table-cell text-right">
                        {canManageSync && (
                          <button
                            onClick={async () => {
                              try {
                                const res = await window.api.sync.discardItem(item.id)
                                if (res.success) {
                                  toast.success('Item discarded')
                                  await loadQueue()
                                } else {
                                  toast.error(res.error || 'Failed to discard item')
                                }
                              } catch (e: any) {
                                toast.error(e?.message || 'Failed to discard item')
                              }
                            }}
                            className="text-slate-500 hover:text-red-400 transition-colors"
                            title="Discard this stuck item"
                          >
                            <Trash2 size={13} />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="text-center py-10">
              <CheckCircle2 size={34} className="text-green-400 mx-auto mb-3" />
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Sync queue is clear</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Offline transactions will appear here until they are sent to the cloud ERP.</p>
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Sync Architecture</h3>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm" style={{ color: 'var(--text-3)' }}>
            {[
              ['Local-First Operations', 'Every transaction is saved instantly to local SQLite for zero data loss during outages.'],
              ['Background Sync Queue', 'Changes are queued automatically and sent to the cloud ERP when online. Branch staff do not need a manual sync button.'],
              ['Conflict Handling', 'Failed syncs retry before being marked failed so staff can diagnose or retry manually.'],
            ].map(([title, detail], i) => (
              <div key={title} className="rounded-lg border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                <div className="w-7 h-7 bg-brand-600/20 rounded-full flex items-center justify-center text-xs font-bold text-brand-400">{i + 1}</div>
                <p className="font-medium mt-3" style={{ color: 'var(--text-1)' }}>{title}</p>
                <p className="text-xs mt-1">{detail}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function StatusCard({ icon: Icon, tone, value, label, spinning }: {
  icon: typeof Wifi
  tone: 'green' | 'red' | 'yellow' | 'blue'
  value: string | number
  label: string
  spinning?: boolean
}) {
  const colors = {
    green: 'bg-green-500/20 text-green-400',
    red: 'bg-red-500/20 text-red-400',
    yellow: 'bg-yellow-500/20 text-yellow-400',
    blue: 'bg-blue-500/20 text-blue-400',
  }
  return (
    <div className="card text-center">
      <div className={`w-12 h-12 rounded-full flex items-center justify-center mx-auto mb-3 ${colors[tone]}`}>
        <Icon size={22} className={spinning ? 'animate-spin' : ''} />
      </div>
      <p className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>{value}</p>
      <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{label}</p>
    </div>
  )
}

function InfoRow({ label, value, valueClass = '' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex justify-between gap-4 items-center rounded-lg px-3 py-2" style={{ background: 'var(--bg-soft)' }}>
      <span className="text-sm" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`text-sm font-medium text-right ${valueClass}`} style={valueClass ? undefined : { color: 'var(--text-1)' }}>{value}</span>
    </div>
  )
}

function operationClass(operation: string) {
  if (operation === 'INSERT') return 'badge-green'
  if (operation === 'UPDATE') return 'badge-blue'
  return 'badge-red'
}
