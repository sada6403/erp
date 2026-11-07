import { useCallback, useEffect, useMemo, useState } from 'react'
import { MessageCircle, RefreshCw, Search } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

type Kind = 'customer' | 'smartbuy' | 'agent'
interface AppInfo {
  user_id: string
  status: 'active' | 'locked' | 'disabled'
  must_change_password: boolean
  last_login_at: string | null
  last_dispatch_status: string | null
  last_dispatch_at: string | null
  pending_reset_request_id: string | null
  member_no: string | null
}
interface Row {
  key: string
  kind: Kind
  customer_id?: string
  agent_id?: string
  name: string
  phone: string | null
  code: string | null
  branch_id: string | null
  branch_name: string | null
  valid_phone: boolean
  app: AppInfo | null
}
interface ResetReq { id: string; user_id: string; name: string | null; phone: string | null; status: string; requested_at: string; resolved_at: string | null; resolved_by: string | null }
interface QueueItem { target: { customer_id?: string; agent_id?: string }; ok: boolean; name?: string; phone?: string; skipped_reason?: string; dispatch_id?: string }

const KIND_LABEL: Record<Kind, string> = { customer: 'Customer', smartbuy: 'Smart Buy', agent: 'Agent' }
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString() : '—')

function accessBadge(a: AppInfo | null) {
  if (!a) return <span className="badge-gray">Not invited</span>
  if (a.status === 'disabled') return <span className="badge-red">Disabled</span>
  if (a.status === 'locked') return <span className="badge-yellow">Locked</span>
  if (a.must_change_password) return <span className="badge-yellow">Invited, not logged in</span>
  return <span className="badge-green">Active</span>
}

export default function AppAccessPage() {
  const [tab, setTab] = useState<'people' | 'resets'>('people')
  const [rows, setRows] = useState<Row[]>([])
  const [total, setTotal] = useState(0)
  const [branches, setBranches] = useState<{ id: string; name: string }[]>([])
  const [role, setRole] = useState('')
  const [branchId, setBranchId] = useState('')
  const [notInvited, setNotInvited] = useState(false)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [resets, setResets] = useState<ResetReq[]>([])
  const [showAllResets, setShowAllResets] = useState(false)
  const [confirmRows, setConfirmRows] = useState<Row[] | null>(null)
  const [queue, setQueue] = useState<QueueItem[] | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.appAccess.list({ role, branch_id: branchId, notInvited, search })
      if (res.success) { setRows(res.data.rows); setTotal(res.data.total); setBranches(res.data.branches) }
      else toast.error(res.error || 'Failed to load app access')
    } catch (err) {
      toast.error('Failed to load app access: ' + String(err))
    } finally { setLoading(false) }
  }, [role, branchId, notInvited, search])

  const loadResets = useCallback(async () => {
    try {
      const res = await window.api.appAccess.resetRequests({ all: showAllResets })
      if (res.success) setResets(res.data)
      else toast.error(res.error || 'Failed to load reset requests')
    } catch (err) {
      toast.error('Failed to load reset requests: ' + String(err))
    }
  }, [showAllResets])

  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])
  useEffect(() => { loadResets() }, [loadResets])

  const rowByKey = useMemo(() => new Map(rows.map(r => [r.key, r])), [rows])
  const selectable = rows.filter(r => r.valid_phone)
  const toggle = (k: string) => setSelected(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  const allSelected = selectable.length > 0 && selectable.every(r => selected.has(r.key))

  const setStatus = async (r: Row, status: 'active' | 'disabled') => {
    if (!r.app) return
    if (status === 'disabled' && !window.confirm(`Disable app access for ${r.name}? They will be signed out.`)) return
    try {
      const res = await window.api.appAccess.setStatus(r.app.user_id, status)
      if (res.success) { toast.success(status === 'disabled' ? 'Account disabled' : 'Account enabled'); load() } else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to update account: ' + String(err))
    }
  }

  const pendingResetFor = (userId: string) => resets.find(x => x.user_id === userId && x.status === 'pending')

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="App Access" subtitle="Give customers, Smart Buy members and agents access to the mobile app"
      actions={<>
        <button className="btn-secondary btn-sm" onClick={() => { load(); loadResets() }}><RefreshCw size={14} /> Refresh</button>
        {tab === 'people' && <button className="btn-primary btn-sm" disabled={selected.size === 0}
          onClick={() => setConfirmRows(Array.from(selected).map(k => rowByKey.get(k)).filter((r): r is Row => Boolean(r)))}>
          <MessageCircle size={14} /> Invite selected ({selected.size})</button>}
      </>} />
    <div className="flex gap-2 px-6 py-3 border-b border-slate-800">
      {([['people', 'People'], ['resets', `Password reset requests${resets.filter(r => r.status === 'pending').length ? ` (${resets.filter(r => r.status === 'pending').length})` : ''}`]] as const).map(([k, label]) =>
        <button key={k} onClick={() => setTab(k)} className={`px-3 py-1.5 rounded-lg text-xs ${tab === k ? 'bg-brand-600 text-white' : 'bg-surface-800 text-slate-400'}`}>{label}</button>)}
    </div>

    {tab === 'people' && <>
      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b border-slate-800">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input className="input pl-8 w-56" placeholder="Search name, phone, code" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <select className="input w-40" value={role} onChange={e => setRole(e.target.value)}>
          <option value="">All roles</option><option value="customer">Customers</option><option value="smartbuy">Smart Buy members</option><option value="agent">Agents</option>
        </select>
        <select className="input w-48" value={branchId} onChange={e => setBranchId(e.target.value)}>
          <option value="">All branches</option>{branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
        <label className="flex items-center gap-2 text-xs text-slate-400"><input type="checkbox" checked={notInvited} onChange={e => setNotInvited(e.target.checked)} /> Not yet invited</label>
        <span className="text-xs text-slate-500 ml-auto">{loading ? 'Loading…' : `${total} people${total > rows.length ? ` (showing ${rows.length})` : ''}`}</span>
      </div>
      <div className="flex-1 overflow-auto"><table className="w-full"><thead className="sticky top-0 bg-surface-900">
        <tr>
          <th className="table-header px-4 py-3 w-8"><input type="checkbox" checked={allSelected}
            onChange={e => setSelected(e.target.checked ? new Set(selectable.map(r => r.key)) : new Set())} /></th>
          {['Name', 'Type', 'Phone', 'Branch', 'App access', 'Last invite', 'Last login', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}
        </tr></thead><tbody>
          {rows.map(r => <tr className="table-row" key={r.key}>
            <td className="table-cell"><input type="checkbox" disabled={!r.valid_phone} checked={selected.has(r.key)} onChange={() => toggle(r.key)} /></td>
            <td className="table-cell"><p className="font-medium">{r.name}</p>{r.code && <p className="text-xs text-slate-500 font-mono">{r.code}</p>}</td>
            <td className="table-cell"><span className="badge-blue">{KIND_LABEL[r.kind]}</span></td>
            <td className="table-cell text-slate-400">{r.phone || '—'}{!r.valid_phone && <p className="text-xs text-red-400">No valid mobile number</p>}</td>
            <td className="table-cell text-slate-400">{r.branch_name || '—'}</td>
            <td className="table-cell">{accessBadge(r.app)}{r.app?.pending_reset_request_id && <span className="badge-yellow ml-1">Reset requested</span>}</td>
            <td className="table-cell text-xs text-slate-400">{r.app?.last_dispatch_status ? <><span className="capitalize">{r.app.last_dispatch_status}</span><br />{fmt(r.app.last_dispatch_at)}</> : '—'}</td>
            <td className="table-cell text-xs text-slate-400">{fmt(r.app?.last_login_at ?? null)}</td>
            <td className="table-cell"><div className="flex gap-2 justify-end">
              <button className="btn-secondary btn-sm" disabled={!r.valid_phone || r.app?.status === 'disabled'} onClick={() => setConfirmRows([r])}>{r.app ? 'Re-send' : 'Invite'}</button>
              {r.app && (r.app.status === 'disabled'
                ? <button className="btn-secondary btn-sm" onClick={() => setStatus(r, 'active')}>Enable</button>
                : <button className="btn-ghost btn-sm text-red-400" onClick={() => setStatus(r, 'disabled')}>Disable</button>)}
              {r.app && pendingResetFor(r.app.user_id) && <span className="text-xs text-yellow-400 self-center">see Resets tab</span>}
            </div></td>
          </tr>)}
          {!loading && rows.length === 0 && <tr><td colSpan={9} className="table-cell text-center text-slate-500 py-10">No people match these filters</td></tr>}
        </tbody></table></div>
    </>}

    {tab === 'resets' && <div className="flex-1 overflow-auto">
      <div className="px-6 py-3 border-b border-slate-800"><label className="flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={showAllResets} onChange={e => setShowAllResets(e.target.checked)} /> Include resolved requests</label></div>
      <table className="w-full"><thead className="sticky top-0 bg-surface-900"><tr>
        {['Name', 'Phone', 'Requested', 'Status', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}</tr></thead><tbody>
          {resets.map(r => <tr className="table-row" key={r.id}>
            <td className="table-cell font-medium">{r.name || '—'}</td>
            <td className="table-cell text-slate-400">{r.phone || '—'}</td>
            <td className="table-cell text-xs text-slate-400">{fmt(r.requested_at)}</td>
            <td className="table-cell"><span className={r.status === 'pending' ? 'badge-yellow' : 'badge-green'}>{r.status}</span>{r.resolved_by && <p className="text-xs text-slate-500">by {r.resolved_by}</p>}</td>
            <td className="table-cell text-right">{r.status === 'pending' && <ResendButton id={r.id} onPrepared={item => setQueue([item])} />}</td>
          </tr>)}
          {resets.length === 0 && <tr><td colSpan={5} className="table-cell text-center text-slate-500 py-10">No password reset requests</td></tr>}
        </tbody></table></div>}

    {confirmRows && <ConfirmInvite rows={confirmRows} onClose={() => setConfirmRows(null)} onPrepared={items => { setConfirmRows(null); setQueue(items) }} />}
    {queue && <ChatQueue items={queue} onClose={() => { setQueue(null); setSelected(new Set()); load(); loadResets() }} />}
  </div>
}

function ResendButton({ id, onPrepared }: { id: string; onPrepared: (i: QueueItem) => void }) {
  const [busy, setBusy] = useState(false)
  const go = async () => {
    if (!window.confirm('This creates a NEW temporary password and signs the person out of the app. Continue?')) return
    setBusy(true)
    try {
      const res = await window.api.appAccess.resendTempPassword(id)
      if (res.success) onPrepared(res.data); else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to prepare message: ' + String(err))
    } finally { setBusy(false) }
  }
  return <button className="btn-secondary btn-sm" disabled={busy} onClick={go}>{busy ? 'Preparing…' : 'Re-send temp password'}</button>
}

function ConfirmInvite({ rows, onClose, onPrepared }: { rows: Row[]; onClose: () => void; onPrepared: (items: QueueItem[]) => void }) {
  const [busy, setBusy] = useState(false)
  const existing = rows.filter(r => r.app).length
  const go = async () => {
    setBusy(true)
    try {
      const res = await window.api.appAccess.invite(rows.map(r => r.agent_id ? { agent_id: r.agent_id } : { customer_id: r.customer_id }))
      if (res.success) onPrepared(res.data); else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to prepare invites: ' + String(err))
    } finally { setBusy(false) }
  }
  return <Modal title={`Prepare ${rows.length} invite${rows.length === 1 ? '' : 's'}`} onClose={onClose}
    footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button><button className="btn-primary" disabled={busy} onClick={go}>{busy ? 'Preparing…' : 'Prepare messages'}</button></>}>
    <div className="space-y-3 text-sm text-slate-300">
      <p>A temporary password is created for each person. Nothing is sent automatically: you will open each WhatsApp chat one at a time and press Send yourself.</p>
      {existing > 0 && <p className="text-yellow-400">{existing} of these already have an account. Their password will be replaced and they will be signed out of the app.</p>}
      <ul className="max-h-40 overflow-auto text-xs text-slate-400 list-disc pl-5">{rows.slice(0, 50).map(r => <li key={r.key}>{r.name} ({KIND_LABEL[r.kind]}) {r.phone}</li>)}{rows.length > 50 && <li>…and {rows.length - 50} more</li>}</ul>
    </div>
  </Modal>
}

function ChatQueue({ items, onClose }: { items: QueueItem[]; onClose: () => void }) {
  const ready = useMemo(() => items.filter(i => i.ok && i.dispatch_id), [items])
  const skipped = items.filter(i => !i.ok)
  const [idx, setIdx] = useState(0)
  const [opened, setOpened] = useState(false)
  const [done, setDone] = useState<string[]>([])
  const current = ready[idx]
  const finished = idx >= ready.length

  const discardRest = () => { ready.slice(idx).forEach(i => { if (i.dispatch_id) window.api.appAccess.discardChat(i.dispatch_id) }) }
  const close = () => { discardRest(); onClose() }

  const open = async () => {
    try {
      const res = await window.api.appAccess.openChat(current.dispatch_id)
      if (res.success) setOpened(true); else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to open WhatsApp: ' + String(err))
    }
  }
  const next = (sent: boolean) => {
    if (sent && current.name) setDone(d => [...d, current.name as string])
    if (!sent && current.dispatch_id) window.api.appAccess.discardChat(current.dispatch_id)
    setOpened(false); setIdx(i => i + 1)
  }

  return <Modal title={finished ? 'Invite queue finished' : `Send invite ${idx + 1} of ${ready.length}`} onClose={close}
    footer={finished ? <button className="btn-primary" onClick={onClose}>Close</button> : <>
      <button className="btn-secondary" onClick={close}>Stop queue</button>
      {opened
        ? <><button className="btn-secondary" onClick={open}>Open again</button><button className="btn-primary" onClick={() => next(true)}>I pressed Send. Next</button></>
        : <><button className="btn-secondary" onClick={() => next(false)}>Skip</button><button className="btn-primary" onClick={open}><MessageCircle size={14} /> Open WhatsApp chat</button></>}
    </>}>
    <div className="space-y-3 text-sm text-slate-300">
      {!finished && <>
        <p className="text-base font-semibold">{current.name}</p>
        <p className="text-slate-400">{current.phone}</p>
        <p>{opened ? 'WhatsApp is open with the message ready. Check the number, press Send there, then come back and continue.' : 'The message (with the temporary password) is ready. It opens in WhatsApp for you to review and send.'}</p>
      </>}
      {finished && <p>{done.length} marked as sent{ready.length - done.length > 0 ? `, ${ready.length - done.length} skipped or stopped` : ''}. Skipped people keep a temporary password that was never delivered: invite them again later.</p>}
      {skipped.length > 0 && <div className="text-xs text-red-400">Not prepared: {skipped.map(s => `${s.name || 'Unknown'} (${(s.skipped_reason || 'ERROR').replace(/_/g, ' ').toLowerCase()})`).join(', ')}</div>}
    </div>
  </Modal>
}
