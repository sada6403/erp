import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import toast from 'react-hot-toast'

interface Row {
  id: string; amount: number; late_fee_applied: number; cycle_no: number | null; receipt_number: string | null; paid_at: string
  agent_id: string; agent_code: string | null; agent_name: string | null; scheme_name: string | null; customer_name: string | null
}
type Choice = 'approve' | 'reject' | 'hold'

const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const round2 = (n: number) => Math.round(n * 100) / 100

/** Cash the app agents collected: the branch receives the cash, approves the receipts in bulk and rejects the rest with a reason. */
export default function AgentCashPage() {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [choice, setChoice] = useState<Record<string, Choice>>({})
  const [reason, setReason] = useState<Record<string, string>>({})
  const [received, setReceived] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.chits.appCollections.pending()
      if (res.success) setRows(res.data); else toast.error(res.error || 'Failed to load')
    } catch (err) { toast.error('Failed to load: ' + String(err)) } finally { setLoading(false) }
  }, [])
  useEffect(() => { void load() }, [load])

  const groups = useMemo(() => {
    const m = new Map<string, { agent_id: string; label: string; rows: Row[] }>()
    for (const r of rows) {
      const g = m.get(r.agent_id) ?? { agent_id: r.agent_id, label: `${r.agent_name ?? 'Agent'}${r.agent_code ? ` (${r.agent_code})` : ''}`, rows: [] }
      g.rows.push(r); m.set(r.agent_id, g)
    }
    return [...m.values()]
  }, [rows])

  const approvedTotal = (g: { rows: Row[] }) => round2(g.rows.filter(r => choice[r.id] === 'approve').reduce((a, r) => a + r.amount, 0))

  const settle = async (g: { agent_id: string; rows: Row[] }) => {
    const approve_ids = g.rows.filter(r => choice[r.id] === 'approve').map(r => r.id)
    const reject = g.rows.filter(r => choice[r.id] === 'reject').map(r => ({ id: r.id, reason: (reason[r.id] || '').trim() }))
    if (reject.some(r => !r.reason)) return toast.error('Enter a reason for every rejected receipt')
    const total = approvedTotal(g)
    const got = Number(received[g.agent_id])
    if (approve_ids.length && (!Number.isFinite(got) || Math.abs(got - total) > 0.005)) return toast.error(`Cash received must equal the approved total (Rs ${money(total)})`)
    setBusy(g.agent_id)
    try {
      const res = await window.api.chits.appCollections.settle({ agent_id: g.agent_id, approve_ids, reject, ...(approve_ids.length ? { received_amount: got } : {}) })
      if (!res.success) return toast.error(res.error || 'Could not save')
      const f = res.data.failed?.length ?? 0
      toast.success(`Approved ${res.data.approved.length}, rejected ${res.data.rejected.length}${res.data.remitted ? `, cash received Rs ${money(res.data.remitted)}` : ''}${f ? `, ${f} failed` : ''}`)
      setChoice({}); setReason({}); setReceived(prev => ({ ...prev, [g.agent_id]: '' }))
      void load()
    } finally { setBusy(null) }
  }

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Agent Cash" subtitle="Smart Buy payments collected by agents in the mobile app, waiting for the branch to receive the cash"
      actions={<button className="btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>} />
    <div className="flex-1 overflow-auto p-6 flex flex-col gap-6">
      <p className="text-xs text-slate-500">Count the cash the agent hands over, tick the receipts you accept and enter the cash received: it must equal the accepted total. Accepted receipts become Paid (the member is told and the statement updates, the late fee is checked again by the POS). Rejected receipts go back to the agent with your reason.</p>
      {loading && <p className="text-xs text-slate-500">Loading…</p>}
      {!loading && !groups.length && <div className="card p-10 text-center text-slate-500">Nothing is waiting. Receipts appear here as agents collect cash.</div>}
      {groups.map(g => {
        const total = approvedTotal(g)
        return <div className="card" key={g.agent_id}>
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
            <div><p className="font-semibold">{g.label}</p><p className="text-xs text-slate-500">{g.rows.length} receipt(s), Rs {money(round2(g.rows.reduce((a, r) => a + r.amount, 0)))} collected</p></div>
            <div className="flex gap-2">
              <button className="btn-secondary btn-sm" onClick={() => setChoice(c => ({ ...c, ...Object.fromEntries(g.rows.map(r => [r.id, 'approve' as Choice])) }))}>Accept all</button>
              <button className="btn-secondary btn-sm" onClick={() => setChoice(c => ({ ...c, ...Object.fromEntries(g.rows.map(r => [r.id, 'hold' as Choice])) }))}>Clear</button>
            </div>
          </div>
          <table className="w-full"><thead><tr>{['Receipt', 'Member', 'Scheme', 'Cycle', 'Amount', 'Collected', 'Decision'].map(h => <th className="table-header px-4 py-2 text-left" key={h}>{h}</th>)}</tr></thead><tbody>
            {g.rows.map(r => <tr className="table-row" key={r.id}>
              <td className="table-cell font-mono text-xs">{r.receipt_number}</td>
              <td className="table-cell">{r.customer_name ?? '—'}</td>
              <td className="table-cell">{r.scheme_name ?? '—'}</td>
              <td className="table-cell">{r.cycle_no ?? '—'}</td>
              <td className="table-cell">{money(r.amount)}{r.late_fee_applied > 0 && <span className="badge-yellow ml-2">late fee {money(r.late_fee_applied)}</span>}</td>
              <td className="table-cell text-xs">{new Date(r.paid_at).toLocaleString()}</td>
              <td className="table-cell"><div className="flex items-center gap-2">
                <select className="input w-32" value={choice[r.id] ?? 'hold'} onChange={e => setChoice(c => ({ ...c, [r.id]: e.target.value as Choice }))}>
                  <option value="hold">Not yet</option><option value="approve">Accept</option><option value="reject">Reject</option>
                </select>
                {choice[r.id] === 'reject' && <input className="input w-56" placeholder="Reason (the agent sees it)" value={reason[r.id] ?? ''} onChange={e => setReason(x => ({ ...x, [r.id]: e.target.value }))} />}
              </div></td>
            </tr>)}
          </tbody></table>
          <div className="flex items-center gap-3 px-4 py-3 border-t border-slate-800">
            <span className="text-sm">Accepted total: <b>Rs {money(total)}</b></span>
            <label className="text-xs text-slate-400 ml-4">Cash received</label>
            <input className="input w-40" inputMode="decimal" value={received[g.agent_id] ?? ''} onChange={e => setReceived(x => ({ ...x, [g.agent_id]: e.target.value }))} />
            <button className="btn-primary ml-auto" disabled={busy === g.agent_id || !g.rows.some(r => (choice[r.id] ?? 'hold') !== 'hold')} onClick={() => settle(g)}>Save decisions</button>
          </div>
        </div>
      })}
    </div>
  </div>
}
