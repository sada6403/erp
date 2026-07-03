import { useState, useEffect } from 'react'

interface SyncStatus {
  pending: number
  failed: number
  last_sync?: string
  online: boolean
}

let lastOnlineSyncAt = 0

export function useSyncStatus() {
  const [status, setStatus] = useState<SyncStatus>({ pending: 0, failed: 0, online: navigator.onLine })

  const refresh = async () => {
    try {
      const res = await window.api.sync.status()
      if (res.success) setStatus(s => ({ ...s, ...(res.data as object) }))
    } catch {}
  }

  useEffect(() => {
    refresh()
    const interval = setInterval(refresh, 10_000)
    const onOnline  = () => {
      setStatus(s => ({ ...s, online: true }))
      const now = Date.now()
      if (now - lastOnlineSyncAt > 15_000) {
        lastOnlineSyncAt = now
        window.api.sync.trigger().catch(() => undefined)
        setTimeout(refresh, 1500)
      }
    }
    const onOffline = () => setStatus(s => ({ ...s, online: false }))
    window.addEventListener('online',  onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      clearInterval(interval)
      window.removeEventListener('online',  onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [])

  const triggerSync = async () => {
    await window.api.sync.trigger()
    await refresh()
  }

  return { status, triggerSync }
}
