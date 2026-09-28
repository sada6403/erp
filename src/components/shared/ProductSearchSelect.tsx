import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
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
  const [dropdownStyle, setDropdownStyle] = useState<CSSProperties>({})
  const ref     = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)
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
      const target = e.target as Node
      if (!ref.current?.contains(target) && !dropdownRef.current?.contains(target)) setOpen(false)
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

  const positionDropdown = useCallback(() => {
    const trigger = ref.current?.getBoundingClientRect()
    if (!trigger) return
    const viewportGap = 12
    const desiredWidth = Math.max(trigger.width, 460)
    const width = Math.min(desiredWidth, window.innerWidth - viewportGap * 2)
    const left = Math.min(
      Math.max(viewportGap, trigger.left),
      Math.max(viewportGap, window.innerWidth - width - viewportGap),
    )
    const roomBelow = window.innerHeight - trigger.bottom
    const roomAbove = trigger.top
    if (roomBelow < 250 && roomAbove > roomBelow) {
      setDropdownStyle({ left, bottom: window.innerHeight - trigger.top + 4, width })
    } else {
      setDropdownStyle({ left, top: trigger.bottom + 4, width })
    }
  }, [])

  useEffect(() => {
    if (!open) return
    positionDropdown()
    window.addEventListener('resize', positionDropdown)
    window.addEventListener('scroll', positionDropdown, true)
    return () => {
      window.removeEventListener('resize', positionDropdown)
      window.removeEventListener('scroll', positionDropdown, true)
    }
  }, [open, positionDropdown])

  const openDropdown = () => {
    setOpen(true)
    setQuery('')
    setHighlighted(0)
    requestAnimationFrame(positionDropdown)
  }

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

      {open && createPortal(
        <div ref={dropdownRef} className="fixed z-[200] rounded-lg shadow-2xl border overflow-hidden"
          style={{ ...dropdownStyle, background: 'var(--bg-card)', borderColor: 'var(--border-2)' }}>
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
          <div ref={listRef} className="max-h-64 overflow-y-auto">
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
                  <p className="font-medium leading-snug whitespace-normal break-words">{String(p.name)}</p>
                  <p className="text-xs leading-snug mt-0.5 whitespace-normal break-words" style={{ color: 'var(--text-3)' }}>
                    {[
                      p.sku ? `SKU: ${String(p.sku)}` : '',
                      p.barcode ? `Barcode: ${String(p.barcode)}` : '',
                      Number(p.cost_price || 0) > 0 ? `Cost: Rs.${Number(p.cost_price).toLocaleString()}` : '',
                    ].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {Object.prototype.hasOwnProperty.call(p, 'stock') && (
                  <span className={`text-xs font-semibold flex-shrink-0 ${Number(p.stock || 0) > 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                    {Number(p.stock || 0)} in stock
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
