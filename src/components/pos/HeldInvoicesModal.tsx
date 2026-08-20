import { useState, useEffect } from 'react'
import { X, FileText, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useCartStore } from '@/store/cartStore'

interface Props { onClose: () => void }

export default function HeldInvoicesModal({ onClose }: Props) {
  const cart = useCartStore()
  const [holds, setHolds] = useState<Record<string, unknown>[]>([])
  const [recalling, setRecalling] = useState<string | null>(null)

  useEffect(() => {
    window.api.holds.list().then((res: { success: boolean; data?: Record<string, unknown>[] }) => {
      if (res.success) setHolds(res.data || [])
    })
  }, [])

  const recall = async (id: string) => {
    if (cart.items.length > 0) {
      if (!window.confirm('Your current cart has items that will be replaced by this held bill. Continue?')) return
    }
    setRecalling(id)
    try {
      const res = await window.api.holds.recall(id)
      if (!res.success) { toast.error(res.error || 'Failed to recall held bill'); return }
      cart.restoreCart(res.data)
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
      <div className="bg-surface-800 rounded-2xl w-full max-w-lg border animate-slide-up" style={{ borderColor: 'var(--border)' }}>
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <div className="flex items-center gap-2">
            <Clock size={16} className="text-yellow-400" />
            <h3 className="font-semibold">Held Invoices</h3>
          </div>
          <button onClick={onClose}><X size={18} className="text-[var(--text-3)] hover:text-[var(--text-1)]" /></button>
        </div>
        <div className="max-h-96 overflow-y-auto p-3 space-y-2">
          {holds.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No held invoices</div>
          ) : holds.map((h) => (
            <button key={h.id as string}
              onClick={() => recall(h.id as string)}
              disabled={recalling !== null}
              className="w-full flex items-center gap-4 px-4 py-3 bg-surface-900 rounded-xl border hover:border-brand-500/50 cursor-pointer transition-colors disabled:opacity-50 text-left"
              style={{ borderColor: 'var(--border)' }}>
              <FileText size={16} className="text-brand-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                  {String(h.customer_name || 'Walk-in')} · {String(h.item_count)} item(s)
                </p>
                <p className="text-xs text-slate-500">{String(h.bill_type)} · {new Date(h.created_at as string).toLocaleTimeString()}</p>
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
