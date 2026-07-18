import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Truck } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string,string> = { pending: 'badge-yellow', dispatched: 'badge-blue', delivered: 'badge-green', failed: 'badge-red' }
const NEXT_STATUS: Record<string,string> = { pending: 'dispatched', dispatched: 'delivered' }

export default function DeliveriesPage() {
  const [deliveries, setDeliveries] = useState<Record<string,unknown>[]>([])
  const [filter, setFilter]         = useState('')

  const load = async () => {
    try {
      const res = await window.api.admin.deliveries.list(filter ? { status: filter } : {})
      if (res.success) setDeliveries(res.data as Record<string,unknown>[])
      else toast.error(res.error || 'Failed to load deliveries')
    } catch {
      toast.error('Failed to load deliveries')
    }
  }

  useEffect(() => { load() }, [filter])

  const advance = async (id: string, current: string) => {
    const next = NEXT_STATUS[current]
    if (!next) return
    try {
      const res = await window.api.admin.deliveries.update(id, { status: next })
      if (res.success) {
        toast.success(`Marked as ${next}`)
        load()
      } else {
        toast.error(res.error || 'Failed to update delivery status')
      }
    } catch {
      toast.error('Failed to update delivery status')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Delivery Tracking" subtitle={`${deliveries.length} deliveries`} />
      <div className="flex gap-2 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        {['', 'pending', 'dispatched', 'delivered', 'failed'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${filter === s ? 'bg-brand-600 text-white' : 'btn-secondary'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
            <tr>{['Invoice', 'Customer', 'Address', 'Assigned To', 'Status', 'Scheduled', ''].map(h => <th key={h} className="table-header px-4 py-3 text-left">{h}</th>)}</tr>
          </thead>
          <tbody>
            {deliveries.map(d => (
              <tr key={d.id as string} className="table-row">
                <td className="table-cell font-mono text-xs text-brand-400">{d.invoice_number as string}</td>
                <td className="table-cell font-medium">{d.customer_name as string}</td>
                <td className="table-cell text-slate-400 text-xs max-w-xs truncate">{d.address as string}</td>
                <td className="table-cell text-slate-400">{d.assigned_name as string || 'Unassigned'}</td>
                <td className="table-cell"><span className={STATUS_COLORS[d.status as string]}>{d.status as string}</span></td>
                <td className="table-cell text-xs text-slate-500">{d.scheduled_at ? new Date(d.scheduled_at as string).toLocaleDateString() : '—'}</td>
                <td className="table-cell">
                  {NEXT_STATUS[d.status as string] && (
                    <button onClick={() => advance(d.id as string, d.status as string)}
                      className="btn-secondary btn-sm gap-1"><Truck size={12} /> Mark {NEXT_STATUS[d.status as string]}</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
