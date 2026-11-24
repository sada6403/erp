import { useCallback, useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

type Tab = 'joins' | 'slips'
interface Join {
  id: string; source: 'agent' | 'self'; agent_code: string | null; agent_name: string | null; branch_name?: string | null; scheme_name: string
  full_name: string; phone: string; nic_number: string; address: string | null; notes: string | null
  has_nic_front: boolean; has_nic_back: boolean; status: 'pending' | 'approved' | 'rejected'
  reject_reason: string | null; decided_by: string | null; decided_at: string | null; created_at: string
}
interface Slip {
  id: string; order_id: string; order_number: string; customer_name: string | null; order_total: number; reference: string | null; order_reference?: string | null
  status: 'pending' | 'verified' | 'rejected'; reject_reason: string | null; reviewed_by: string | null; reviewed_at: string | null; created_at: string
}

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—')
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const STATUS_BADGE: Record<string, string> = { pending: 'badge-yellow', approved: 'badge-green', verified: 'badge-green', rejected: 'badge-red' }

export default function AppRequestsPage() {
  const [tab, setTab] = useState<Tab>('joins')
  const [status, setStatus] = useState<'pending' | 'all'>('pending')
  const [joins, setJoins] = useState<Join[]>([])
  const [slips, setSlips] = useState<Slip[]>([])
  const [loading, setLoading] = useState(false)
  const [openJoin, setOpenJoin] = useState<Join | null>(null)
  const [openSlip, setOpenSlip] = useState<Slip | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters = status === 'pending' ? { status: 'pending' } : {}
      const [j, s] = await Promise.all([window.api.appRequests.joinList(filters), window.api.appRequests.slipList(filters)])
      if (j.success) setJoins(j.data); else toast.error(j.error || 'Failed to load join requests')
      if (s.success) setSlips(s.data); else toast.error(s.error || 'Failed to load bank slips')
    } catch (err) {
      toast.error('Failed to load: ' + String(err))
    } finally { setLoading(false) }
  }, [status])

  useEffect(() => { void load() }, [load])

  const pendingJoins = joins.filter(j => j.status === 'pending').length
  const pendingSlips = slips.filter(s => s.status === 'pending').length

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="App Requests" subtitle="Smart Buy join requests and bank transfer slips from the mobile app"
      actions={<button className="btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>} />
    <div className="flex items-center gap-2 px-6 py-3 border-b border-slate-800">
      {([['joins', `Join Requests${pendingJoins ? ` (${pendingJoins})` : ''}`], ['slips', `Bank Slips${pendingSlips ? ` (${pendingSlips})` : ''}`]] as const).map(([k, label]) =>
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs ${tab === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{label}</button>)}
      <select className="input w-40 ml-auto" value={status} onChange={e => setStatus(e.target.value as 'pending' | 'all')}>
        <option value="pending">Waiting only</option><option value="all">All (recent 300)</option>
      </select>
      <span className="text-xs text-slate-500">{loading ? 'Loading…' : ''}</span>
    </div>

    <div className="flex-1 overflow-auto">
      {tab === 'joins' ? <table className="w-full"><thead className="sticky top-0 bg-surface-900"><tr>
        {['Person', 'Scheme', 'Submitted by', 'Phone', 'Status', 'Date', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}
      </tr></thead><tbody>
        {joins.map(r => <tr className="table-row" key={r.id}>
          <td className="table-cell"><p className="font-medium">{r.full_name}</p><p className="text-xs text-slate-500 font-mono">{r.nic_number || '—'}</p></td>
          <td className="table-cell">{r.scheme_name}</td>
          <td className="table-cell">{`${r.agent_name || 'Agent'}${r.agent_code ? ` (${r.agent_code})` : ''}${r.source === 'self' ? ' · self join' : ''}`}{r.branch_name ? <p className="text-xs text-slate-500">{r.branch_name}</p> : null}</td>
          <td className="table-cell">{r.phone}</td>
          <td className="table-cell"><span className={STATUS_BADGE[r.status]}>{r.status}</span></td>
          <td className="table-cell">{fmt(r.created_at)}</td>
          <td className="table-cell"><button className="btn-primary btn-sm" onClick={() => setOpenJoin(r)}>{r.status === 'pending' ? 'Review' : 'View'}</button></td>
        </tr>)}
        {!joins.length && <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-10">No join requests.</td></tr>}
      </tbody></table>
      : <table className="w-full"><thead className="sticky top-0 bg-surface-900"><tr>
        {['Order', 'Customer', 'Total', 'Reference', 'Status', 'Date', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}
      </tr></thead><tbody>
        {slips.map(r => <tr className="table-row" key={r.id}>
          <td className="table-cell font-mono">{r.order_number}</td>
          <td className="table-cell">{r.customer_name || '—'}</td>
          <td className="table-cell">{money(r.order_total)}</td>
          <td className="table-cell">{r.reference || r.order_reference || '—'}</td>
          <td className="table-cell"><span className={STATUS_BADGE[r.status]}>{r.status}</span></td>
          <td className="table-cell">{fmt(r.created_at)}</td>
          <td className="table-cell"><button className="btn-primary btn-sm" onClick={() => setOpenSlip(r)}>{r.status === 'pending' ? 'Verify' : 'View'}</button></td>
        </tr>)}
        {!slips.length && <tr><td colSpan={7} className="table-cell text-center text-slate-500 py-10">No bank slips.</td></tr>}
      </tbody></table>}
    </div>

    {openJoin && <JoinModal row={openJoin} onClose={() => setOpenJoin(null)} onDone={() => { setOpenJoin(null); void load() }} />}
    {openSlip && <SlipModal row={openSlip} onClose={() => setOpenSlip(null)} onDone={() => { setOpenSlip(null); void load() }} />}
  </div>
}

function useImage(load: () => Promise<{ success: boolean; data?: string; error?: string }>) {
  const [src, setSrc] = useState<string | null>(null)
  const [err, setErr] = useState(false)
  useEffect(() => {
    let live = true
    load().then(r => { if (!live) return; if (r.success && r.data) setSrc(r.data); else setErr(true) }).catch(() => live && setErr(true))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return { src, err }
}

function Photo({ label, state }: { label: string; state: { src: string | null; err: boolean } }) {
  return <div>
    <p className="text-xs text-slate-400 mb-1">{label}</p>
    {state.src ? <img src={state.src} alt={label} className="w-full rounded-lg border border-slate-700" />
      : <div className="h-40 rounded-lg border border-slate-700 flex items-center justify-center text-xs text-slate-500">{state.err ? 'Photo not available' : 'Loading…'}</div>}
  </div>
}

function Decision({ pending, busy, approveLabel, onApprove, onReject }: { pending: boolean; busy: boolean; approveLabel: string; onApprove: () => void; onReject: (reason: string) => void }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  if (!pending) return null
  return <div className="flex flex-col gap-2 w-full">
    {rejecting && <input className="input" placeholder="Reason shown to the customer / agent" maxLength={300} value={reason} onChange={e => setReason(e.target.value)} autoFocus />}
    <div className="flex justify-end gap-2">
      {!rejecting && <button className="btn-secondary" disabled={busy} onClick={() => setRejecting(true)}>Reject</button>}
      {rejecting && <button className="btn-danger" disabled={busy || reason.trim().length < 3} onClick={() => onReject(reason.trim())}>Confirm reject</button>}
      <button className="btn-primary" disabled={busy} onClick={onApprove}>{approveLabel}</button>
    </div>
  </div>
}

function JoinModal({ row, onClose, onDone }: { row: Join; onClose: () => void; onDone: () => void }) {
  const front = useImage(() => window.api.appRequests.joinPhoto(row.id, 'front'))
  const back = useImage(() => window.api.appRequests.joinPhoto(row.id, 'back'))
  const [busy, setBusy] = useState(false)
  const decide = async (decision: 'approve' | 'reject', reason?: string) => {
    setBusy(true)
    try {
      const res = await window.api.appRequests.joinDecide(row.id, decision, reason)
      if (res.success) { toast.success(decision === 'approve' ? 'Approved: member added to the scheme' : 'Request rejected'); onDone() }
      else toast.error(res.error || 'Could not save the decision')
    } catch (err) { toast.error(String(err)) } finally { setBusy(false) }
  }
  return <Modal title={`Join request: ${row.full_name}`} size="lg" onClose={onClose}
    footer={<Decision pending={row.status === 'pending'} busy={busy} approveLabel="Approve and add member" onApprove={() => decide('approve')} onReject={r => decide('reject', r)} />}>
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
      <div><span className="text-slate-500">Scheme</span><p>{row.scheme_name}</p></div>
      <div><span className="text-slate-500">{row.source === 'agent' ? 'Submitted by agent' : 'Customer self join, agent credited'}</span><p>{`${row.agent_name || 'Agent'} (${row.agent_code || '—'})`}</p></div>
      <div><span className="text-slate-500">Enrolled branch</span><p>{row.branch_name || '—'}</p></div>
      <div><span className="text-slate-500">Phone</span><p>{row.phone}</p></div>
      <div><span className="text-slate-500">NIC</span><p className="font-mono">{row.nic_number || 'Removed after 30 days'}</p></div>
      <div className="col-span-2"><span className="text-slate-500">Address</span><p>{row.address || '—'}</p></div>
      {row.notes && <div className="col-span-2"><span className="text-slate-500">Notes</span><p>{row.notes}</p></div>}
      {row.status !== 'pending' && <div className="col-span-2"><span className="text-slate-500">Decision</span>
        <p><span className={STATUS_BADGE[row.status]}>{row.status}</span> by {row.decided_by || '—'} on {fmt(row.decided_at)}{row.reject_reason ? `: ${row.reject_reason}` : ''}</p></div>}
    </div>
    {row.status === 'pending' ? <p className="text-xs text-slate-500 mb-2">Check the NIC photos match the number above before approving. NIC number and photos are deleted 30 days after the decision.</p> : null}
    <div className="grid grid-cols-2 gap-4">
      {row.has_nic_front && <Photo label="NIC front" state={front} />}
      {row.has_nic_back && <Photo label="NIC back" state={back} />}
    </div>
  </Modal>
}

function SlipModal({ row, onClose, onDone }: { row: Slip; onClose: () => void; onDone: () => void }) {
  const img = useImage(() => window.api.appRequests.slipImage(row.id))
  const [busy, setBusy] = useState(false)
  const decide = async (decision: 'verify' | 'reject', reason?: string) => {
    setBusy(true)
    try {
      const res = await window.api.appRequests.slipDecide(row.id, decision, reason)
      if (res.success) { toast.success(decision === 'verify' ? 'Payment verified: order marked paid' : 'Slip rejected'); onDone() }
      else toast.error(res.error || 'Could not save the decision')
    } catch (err) { toast.error(String(err)) } finally { setBusy(false) }
  }
  return <Modal title={`Bank slip: order ${row.order_number}`} size="md" onClose={onClose}
    footer={<Decision pending={row.status === 'pending'} busy={busy} approveLabel="Verify payment" onApprove={() => decide('verify')} onReject={r => decide('reject', r)} />}>
    <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm mb-4">
      <div><span className="text-slate-500">Customer</span><p>{row.customer_name || '—'}</p></div>
      <div><span className="text-slate-500">Order total</span><p>{money(row.order_total)}</p></div>
      <div className="col-span-2"><span className="text-slate-500">Customer's reference</span><p>{row.reference || row.order_reference || '—'}</p></div>
      {row.status !== 'pending' && <div className="col-span-2"><span className="text-slate-500">Decision</span>
        <p><span className={STATUS_BADGE[row.status]}>{row.status}</span> by {row.reviewed_by || '—'} on {fmt(row.reviewed_at)}{row.reject_reason ? `: ${row.reject_reason}` : ''}</p></div>}
    </div>
    <p className="text-xs text-slate-500 mb-2">Compare the slip amount with the order total and your bank statement before verifying.</p>
    <Photo label="Slip" state={img} />
  </Modal>
}
