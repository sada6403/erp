import { useState, useEffect, useRef } from 'react'
import { X, FileText, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCartStore } from '@/store/cartStore'
import { normalizeHeldCart } from '@/lib/heldCart'
import { parseUtc } from '../../lib/datetime'

interface Props { onClose: () => void }

export default function HeldInvoicesModal({ onClose }: Props) {
  const cart = useCartStore()
  const [holds, setHolds] = useState<Record<string, unknown>[]>([])
  const [recalling, setRecalling] = useState<string | null>(null)
  const [focused, setFocused] = useState(0)
  const [holdNumber, setHoldNumber] = useState('')
  const dialogRef = useRef<HTMLDivElement>(null)
  const numberRef = useRef<HTMLInputElement>(null)

  useEffect(() => { numberRef.current?.focus() }, [])

  useEffect(() => {
    let disposed = false
    const refresh = () => window.api.holds.list().then((res: { success: boolean; data?: Record<string, unknown>[]; error?: string }) => {
      if (!disposed && res.success) setHolds(res.data || [])
      else if (!disposed && res.error) toast.error(res.error)
    }).catch((err: Error) => { if (!disposed) toast.error(err.message) })
    void refresh()
    const unsubscribe = window.api.on?.('branchHub:changed', () => { void refresh() })
    return () => { disposed = true; unsubscribe?.() }
  }, [])

  const recall = async (id: string) => {
    if (cart.items.length > 0) {
      if (!window.confirm('Your current cart has items that will be replaced by this held bill. Continue?')) return
    }
    setRecalling(id)
    try {
      const res = await window.api.holds.recall(id)
      if (!res.success) { toast.error(res.error || 'Failed to recall held bill'); return }
      cart.restoreCart(normalizeHeldCart(res.data))
      if (res.data?.recall_token) {
        const ack = await window.api.holds.acknowledgeRecall(res.data.recall_token)
        if (!ack.success) { toast.error('Cart restored; recovery acknowledgement is pending'); return }
      }
      toast.success('Held bill recalled')
      onClose()
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to recall held bill')
    } finally {
      setRecalling(null)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-start justify-center z-50 pt-20 px-4">
      <div role="dialog" aria-modal="true" aria-label="Held invoices" tabIndex={-1}
        ref={dialogRef}
        onKeyDown={e => {
          if (e.key === 'Escape') { e.preventDefault(); onClose() }
          if (e.key === 'ArrowDown') { e.preventDefault(); setHoldNumber(''); setFocused(i => Math.max(0, Math.min(i + 1, holds.length - 1))) }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHoldNumber(''); setFocused(i => Math.max(i - 1, 0)) }
          if (e.key === 'Enter' && !recalling && (holdNumber.trim() || holds[focused])) { e.preventDefault(); void recall(holdNumber.trim() || String(holds[focused].id)) }
        }}
        className="bg-surface-800 rounded-2xl w-full max-w-lg border animate-slide-up" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-yellow-400" />
            <h3 className="font-semibold">Held Invoices</h3>
          </div>
          <button onClick={onClose}><X size={18} className="text-[var(--text-3)] hover:text-[var(--text-1)]" /></button>
        </div>
        <div className="px-4 pt-3">
          <label htmlFor="hold-number" className="text-xs">Hold number</label>
          <input ref={numberRef} id="hold-number" className="input mt-1" value={holdNumber}
            onChange={e => setHoldNumber(e.target.value.toUpperCase())} placeholder="Enter the cashier's hold number, e.g. 25" />
        </div>
        <div className="max-h-96 overflow-y-auto p-3 space-y-2">
          {holds.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No held invoices</div>
          ) : holds.map((h, index) => (
            <button key={h.id as string}
              onClick={() => recall(h.id as string)}
              disabled={recalling !== null}
              className="w-full flex items-center gap-4 px-4 py-3 bg-surface-900 rounded-xl border hover:border-brand-500/50 cursor-pointer transition-colors disabled:opacity-50 text-left"
              onFocus={() => setFocused(index)}
              style={{ borderColor: focused === index ? 'var(--brand-500, #6366f1)' : 'var(--border)' }}>
              <FileText size={16} className="text-brand-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                  {h.hold_number ? <strong className="text-brand-400 mr-2">{String(h.hold_number)}</strong> : null}
                  {String(h.customer_name || 'Walk-in')} · {String(h.item_count)} item(s)
                </p>
                {h.overdue ? <p className="text-xs text-orange-400">Held on a previous business day</p> : null}
                {h.local_number ? <p className="text-xs text-slate-400">Also: {String(h.local_number)}</p> : null}
                {h.source === 'publishing' ? <p className="text-xs text-orange-400">Awaiting Hub confirmation</p> : null}
                {h.error ? <p className="text-xs text-red-400">{String(h.error)}{String(h.error).startsWith('Hold number is already in use') ? '. Resume this local cart and hold it with another number.' : ''}</p> : null}
                {h.source === 'recovery' ? <p className="text-xs text-orange-400">Recovered recall — ready to restore</p> : null}
                <p className="text-xs text-slate-500">{String(h.bill_type)} · {parseUtc(h.created_at).toLocaleTimeString()}</p>
              </div>
              <p className="text-sm font-bold text-brand-400">
                {recalling === h.id ? 'Recalling…' : `Rs.${Number(h.total_amount).toLocaleString()}`}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
