import { useState, useEffect } from 'react'
import { X, FileText, Clock } from 'lucide-react'

interface Props { onClose: () => void }

export default function HeldInvoicesModal({ onClose }: Props) {
  const [invoices, setInvoices] = useState<Record<string, unknown>[]>([])

  useEffect(() => {
    window.api.invoices.listHeld().then((res: any) => {
      if (res.success) setInvoices(res.data as Record<string, unknown>[])
    })
  }, [])

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
          {invoices.length === 0 ? (
            <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No held invoices</div>
          ) : invoices.map((inv) => (
            <div key={inv.id as string}
              className="flex items-center gap-4 px-4 py-3 bg-surface-900 rounded-xl border hover:border-brand-500/50 cursor-pointer transition-colors"
              style={{ borderColor: 'var(--border)' }}>
              <FileText size={16} className="text-brand-400 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-mono font-medium" style={{ color: 'var(--text-1)' }}>{inv.invoice_number as string}</p>
                <p className="text-xs text-slate-500">{inv.customer_name as string || 'Walk-in'} · {new Date(inv.updated_at as string).toLocaleTimeString()}</p>
              </div>
              <p className="text-sm font-bold text-brand-400">Rs.{Number(inv.total_amount).toLocaleString()}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
