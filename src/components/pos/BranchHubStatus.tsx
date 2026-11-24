import { useEffect, useState } from 'react'

interface Status { configured: boolean; hub_online: boolean; cloud: string; pending: number; recoverable?: number; blocked?: number; last_hold_number?: string; error?: string }

export default function BranchHubStatus() {
  const [status, setStatus] = useState<Status>({ configured: false, hub_online: false, cloud: 'unknown', pending: 0 })
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      try {
        const res = await window.api.holds.hubStatus()
        if (disposed) return
        const next = res.success ? res.data : { configured: true, hub_online: false, cloud: 'unknown', pending: 0, error: res.error }
        setStatus(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next)
      } catch { /* Older preload: leave the explicit unconfigured label. */ }
    }
    void refresh()
    const timer = setInterval(() => { void refresh() }, 5000)
    const unsubscribe = window.api.on?.('branchHub:changed', () => { void refresh() })
    return () => { disposed = true; clearInterval(timer); unsubscribe?.() }
  }, [])
  return <div className="px-3 py-1 text-xs border-b flex gap-4" style={{ borderColor: 'var(--border)' }} role="status" title={status.error || ''}>
    <span className={status.hub_online ? 'text-green-400' : 'text-orange-400'}>Hub: {status.configured ? status.hub_online ? 'Online' : 'Offline' : 'Not configured'}</span>
    <span>Hub cloud: {status.cloud === 'not_configured' ? 'Not configured' : status.cloud === 'online' ? 'Online' : 'Unknown'}</span>
    <span>Pending holds: {status.pending}</span>
    {status.blocked ? <strong className="text-red-400">Hold errors: {status.blocked} (F5)</strong> : null}
    {status.last_hold_number ? <strong className="text-yellow-400">Last hold: {status.last_hold_number}</strong> : null}
    {status.recoverable ? <span className="text-orange-400">Recovered holds: {status.recoverable} (F5)</span> : null}
    {status.error ? <span className="text-orange-400 truncate">{status.error}</span> : null}
  </div>
}
