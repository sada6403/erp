import { useState, useEffect, useRef } from 'react'
import type { Customer } from '@/types'
import { X, Search, User, Plus } from 'lucide-react'
import { useKeyboard } from '@/hooks/useKeyboard'

interface Props {
  onSelect: (customer: Customer) => void
  onClose: () => void
}

export default function CustomerSearchModal({ onSelect, onClose }: Props) {
  const [query, setQuery]         = useState('')
  const [results, setResults]     = useState<Customer[]>([])
  const [loading, setLoading]     = useState(false)
  const [focused, setFocused]     = useState(0)
  const [showCreate, setShowCreate] = useState(false)
  const searchRef = useRef<HTMLInputElement>(null)

  useEffect(() => { searchRef.current?.focus() }, [])

  useEffect(() => {
    if (!query) { setResults([]); return }
    const t = setTimeout(async () => {
      setLoading(true)
      const res = await window.api.customers.search(query)
      if (res.success) setResults(res.data as Customer[])
      setLoading(false)
      setFocused(0)
    }, 200)
    return () => clearTimeout(t)
  }, [query])

  useKeyboard([
    { key: 'Escape', handler: onClose },
    { key: 'ArrowDown', handler: () => setFocused(f => Math.min(f+1, results.length-1)) },
    { key: 'ArrowUp',   handler: () => setFocused(f => Math.max(f-1, 0)) },
    { key: 'Enter',     handler: () => results[focused] && onSelect(results[focused]) },
  ])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-20 px-4">
      <div className="bg-surface-800 rounded-2xl w-full max-w-lg border animate-slide-up" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center gap-3 px-4 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <Search size={16} style={{ color: 'var(--text-3)' }} />
          <input ref={searchRef} value={query} onChange={e => setQuery(e.target.value)}
            placeholder="Search by name, phone, NIC..." className="flex-1 bg-transparent outline-none text-sm" style={{ color: 'var(--text-1)' }} />
          <button onClick={() => setShowCreate(true)} className="btn-secondary btn-sm gap-1.5">
            <Plus size={13} /> New
          </button>
          <button onClick={onClose}><X size={18} className="text-[var(--text-3)] hover:text-[var(--text-1)]" /></button>
        </div>

        <div className="max-h-80 overflow-y-auto p-2">
          {loading && <div className="text-center py-6 text-sm" style={{ color: 'var(--text-3)' }}>Searching...</div>}
          {!loading && results.length === 0 && query && (
            <div className="text-center py-6 text-sm" style={{ color: 'var(--text-3)' }}>No customers found</div>
          )}
          {results.map((c, i) => (
            <div key={c.id} onClick={() => onSelect(c)}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl cursor-pointer transition-colors
                ${i === focused ? 'bg-brand-600/20 border border-brand-500/30' : 'hover:bg-surface-700 border border-transparent'}`}>
              <div className="w-8 h-8 bg-brand-600/30 rounded-full flex items-center justify-center flex-shrink-0">
                <User size={14} className="text-brand-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{c.name}</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>{c.phone} {c.nic && `· ${c.nic}`}</p>
              </div>
              {c.outstanding_due > 0 && (
                <span className="badge-red text-xs">Due: Rs.{c.outstanding_due.toLocaleString()}</span>
              )}
            </div>
          ))}
        </div>

        {showCreate && <QuickCreateCustomer onCreate={onSelect} onCancel={() => setShowCreate(false)} />}
      </div>
    </div>
  )
}

function QuickCreateCustomer({ onCreate, onCancel }: { onCreate: (c: Customer) => void; onCancel: () => void }) {
  const [name, setName]   = useState('')
  const [phone, setPhone] = useState('')
  const [nic, setNic]     = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!name) return
    setSaving(true)
    const res = await window.api.customers.create({ name, phone, nic })
    setSaving(false)
    if (res.success) {
      const getRes = await window.api.customers.get((res.data as { id: string }).id)
      if (getRes.success) onCreate(getRes.data as Customer)
    }
  }

  return (
    <div className="border-t px-4 py-4 space-y-3" style={{ borderColor: 'var(--border)' }}>
      <p className="text-sm font-medium" style={{ color: 'var(--text-2)' }}>Quick Create Customer</p>
      <input value={name} onChange={e=>setName(e.target.value)} placeholder="Full Name *" className="input" />
      <div className="grid grid-cols-2 gap-2">
        <input value={phone} onChange={e=>setPhone(e.target.value)} placeholder="Phone" className="input" />
        <input value={nic} onChange={e=>setNic(e.target.value)} placeholder="NIC" className="input" />
      </div>
      <div className="flex gap-2">
        <button onClick={onCancel} className="btn-secondary flex-1 btn-sm">Cancel</button>
        <button onClick={save} disabled={!name || saving} className="btn-primary flex-1 btn-sm">
          {saving ? 'Saving...' : 'Create & Select'}
        </button>
      </div>
    </div>
  )
}
