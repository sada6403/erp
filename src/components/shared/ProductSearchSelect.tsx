import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Package, Search } from 'lucide-react'
import { resolveImageSrc } from '@/lib/imageUrl'

export function ProductThumb({ imageUrl, size = 28 }: { imageUrl?: unknown; size?: number }) {
  const src = resolveImageSrc(typeof imageUrl === 'string' ? imageUrl : '')
  return (
    <div
      className="rounded flex items-center justify-center flex-shrink-0 overflow-hidden"
      style={{ width: size, height: size, background: 'var(--bg-page)', border: '1px solid var(--border)' }}
    >
      {src
        ? <img src={src} alt="" className="w-full h-full object-cover" />
        : <Package size={size * 0.5} style={{ color: 'var(--text-3)' }} />}
    </div>
  )
}

export default function ProductSearchSelect({
  products, value, onChange
}: {
  products: Record<string, unknown>[]
  value: string
  onChange: (id: string) => void
}) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const ref     = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = products.find(p => String(p.id) === value)
  const filtered = products.filter(p => {
    const q = query.toLowerCase()
    return (
      String(p.name).toLowerCase().includes(q) ||
      String(p.sku || '').toLowerCase().includes(q)
    )
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // Reset highlight when filter changes
  useEffect(() => { setHighlighted(0) }, [query])

  // Scroll highlighted item into view
  useEffect(() => {
    if (!listRef.current) return
    const item = listRef.current.children[highlighted] as HTMLElement | undefined
    item?.scrollIntoView({ block: 'nearest' })
  }, [highlighted])

  const openDropdown = () => { setOpen(true); setQuery(''); setHighlighted(0) }

  const select = (id: string) => {
    onChange(id)
    setQuery('')
    setOpen(false)
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openDropdown() } return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, filtered.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); if (filtered[highlighted]) select(String(filtered[highlighted].id)) }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    else if (e.key === 'Tab')   { setOpen(false) }
  }

  return (
    <div ref={ref} className="relative min-w-0 w-full">
      <div
        tabIndex={0}
        className="input text-sm py-1.5 flex items-center gap-2 cursor-pointer overflow-hidden focus:outline-none"
        onClick={openDropdown}
        onKeyDown={onKeyDown}
      >
        {selected && <ProductThumb imageUrl={selected.image_url} size={24} />}
        <span className="min-w-0 flex-1 truncate" style={{ color: selected ? 'var(--text-1)' : 'var(--text-3)' }}>
          {selected ? `${String(selected.name)} (${String(selected.sku || '')})` : 'Select product...'}
        </span>
        <ChevronDown size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
      </div>

      {open && (
        <div className="absolute z-50 top-full mt-1 left-0 right-0 rounded-lg shadow-xl border"
          style={{ background: 'var(--bg-card)', borderColor: 'var(--border-2)' }}>
          <div className="flex items-center gap-2 px-2 py-1.5" style={{ borderBottom: '1px solid var(--border)' }}>
            <Search size={12} style={{ color: 'var(--text-3)', flexShrink: 0 }} />
            <input
              autoFocus
              type="text"
              placeholder="Search product or SKU..."
              className="bg-transparent text-sm outline-none w-full"
              style={{ color: 'var(--text-1)' }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="text-xs text-center py-3" style={{ color: 'var(--text-3)' }}>No products found</p>
            ) : filtered.map((p, i) => (
              <div
                key={String(p.id)}
                onClick={() => select(String(p.id))}
                onMouseEnter={() => setHighlighted(i)}
                className="px-3 py-2 text-sm cursor-pointer flex items-center gap-2 transition-colors"
                style={{
                  background: i === highlighted ? 'var(--bg-soft)' : 'transparent',
                  color: String(p.id) === value ? 'var(--brand-500, #6366f1)' : 'var(--text-1)',
                }}
              >
                <ProductThumb imageUrl={p.image_url} />
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium leading-tight">{String(p.name)}</p>
                  <p className="text-xs truncate leading-tight" style={{ color: 'var(--text-3)' }}>{String(p.sku || '')}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
