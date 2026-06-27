import { useState, useEffect, useRef } from 'react'
import type { Product } from '@/types'
import { GitPullRequestArrow, Package } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface Props {
  query: string
  onSelect: (product: Product) => void
}

export default function ProductSearch({ query, onSelect }: Props) {
  const [results, setResults] = useState<Product[]>([])
  const [loading, setLoading] = useState(false)
  const [focused, setFocused] = useState(0)
  const [availability, setAvailability] = useState<Record<string, Record<string, unknown>[]>>({})
  const user = useAuthStore(s => s.user)
  const currentBranchId = user?.branch?.id || (user as unknown as Record<string, string>)?.branch_id

  useEffect(() => {
    if (!query) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await window.api.products.search(query)
        if (res.success) setResults(res.data as Product[])
        setFocused(0)
      } finally { setLoading(false) }
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    if (!results.length) { setAvailability({}); return }
    let alive = true
    Promise.all(results.slice(0, 12).map(async product => {
      const res = await window.api.stocks.availability(product.id)
      return [product.id, res.success ? res.data as Record<string, unknown>[] : []] as const
    })).then(entries => {
      if (!alive) return
      setAvailability(Object.fromEntries(entries))
    })
    return () => { alive = false }
  }, [results])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f+1, results.length-1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f-1, 0)) }
      if (e.key === 'Enter' && results[focused]) { e.preventDefault(); onSelect(results[focused]) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, focused, onSelect])

  const requestStock = async (product: Product, branch: Record<string, unknown>) => {
    if (!currentBranchId) { toast.error('Current branch is not set'); return }
    const max = Number(branch.available_quantity || branch.quantity || 0)
    const raw = prompt(`Request quantity from ${branch.branch_name as string}`, String(Math.min(1, max)))
    if (!raw) return
    const quantity = parseInt(raw)
    if (!quantity || quantity <= 0) { toast.error('Enter a valid quantity'); return }
    if (quantity > max) { toast.error(`Only ${max} available at ${branch.branch_name as string}`); return }
    const res = await window.api.stocks.transfer({
      product_id: product.id,
      from_branch_id: branch.branch_id,
      to_branch_id: currentBranchId,
      quantity,
      notes: `POS stock request for ${product.name}`,
    })
    if (res.success) toast.success(`Stock request created from ${branch.branch_name as string}`)
    else toast.error(res.error || 'Stock request failed')
  }

  if (loading) return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="h-20 rounded-lg pos-skeleton" />
      ))}
    </div>
  )

  if (results.length === 0 && query) return (
    <div className="flex flex-col items-center justify-center h-40 enterprise-panel" style={{ color: 'var(--text-3)' }}>
      <Package size={32} className="mb-2 opacity-40" />
      <p className="text-sm" style={{ color: 'var(--text-2)' }}>No products found for "{query}"</p>
      <p className="text-xs mt-1">Search by name, SKU, or barcode.</p>
    </div>
  )

  return (
    <div className="space-y-2">
      {results.map((product, idx) => {
        const outOfStock = !product.stock || product.stock <= 0
        const branches = (availability[product.id] || [])
          .filter(a => String(a.branch_id) !== String(currentBranchId) && Number(a.available_quantity || 0) > 0)
        return (
          <div key={product.id}
            onClick={() => !outOfStock && onSelect(product)}
            className={`rounded-lg cursor-pointer transition-all border
              ${idx === focused ? 'pos-search-row-focused' : 'pos-search-row'}
              ${outOfStock ? 'opacity-50 cursor-not-allowed' : ''}`}>
            <div className="flex items-center gap-4 px-4 py-3">
              <div className="pos-product-media w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border">
                {product.image_url
                  ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover rounded-lg" />
                  : <Package size={20} style={{ color: 'var(--text-3)' }} />}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{product.name}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{product.sku}</p>
              </div>
              <div className="text-right flex-shrink-0">
                <p className="font-bold text-brand-400">Rs.{product.selling_price.toLocaleString()}</p>
                {outOfStock
                  ? <span className="badge-red text-xs">Out of Stock</span>
                  : <span className="text-xs" style={{ color: 'var(--text-3)' }}>Stock: {product.stock}</span>
                }
              </div>
            </div>
            {branches.length > 0 && (
              <div className="px-4 pb-3 -mt-1">
                <div className="flex items-center gap-2 overflow-x-auto pb-1">
                  {branches.map(branch => (
                    <button
                      key={String(branch.branch_id)}
                      onClick={e => { e.stopPropagation(); requestStock(product, branch) }}
                      className="flex items-center gap-2 rounded-lg border border-cyan-700/50 bg-cyan-950/30 px-3 py-2 text-left text-xs text-cyan-200 hover:bg-cyan-900/40 flex-shrink-0"
                    >
                      <GitPullRequestArrow size={13} />
                      <span>
                        <span className="block font-semibold">{branch.branch_name as string}</span>
                        <span className="block text-cyan-400">{Number(branch.available_quantity || 0)} available - Request</span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
