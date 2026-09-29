import { useState, useEffect, useCallback } from 'react'
import toast from 'react-hot-toast'

interface SyncStatus {
  pending: number
  failed: number
  last_sync?: string
  online: boolean
  running?: boolean
  error?: string | null
  pull_errors?: Record<string, string>
}

let lastOnlineSyncAt = 0

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({ pending: 0, failed: 0, online: navigator.onLine })

  // Keep this callback stable. Consumers use it in effect dependencies; a new
  // function on every render can turn refresh -> setState -> render into an
  // unbounded IPC loop (the Sync Monitor page hit exactly that path).
  const refresh = useCallback(async () => {
    try {
      const res = await window.api.sync.status()
      if (!res.success) return
      // Polled every 10s — only replace the object (and re-render every
      // consumer, e.g. AppLayout) when a field actually changed.
      setStatus(s => {
        const next = { ...s, ...(res.data as object) }
        const keys = Object.keys(next) as (keyof SyncStatus)[]
        return keys.every(k => next[k] === s[k]) ? s : next
      })
    } catch {}
  }, [])

  useEffect(() => {
    void refresh()
    const interval = setInterval(refresh, 10_000)
    const unsubscribeDataChanged = window.api.on('sync:dataChanged', () => { void refresh() })
    let onlineRefreshTimer: ReturnType<typeof setTimeout> | null = null
    const onOnline  = () => {
      setStatus(s => ({ ...s, online: true }))
      const now = Date.now()
      if (now - lastOnlineSyncAt > 15_000) {
        lastOnlineSyncAt = now
        window.api.sync.trigger().catch(() => undefined)
        onlineRefreshTimer = setTimeout(() => { void refresh() }, 1500)
      }
    }
    const onOffline = () => setStatus(s => ({ ...s, online: false }))
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(interval)
      unsubscribeDataChanged()
      if (onlineRefreshTimer) clearTimeout(onlineRefreshTimer)
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [refresh])

  const triggerSync = useCallback(async () => {
    const result = await window.api.sync.trigger()
    if (!result.success) toast.error(result.error || 'Synchronization incomplete')
    await refresh()
    return result.success
  }, [refresh])

  // Exposed so a page showing the full queue (SyncMonitorPage) can refresh
  // this status card at the exact same moment it reloads its own queue table
  // — previously each ran its own independent 10s setInterval, so the two
  // could transiently disagree (e.g. status card shows 0 while the table
  // still shows 1) for up to ~10s whenever a queue-changing event landed
  // between their two ticks.
  return { status, triggerSync, refresh }
}
