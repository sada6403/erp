import { useCallback, useEffect, useState } from 'react'
import { RefreshCw, Star } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

interface Review {
  id: string; product_name: string | null; product_sku: string | null; customer_name: string | null; rating: number
  comment: string | null; is_hidden: number; hidden_by: string | null; hidden_at: string | null; hidden_reason: string | null; created_at: string
}
type State = 'all' | 'visible' | 'hidden'

const Stars = ({ n }: { n: number }) => <span className="inline-flex text-amber-400" aria-label={`${n} of 5`}>
  {[1, 2, 3, 4, 5].map(i => <Star key={i} size={13} fill={i <= n ? 'currentColor' : 'none'} />)}</span>

export default function ReviewsPage() {
  const [state, setState] = useState<State>('all')
  const [search, setSearch] = useState('')
  const [rows, setRows] = useState<Review[]>([])
  const [loading, setLoading] = useState(false)
  const [hiding, setHiding] = useState<Review | null>(null)
  const [reason, setReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await window.api.productReviews.list({ state, search })
      if (r.success) setRows(r.data); else toast.error(r.error || 'Failed to load reviews')
    } catch (err) { toast.error('Failed to load reviews: ' + String(err)) } finally { setLoading(false) }
  }, [state, search])
  useEffect(() => { void load() }, [load])

  const apply = async (r: Review, hidden: boolean, why?: string) => {
    try {
      const res = await window.api.productReviews.setHidden(r.id, hidden, why)
      if (res.success) { toast.success(hidden ? 'Review hidden. The app updates after the next sync.' : 'Review is visible again.'); setHiding(null); setReason(''); void load() }
      else toast.error(res.error)
    } catch (err) { toast.error('Failed: ' + String(err)) }
  }

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Reviews" subtitle="Customer reviews of delivered products in the mobile app"
      actions={<button className="btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>} />
    <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-800">
      {(['all', 'visible', 'hidden'] as const).map(k =>
        <button key={k} onClick={() => setState(k)} className={`px-3 py-1.5 rounded-lg text-xs capitalize ${state === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{k}</button>)}
      <input className="input w-64 ml-auto" placeholder="Search product, customer, comment" value={search} onChange={e => setSearch(e.target.value)} />
      <span className="text-xs text-slate-500">{loading ? 'Loading…' : `${rows.length} review${rows.length === 1 ? '' : 's'}`}</span>
    </div>
    <div className="flex-1 overflow-auto">
      <table className="w-full"><thead className="sticky top-0 bg-surface-900"><tr>
        {['Product', 'Customer', 'Rating', 'Comment', 'Date', 'State', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}
      </tr></thead><tbody>
        {rows.map(r => <tr className="table-row" key={r.id}>
          <td className="table-cell"><p className="font-medium">{r.product_name || '(deleted product)'}</p><p className="text-xs text-slate-500 font-mono">{r.product_sku || ''}</p></td>
          <td className="table-cell">{r.customer_name || '—'}</td>
          <td className="table-cell"><Stars n={r.rating} /></td>
          <td className="table-cell max-w-xs whitespace-pre-wrap break-words">{r.comment || <span className="text-slate-500">(no comment)</span>}</td>
          <td className="table-cell">{new Date(r.created_at.includes('T') ? r.created_at : r.created_at.replace(' ', 'T') + 'Z').toLocaleDateString()}</td>
          <td className="table-cell">{r.is_hidden ? <span className="badge-red" title={r.hidden_reason || ''}>hidden</span> : <span className="badge-green">visible</span>}
            {r.is_hidden && r.hidden_reason ? <p className="text-xs text-slate-500 mt-1">{r.hidden_reason}</p> : null}</td>
          <td className="table-cell text-right">{r.is_hidden
            ? <button className="btn-secondary btn-sm" onClick={() => apply(r, false)}>Unhide</button>
            : <button className="btn-secondary btn-sm" onClick={() => { setHiding(r); setReason('') }}>Hide</button>}</td>
        </tr>)}
        {!rows.length && !loading && <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-500">No reviews yet.</td></tr>}
      </tbody></table>
    </div>
    {hiding && <Modal onClose={() => setHiding(null)} title="Hide review">
      <div className="space-y-3">
        <p className="text-sm text-slate-400">Hidden reviews disappear from the app and from the product rating.</p>
        <label className="text-xs text-slate-400">Reason (optional)</label>
        <input className="input" maxLength={255} value={reason} onChange={e => setReason(e.target.value)} />
        <div className="flex justify-end gap-2"><button className="btn-secondary" onClick={() => setHiding(null)}>Cancel</button>
          <button className="btn-primary" onClick={() => apply(hiding, true, reason)}>Hide review</button></div>
      </div>
    </Modal>}
  </div>
}
