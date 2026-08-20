import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Search, Plus } from 'lucide-react'
import toast from 'react-hot-toast'

// Generic typeable combobox with inline "create new" support — same
// search/select interaction as ProductSearchSelect.tsx, plus a "+ Create
// '<query>'" option when nothing matches what was typed. Used wherever a
// picker was previously a plain <select> that only let you choose from an
// existing list (Issue 16: suppliers, and reused for Issue 19: positions).
export interface CreatableOption {
  id: string
  label: string
  sublabel?: string
}

export default function CreatableSearchSelect({
  items, value, onChange, onCreate, placeholder, createLabel,
}: {
  items: CreatableOption[]
  value: string
  onChange: (id: string) => void
  onCreate: (name: string) => Promise<CreatableOption | null>
  placeholder?: string
  createLabel?: string
}) {
  const [query, setQuery]       = useState('')
  const [open, setOpen]         = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const [creating, setCreating] = useState(false)
  const ref     = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const selected = items.find(i => i.id === value)
  const filtered = items.filter(i => i.label.toLowerCase().includes(query.toLowerCase()))
  const trimmedQuery = query.trim()
  const exactMatch = trimmedQuery && items.some(i => i.label.toLowerCase() === trimmedQuery.toLowerCase())
  const showCreateOption = trimmedQuery.length > 0 && !exactMatch
  // Highlighted index spans filtered items, plus the create row if shown.
  const rowCount = filtered.length + (showCreateOption ? 1 : 0)

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => { setHighlighted(0) }, [query])

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

  const createNew = async () => {
    if (!trimmedQuery || creating) return
    setCreating(true)
    try {
      const created = await onCreate(trimmedQuery)
      if (created) select(created.id)
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to create')
    } finally {
      setCreating(false)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open) { if (e.key === 'Enter' || e.key === 'ArrowDown') { e.preventDefault(); openDropdown() } return }
    if (e.key === 'ArrowDown')  { e.preventDefault(); setHighlighted(h => Math.min(h + 1, rowCount - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setHighlighted(h => Math.max(h - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      if (highlighted < filtered.length) { if (filtered[highlighted]) select(filtered[highlighted].id) }
      else if (showCreateOption) createNew()
    }
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
        <span className="min-w-0 flex-1 truncate" style={{ color: selected ? 'var(--text-1)' : 'var(--text-3)' }}>
          {selected ? selected.label : (placeholder || 'Select or type to add...')}
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
              placeholder="Type to search or add new..."
              className="bg-transparent text-sm outline-none w-full"
              style={{ color: 'var(--text-1)' }}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
            />
          </div>
          <div ref={listRef} className="max-h-52 overflow-y-auto">
            {filtered.length === 0 && !showCreateOption ? (
              <p className="text-xs text-center py-3" style={{ color: 'var(--text-3)' }}>No matches</p>
            ) : (
              <>
                {filtered.map((item, i) => (
                  <div
                    key={item.id}
                    onClick={() => select(item.id)}
                    onMouseEnter={() => setHighlighted(i)}
                    className="px-3 py-2 text-sm cursor-pointer transition-colors"
                    style={{
                      background: i === highlighted ? 'var(--bg-soft)' : 'transparent',
                      color: item.id === value ? 'var(--brand-500, #6366f1)' : 'var(--text-1)',
                    }}
                  >
                    <p className="truncate font-medium leading-tight">{item.label}</p>
                    {item.sublabel && <p className="text-xs truncate leading-tight" style={{ color: 'var(--text-3)' }}>{item.sublabel}</p>}
                  </div>
                ))}
                {showCreateOption && (
                  <div
                    onClick={createNew}
                    onMouseEnter={() => setHighlighted(filtered.length)}
                    className="px-3 py-2 text-sm cursor-pointer flex items-center gap-1.5 transition-colors"
                    style={{
                      background: highlighted === filtered.length ? 'var(--bg-soft)' : 'transparent',
                      color: 'var(--brand-500, #6366f1)',
                      borderTop: filtered.length > 0 ? '1px solid var(--border)' : 'none',
                    }}
                  >
                    <Plus size={13} />
                    {creating ? 'Creating…' : `${createLabel || 'Create'} "${trimmedQuery}"`}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
