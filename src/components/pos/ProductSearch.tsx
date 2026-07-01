import { useState, useEffect, useCallback } from 'react'
import type { Product } from '@/types'
import { Package, MapPin, ArrowRightLeft, Plus, Minus, Check, ChevronDown, ChevronUp, Loader2 } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface Props {
  query: string
  onSelect: (product: Product) => void
}

interface BranchAvail {
  branch_id: string
  branch_name: string
  available_quantity: number
  quantity: number
}

// ─── Branch Availability Panel ────────────────────────────────────────────────
function BranchPanel({ product, currentBranchId }: {
  product: Product
  currentBranchId: string
}) {
  const [branches, setBranches]     = useState<BranchAvail[]>([])
  const [loading, setLoading]       = useState(false)
  const [fetched, setFetched]       = useState(false)
  const [qtys, setQtys]             = useState<Record<string, number>>({})
  const [sent, setSent]             = useState<Record<string, boolean>>({})
  const [requesting, setRequesting] = useState<string | null>(null)

  const fetchBranches = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.stocks.availability(product.id)
      if (res.success) {
        const all = res.data as BranchAvail[]
        // Show all other branches — even 0 stock (greyed) so user has full picture
        const others = all.filter(b => String(b.branch_id) !== String(currentBranchId))
        setBranches(others)
      }
    } finally {
      setLoading(false)
      setFetched(true)
    }
  }, [product.id, currentBranchId])

  useEffect(() => { fetchBranches() }, [fetchBranches])

  const getQty = (branchId: string, max: number) => Math.min(qtys[branchId] ?? 1, Math.max(1, max))

  const changeQty = (branchId: string, max: number, delta: number) => {
    setQtys(q => ({ ...q, [branchId]: Math.max(1, Math.min(max, (q[branchId] ?? 1) + delta)) }))
  }

  const sendRequest = async (branch: BranchAvail) => {
    if (!currentBranchId) { toast.error('Current branch not set'); return }
    const qty = getQty(branch.branch_id, branch.available_quantity)
    setRequesting(branch.branch_id)
    try {
      const res = await window.api.stocks.transfer({
        product_id:     product.id,
        from_branch_id: branch.branch_id,
        to_branch_id:   currentBranchId,
        quantity:       qty,
        notes:          `POS request — ${product.name}`,
      })
      if (res.success) {
        setSent(s => ({ ...s, [branch.branch_id]: true }))
        toast.success(`Transfer requested from ${branch.branch_name}`)
      } else {
        toast.error(res.error || 'Request failed')
      }
    } finally {
      setRequesting(null)
    }
  }

  if (loading) return (
    <div className="flex items-center gap-2 py-3 px-1">
      <Loader2 size={13} className="animate-spin" style={{ color: 'var(--text-3)' }} />
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>Checking other branches…</span>
    </div>
  )

  if (fetched && branches.length === 0) return (
    <div className="py-3 px-1">
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>No other branches configured.</p>
    </div>
  )

  const available = branches.filter(b => b.available_quantity > 0)
  const empty     = branches.filter(b => b.available_quantity <= 0)

  return (
    <div className="space-y-2">
      {/* Branches with stock */}
      {available.map(branch => {
        const isSent = sent[branch.branch_id]
        const busy   = requesting === branch.branch_id
        const qty    = getQty(branch.branch_id, branch.available_quantity)
        return (
          <div key={branch.branch_id}
            className={`flex items-center gap-3 p-3 rounded-xl border transition-colors ${
              isSent ? 'border-green-700/40 bg-green-500/10' : ''
            }`}
            style={!isSent ? { borderColor: 'var(--border)', background: 'var(--bg-card)' } : undefined}>
            <MapPin size={14} className={isSent ? 'text-green-400' : 'text-orange-400'} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{branch.branch_name}</p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{branch.available_quantity} units available</p>
            </div>
            {isSent ? (
              <div className="flex items-center gap-1.5 text-green-400 text-xs font-semibold">
                <Check size={13} /> Requested
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1 rounded-lg border px-1 py-1" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <button onClick={e => { e.stopPropagation(); changeQty(branch.branch_id, branch.available_quantity, -1) }}
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-card)]" style={{ color: 'var(--text-2)' }}>
                    <Minus size={10} />
                  </button>
                  <span className="w-6 text-center text-sm font-bold tabular-nums" style={{ color: 'var(--text-1)' }}>{qty}</span>
                  <button onClick={e => { e.stopPropagation(); changeQty(branch.branch_id, branch.available_quantity, 1) }}
                    className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-card)]" style={{ color: 'var(--text-2)' }}>
                    <Plus size={10} />
                  </button>
                </div>
                <button onClick={e => { e.stopPropagation(); sendRequest(branch) }} disabled={busy}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white disabled:opacity-50 transition-colors">
                  <ArrowRightLeft size={11} />
                  {busy ? 'Sending…' : 'Request'}
                </button>
              </div>
            )}
          </div>
        )
      })}

      {/* Branches with 0 stock — shown greyed */}
      {empty.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs px-1" style={{ color: 'var(--text-3)' }}>No stock at:</p>
          {empty.map(branch => (
            <div key={branch.branch_id}
              className="flex items-center gap-3 px-3 py-2 rounded-lg opacity-50"
              style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
              <MapPin size={13} style={{ color: 'var(--text-3)' }} />
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>{branch.branch_name}</span>
              <span className="ml-auto text-xs badge-red">0 units</span>
            </div>
          ))}
        </div>
      )}

      {available.length === 0 && fetched && (
        <div className="px-1 py-2">
          <p className="text-xs text-orange-400 font-medium">No stock available at any other branch.</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Contact your supplier or raise a purchase order.</p>
        </div>
      )}
    </div>
  )
}

// ─── Product Search ───────────────────────────────────────────────────────────
export default function ProductSearch({ query, onSelect }: Props) {
  const [results, setResults]       = useState<Product[]>([])
  const [loading, setLoading]       = useState(false)
  const [focused, setFocused]       = useState(0)
  const [expanded, setExpanded]     = useState<string | null>(null)

  const user = useAuthStore(s => s.user)
  const currentBranchId = String(
    user?.branch?.id || (user as unknown as Record<string, string>)?.branch_id || ''
  )

  useEffect(() => {
    if (!query) { setResults([]); setExpanded(null); return }
    const t = setTimeout(async () => {
      setLoading(true)
      try {
        const res = await window.api.products.search(query)
        if (res.success) { setResults(res.data as Product[]); setFocused(0) }
      } finally { setLoading(false) }
    }, 150)
    return () => clearTimeout(t)
  }, [query])

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setFocused(f => Math.min(f+1, results.length-1)) }
      if (e.key === 'ArrowUp')   { e.preventDefault(); setFocused(f => Math.max(f-1, 0)) }
      if (e.key === 'Enter' && results[focused]) { e.preventDefault(); onSelect(results[focused]) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [results, focused, onSelect])

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
        const lowStock   = !outOfStock && (product.stock ?? 0) <= product.min_stock_level
        const needsCheck = outOfStock || lowStock
        const isExpanded = expanded === product.id

        return (
          <div key={product.id}
            className={`rounded-xl border overflow-hidden transition-all ${
              idx === focused ? 'pos-search-row-focused' : 'pos-search-row'
            } ${needsCheck ? 'border-orange-700/25' : ''}`}>

            {/* ── Main row ── */}
            <div
              onClick={() => !outOfStock && onSelect(product)}
              className={`flex items-center gap-4 px-4 py-3 ${outOfStock ? 'cursor-not-allowed opacity-80' : 'cursor-pointer'}`}
            >
              <div className="pos-product-media w-14 h-14 rounded-lg flex items-center justify-center flex-shrink-0 overflow-hidden border">
                {product.image_url
                  ? <img src={product.image_url} alt={product.name} className="w-full h-full object-cover rounded-lg" />
                  : <Package size={20} style={{ color: 'var(--text-3)' }} />}
              </div>

              <div className="flex-1 min-w-0">
                <p className="font-semibold text-sm truncate" style={{ color: 'var(--text-1)' }}>{product.name}</p>
                <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{product.sku}</p>
              </div>

              <div className="text-right flex-shrink-0 mr-2">
                <p className="font-bold text-brand-400">Rs.{product.selling_price.toLocaleString()}</p>
                {outOfStock
                  ? <span className="badge-red text-xs">Out of Stock</span>
                  : lowStock
                    ? <span className="badge-yellow text-xs">Low: {product.stock}</span>
                    : <span className="text-xs" style={{ color: 'var(--text-3)' }}>Stock: {product.stock}</span>
                }
              </div>

              {/* Always-visible "Check Branches" button for out/low stock */}
              {needsCheck && (
                <button
                  onClick={e => {
                    e.stopPropagation()
                    setExpanded(p => p === product.id ? null : product.id)
                  }}
                  className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold flex-shrink-0 transition-all border ${
                    isExpanded
                      ? 'bg-orange-600 text-white border-orange-500'
                      : 'border-orange-700/50 text-orange-400 hover:bg-orange-500/15'
                  }`}
                  style={isExpanded ? undefined : { background: 'color-mix(in srgb, #f97316 8%, transparent)' }}
                  title="Check stock at other branches"
                >
                  <MapPin size={12} />
                  <span>Branches</span>
                  {isExpanded ? <ChevronUp size={11} /> : <ChevronDown size={11} />}
                </button>
              )}
            </div>

            {/* ── Branch panel (lazy-loaded when expanded) ── */}
            {needsCheck && isExpanded && (
              <div className="border-t px-4 pb-4 pt-3" style={{ borderColor: 'var(--border)', background: 'color-mix(in srgb, var(--bg-soft) 50%, transparent)' }}>
                <p className="text-xs font-semibold mb-3 flex items-center gap-1.5" style={{ color: 'var(--text-2)' }}>
                  <ArrowRightLeft size={11} className="text-orange-400" />
                  Stock availability at other branches
                </p>
                <BranchPanel product={product} currentBranchId={currentBranchId} />
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
