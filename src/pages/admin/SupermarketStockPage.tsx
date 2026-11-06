import { Navigate } from 'react-router-dom'
import { useBusinessType } from '@/hooks/useBusinessType'
import SupermarketOverview from './SupermarketOverview'
export default function SupermarketStockPage({ view = 'stock' }: { view?: 'stock' | 'investments' }) {
  const { isSupermarket, loading, error, refresh } = useBusinessType()
  if (loading) return <div className="p-6">Loading...</div>
  if (error) return <div className="p-6"><p role="alert">{error}</p><button className="btn-secondary" onClick={refresh}>Retry</button></div>
  return isSupermarket ? <SupermarketOverview view={view} /> : <Navigate to="/admin" replace />
}
