import { useState, useEffect, useRef, useCallback } from 'react'
import type { Product } from '@/types'
import { Package, AlertCircle, MapPin, ArrowRightLeft, Check } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

interface Props {
  categoryId: string | null
  onSelect: (product: Product) => void
}

interface BranchStock {
  branch_id: string
  branch_name: string
  available_quantity: number
}

// ─── Cross-Branch Availability Modal ─────────────────────────────────────────
function CrossBranchModal({
  product, onClose
}: {
  product: Product
  onClose: () => void
}) {
  const { user } = useAuthStore()
  const u = user as unknown as Record<string, unknown>
  const myBranchId = String(u?.branch_id ?? '')

  const [branches, setBranches]   = useState<BranchStock[]>([])
  const [loading, setLoading]     = useState(true)
  const [selected, setSelected]   = useState<string | null>(null)
  const [qty, setQty]             = useState(1)
  const [requesting, setRequesting] = useState(false)
  const [done, setDone]           = useState(false)

  const selectedBranch = branches.find(b => b.branch_id === selected)
  const maxQty = Number(selectedBranch?.available_quantity || 1)
  const requestQty = Math.max(1, Math.min(qty || 1, maxQty))

  useEffect(() => {
    window.api.stocks.availability(product.id)
      .then((res: any) => {
        if (res.success) {
          const available = (res.data as BranchStock[]).filter(
            b => b.branch_id !== myBranchId && b.available_quantity > 0
          )
          setBranches(available)
        }
      })
      .finally(() => setLoading(false))
  }, [product.id, myBranchId])

  const requestTransfer = async () => {
    if (!selected) return
    setRequesting(true)
    try {
      const res = await window.api.stocks.transfer({
        product_id:     product.id,
        from_branch_id: selected,
        to_branch_id:   myBranchId,
        quantity:       requestQty,
        notes:          `Requested from POS — ${product.name} out of stock`,
      })
      if (res.success) {
        setDone(true)
        toast.success('Transfer requested — pending approval')
      } else {
        toast.error(res.error || 'Request failed')
      }
    } finally {
      setRequesting(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[998] flex items-center justify-center p-4"
      style={{ background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
        onClick={e => e.stopPropagation()}>

        {/* Header */}
        <div className="px-5 pt-5 pb-4" style={{ borderBottom: '1px solid var(--border)' }}>
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-orange-500/15">
              <AlertCircle size={18} className="text-orange-400" />
            </div>
            <div>
              <p className="text-xs font-semibold text-orange-400">OUT OF STOCK</p>
              <p className="font-bold leading-tight" style={{ color: 'var(--text-1)' }}>{product.name}</p>
            </div>
          </div>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            Select a branch to request a stock transfer to your branch.
          </p>
        </div>

        {/* Body */}
        <div className="px-5 py-4">
          {loading && (
            <div className="space-y-2">
              {[1, 2].map(i => <div key={i} className="h-14 rounded-xl animate-pulse" style={{ background: 'var(--bg-soft)' }} />)}
            </div>
          )}

          {!loading && branches.length === 0 && (
            <div className="text-center py-6">
              <MapPin size={32} className="mx-auto mb-2 opacity-30" style={{ color: 'var(--text-3)' }} />
              <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No stock available elsewhere</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>None of the other branches have this product in stock.</p>
            </div>
          )}

          {!loading && branches.length > 0 && !done && (
            <div className="space-y-2">
              <p className="text-xs font-medium mb-3" style={{ color: 'var(--text-2)' }}>
                Available at {branches.length} branch{branches.length > 1 ? 'es' : ''}:
              </p>
              {branches.map(b => (
                <button key={b.branch_id}
                  onClick={() => {
                    setSelected(s => s === b.branch_id ? null : b.branch_id)
                    setQty(q => Math.max(1, Math.min(q || 1, b.available_quantity)))
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all border ${
                    selected === b.branch_id
                      ? 'border-brand-500 bg-brand-500/10'
                      : 'hover:border-[var(--border)]'
                  }`}
                  style={{ borderColor: selected === b.branch_id ? undefined : 'var(--border)', background: selected === b.branch_id ? undefined : 'var(--bg-soft)' }}>
                  <MapPin size={15} className={selected === b.branch_id ? 'text-brand-400' : ''} style={selected !== b.branch_id ? { color: 'var(--text-3)' } : undefined} />
                  <div className="flex-1">
                    <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{b.branch_name}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{b.available_quantity} units available</p>
                  </div>
                  {selected === b.branch_id && (
                    <div className="w-5 h-5 rounded-full bg-brand-500 flex items-center justify-center">
                      <Check size={11} className="text-white" />
                    </div>
                  )}
                </button>
              ))}
              {selectedBranch && (
                <div className="rounded-xl border p-3 mt-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <label className="text-xs font-semibold" style={{ color: 'var(--text-2)' }}>Quantity to request</label>
                  <input
                    className="input mt-2 text-center text-lg font-bold"
                    type="number"
                    min={1}
                    max={maxQty}
                    value={qty}
                    onChange={e => setQty(Number(e.target.value))}
                  />
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Maximum available at {selectedBranch.branch_name}: {maxQty}
                  </p>
                </div>
              )}
            </div>
          )}

          {done && (
            <div className="text-center py-6">
              <div className="w-14 h-14 rounded-2xl bg-green-500/15 flex items-center justify-center mx-auto mb-3">
                <Check size={28} className="text-green-400" />
              </div>
              <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Transfer Requested!</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Waiting for approval from the source branch.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 pb-5 flex gap-2">
          <button onClick={onClose} className="flex-1 btn-secondary">
            {done ? 'Close' : 'Cancel'}
          </button>
          {!done && branches.length > 0 && (
            <button
              onClick={requestTransfer}
              disabled={!selected || requesting}
              className="flex-1 btn-primary flex items-center justify-center gap-1.5 disabled:opacity-50"
            >
              <ArrowRightLeft size={13} />
              {requesting ? 'Requesting…' : 'Request Transfer'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Product Grid ─────────────────────────────────────────────────────────────
export default function ProductGrid({ categoryId, onSelect }: Props) {
  const [products, setProducts]         = useState<Product[]>([])
  const [loading, setLoading]           = useState(true)
  const [focused, setFocused]           = useState(0)
  const [checkProduct, setCheckProduct] = useState<Product | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setLoading(true)
    window.api.products.list({ category_id: categoryId || undefined, is_active: true })
      .then((res: any) => {
        if (res.success) setProducts(res.data as Product[])
        setFocused(0)
      })
      .finally(() => setLoading(false))
  }, [categoryId])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const cols = Math.floor((gridRef.current?.offsetWidth || 700) / 180)
    if (e.key === 'ArrowRight') { e.preventDefault(); setFocused(f => Math.min(f+1, products.length-1)) }
    if (e.key === 'ArrowLeft')  { e.preventDefault(); setFocused(f => Math.max(f-1, 0)) }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setFocused(f => Math.min(f+cols, products.length-1)) }
    if (e.key === 'ArrowUp')    { e.preventDefault(); setFocused(f => Math.max(f-cols, 0)) }
    if (e.key === 'Enter' && products[focused]) { e.preventDefault(); onSelect(products[focused]) }
  }, [products, focused, onSelect])

  if (loading) return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3 animate-pulse">
      {Array.from({ length: 12 }).map((_, i) => (
        <div key={i} className="rounded-lg h-56 pos-skeleton" />
      ))}
    </div>
  )

  if (products.length === 0) return (
    <div className="flex flex-col items-center justify-center h-64 enterprise-panel" style={{ color: 'var(--text-3)' }}>
      <Package size={42} className="mb-3 opacity-40" />
      <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>No products found</p>
      <p className="text-xs mt-1">Try another category or scan a barcode.</p>
    </div>
  )

  return (
    <>
      <div ref={gridRef} onKeyDown={handleKeyDown}
        className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
        {products.map((product, idx) => (
          <ProductCard
            key={product.id}
            product={product}
            isFocused={focused === idx}
            onFocus={() => setFocused(idx)}
            onSelect={() => onSelect(product)}
            onCheckBranches={() => setCheckProduct(product)}
          />
        ))}
      </div>

      {checkProduct && (
        <CrossBranchModal
          product={checkProduct}
          onClose={() => setCheckProduct(null)}
        />
      )}
    </>
  )
}

// ─── Product Card ─────────────────────────────────────────────────────────────
function ProductCard({ product, isFocused, onFocus, onSelect, onCheckBranches }: {
  product: Product; isFocused: boolean
  onFocus: () => void; onSelect: () => void; onCheckBranches: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const outOfStock = !product.stock || product.stock <= 0
  const lowStock = product.stock && product.stock <= product.min_stock_level

  useEffect(() => {
    if (isFocused) ref.current?.focus()
  }, [isFocused])

  return (
    <div
      ref={ref}
      tabIndex={0}
      onClick={outOfStock ? undefined : onSelect}
      onFocus={onFocus}
      className={`pos-product-card ${isFocused ? 'selected' : ''} ${outOfStock ? 'out-of-stock' : ''}`}
    >
      {/* Product image / icon */}
      <div className="pos-product-media w-full aspect-[4/3] rounded-lg flex items-center justify-center mb-3 overflow-hidden border">
        {product.image_url ? (
          <img src={product.image_url} alt={product.name}
            className="w-full h-full object-cover rounded-lg" />
        ) : (
          <Package size={32} style={{ color: 'var(--text-3)' }} />
        )}
      </div>

      {/* Info */}
      <p className="text-sm font-semibold leading-tight line-clamp-2 mb-1 min-h-10" style={{ color: 'var(--text-1)' }}>{product.name}</p>
      <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{product.sku}</p>

      <div className="flex items-center justify-between mt-2">
        <span className="text-sm font-bold text-brand-400">
          Rs.{product.selling_price.toLocaleString()}
        </span>
        {outOfStock ? (
          <span className="badge-red text-xs">Out</span>
        ) : lowStock ? (
          <span className="badge-yellow text-xs">{product.stock}</span>
        ) : (
          <span className="text-xs" style={{ color: 'var(--text-3)' }}>{product.stock}</span>
        )}
      </div>

      {/* Cross-branch check button for out-of-stock */}
      {outOfStock && (
        <button
          onClick={e => { e.stopPropagation(); onCheckBranches() }}
          className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-colors"
          style={{ background: 'var(--bg-soft)', color: 'var(--text-2)', border: '1px solid var(--border)' }}
        >
          <MapPin size={11} />
          Check Other Branches
        </button>
      )}
    </div>
  )
}
