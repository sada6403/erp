import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '@/store/authStore'

const normalize = (value: unknown) => String(value || '').trim().toLowerCase()

/** Keep module visibility in step with company branding/settings updates. */
export function useBusinessType() {
  const fallback = useAuthStore(s => normalize(s.user?.business_type))
  const [businessType, setBusinessType] = useState(fallback)
  const [stockEnabled, setStockEnabled] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const refresh = useCallback(async () => {
    try {
      const response = await window.api.settings.get()
      if (!response.success) throw new Error(response.error || 'Could not load company settings')
      setStockEnabled(response.data?.supermarket_stock_enabled === true || response.data?.supermarket_stock_enabled === 1)
      setBusinessType(normalize(response.data?.business_type) || fallback)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally { setLoading(false) }
  }, [fallback])
  useEffect(() => {
    void refresh()
    const off = window.api.on?.('settings:updated', refresh)
    const focus = () => { void refresh() }
    window.addEventListener('focus', focus)
    return () => { off?.(); window.removeEventListener('focus', focus) }
  }, [refresh])
  return { businessType, isSupermarket: businessType === 'supermarket' || stockEnabled, loading, error, refresh }
}
