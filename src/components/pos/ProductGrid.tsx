import { useState, useEffect, useRef, useCallback } from 'react'
import type { Product } from '@/types'
import { Package, AlertCircle } from 'lucide-react'

interface Props {
  categoryId: string | null
  onSelect: (product: Product) => void
}

export default function ProductGrid({ categoryId, onSelect }: Props) {
  const [products, setProducts] = useState<Product[]>([])
  const [loading, setLoading]   = useState(true)
  const [focused, setFocused]   = useState(0)
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
    <div ref={gridRef} onKeyDown={handleKeyDown}
      className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-3">
      {products.map((product, idx) => (
        <ProductCard
          key={product.id}
          product={product}
          isFocused={focused === idx}
          onFocus={() => setFocused(idx)}
          onSelect={() => onSelect(product)}
        />
      ))}
    </div>
  )
}

function ProductCard({ product, isFocused, onFocus, onSelect }: {
  product: Product; isFocused: boolean
  onFocus: () => void; onSelect: () => void
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
    </div>
  )
}
