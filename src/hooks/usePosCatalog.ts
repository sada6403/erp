import { useEffect, useState } from 'react'
import { PosCatalog } from '@/lib/posCatalog'
import type { Product } from '@/types'

/** Scoped to the mounted cashier and branch; never shares data across logins. */
export function usePosCatalog(branchId?: string, userId?: string, sessionKey?: string) {
  const [snapshot, setSnapshot] = useState<{ branchId?: string; userId?: string; sessionKey?: string; catalog: PosCatalog }>()
  const [error, setError] = useState('')
  useEffect(() => {
    let disposed = false
    let running = false
    let dirty = false
    const refresh = async () => {
      if (running) { dirty = true; return }
      running = true
      try {
        do {
          dirty = false
          const res = await window.api.products.list({ is_active: true, ...(branchId ? { branch_id: branchId } : {}) })
          if (!res.success) throw new Error(res.error || 'Cannot load local catalog')
          const aliases = window.api.keywords ? await window.api.keywords.snapshot() : undefined
          if (aliases && !aliases.success) throw new Error(aliases.error || 'Cannot load local keywords')
          if (aliases?.data.enabled && userId && aliases.data.context.userId !== userId) throw new Error('Cashier changed; reload catalog')
          if (!disposed) {
            setSnapshot({ branchId, userId, sessionKey, catalog: new PosCatalog(res.data as Product[], aliases?.data.enabled ? aliases.data : undefined) })
            setError('')
          }
        } while (dirty && !disposed)
      } catch (err) {
        if (!disposed) setError((err as Error).message)
      } finally { running = false }
    }
    void refresh()
    const unsubscribe = window.api.on('sync:dataChanged', () => { void refresh() })
    const offKeywords = window.api.keywords ? window.api.on('keywords:changed', () => { setSnapshot(undefined); void refresh() }) : undefined
    const onFocus = () => { void refresh() }
    window.addEventListener('focus', onFocus)
    window.addEventListener('pos:catalog-refresh', onFocus)
    // Safety net for existing inventory writers without change notifications.
    const timer = setInterval(onFocus, 60_000)
    return () => {
      disposed = true
      clearInterval(timer)
      unsubscribe()
      offKeywords?.()
      window.removeEventListener('focus', onFocus)
      window.removeEventListener('pos:catalog-refresh', onFocus)
    }
  }, [branchId, userId, sessionKey])
  return { catalog: snapshot?.branchId === branchId && snapshot?.userId === userId && snapshot?.sessionKey === sessionKey ? snapshot?.catalog : undefined, error }
}
