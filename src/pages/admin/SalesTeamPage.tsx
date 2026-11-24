import { useCallback, useEffect, useMemo, useState } from 'react'
import { RefreshCw, UserPlus } from 'lucide-react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

interface Member {
  staff_id: string; name: string; code: string | null; level: string; period: string; reports_to: string | null
  target: number; target_source: 'own' | 'rollup' | 'none'; registrations_target: number | null
  sales_net: number; contributions: number; achieved: number; registrations: number; achievement_pct: number | null; team_size: number
}
interface Assignment { id: string; staff_id: string; name: string; code: string | null; level: string; reports_to: string | null; reports_to_name: string | null }
interface Agent { id: string; code: string | null; name: string }
interface Level { key: string; rank: number }
interface TargetRow { id: string; period: string; amount: number; registrations_target: number | null; active_from: string | null; deactivated_at: string | null; active: boolean }

const LEVEL_NAME: Record<string, string> = {
  director: 'Director', agm: 'Assistant General Manager', manager: 'Manager', zonal_manager: 'Zonal Manager',
  regional_manager: 'Regional Manager', branch_manager: 'Branch Manager', field_officer: 'Field Officer',
}
const money = (n: number) => n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const thisMonth = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 7)

export default function SalesTeamPage() {
  const [period, setPeriod] = useState(thisMonth())
  const [rows, setRows] = useState<Member[]>([])
  const [assign, setAssign] = useState<{ items: Assignment[]; agents: Agent[]; levels: Level[] }>({ items: [], agents: [], levels: [] })
  const [loading, setLoading] = useState(false)
  const [addFor, setAddFor] = useState<{ staff_id?: string } | null>(null)
  const [targetFor, setTargetFor] = useState<Member | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [a, o] = await Promise.all([window.api.salesTeam.assignments(), window.api.salesTeam.overview(period)])
      if (a.success) setAssign(a.data); else toast.error(a.error || 'Failed to load the hierarchy')
      if (o.success) setRows(o.data.items); else toast.error(o.error || 'Failed to load performance')
    } catch (err) {
      toast.error('Failed to load: ' + String(err))
    } finally { setLoading(false) }
  }, [period])
  useEffect(() => { void load() }, [load])

  const rank = useMemo(() => Object.fromEntries(assign.levels.map(l => [l.key, l.rank])), [assign.levels])
  const nameOf = useMemo(() => Object.fromEntries(assign.items.map(i => [i.staff_id, i.name])), [assign.items])
  // tree order: each person right under their boss
  const ordered = useMemo(() => {
    const byBoss = new Map<string | null, Member[]>()
    for (const r of rows) byBoss.set(r.reports_to, [...(byBoss.get(r.reports_to) ?? []), r])
    const out: Array<{ m: Member; depth: number }> = []
    const walk = (boss: string | null, depth: number) => {
      for (const m of (byBoss.get(boss) ?? []).sort((a, b) => a.name.localeCompare(b.name))) { out.push({ m, depth }); walk(m.staff_id, depth + 1) }
    }
    const ids = new Set(rows.map(r => r.staff_id))
    walk(null, 0)
    for (const r of rows) if (r.reports_to && !ids.has(r.reports_to)) { out.push({ m: r, depth: 0 }); walk(r.staff_id, 1) }
    return out
  }, [rows])

  const remove = async (m: Member) => {
    if (!window.confirm(`Remove ${m.name} from the sales team? Their history is kept.`)) return
    const res = await window.api.salesTeam.unassign(m.staff_id)
    if (res.success) { toast.success('Removed from the hierarchy'); void load() } else toast.error(res.error || 'Could not remove')
  }

  return <div className="flex flex-col h-full overflow-hidden">
    <PageHeader title="Sales Team" subtitle="Hierarchy, monthly targets and target vs achievement (data comes from the mobile app and the invoices)"
      actions={<div className="flex gap-2">
        <button className="btn-secondary btn-sm" onClick={load}><RefreshCw size={14} /> Refresh</button>
        <button className="btn-primary btn-sm" onClick={() => setAddFor({})}><UserPlus size={14} /> Add person</button>
      </div>} />
    <div className="flex items-center gap-3 px-6 py-3 border-b border-slate-800">
      <label className="text-xs text-slate-400">Month</label>
      <input type="month" className="input w-40" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} />
      <p className="text-xs text-slate-500">Achieved = sales net of returns and cancellations + Smart Buy contributions collected, excluding invoices paid from the Smart Buy wallet. A manager's numbers are the whole team's.</p>
      <span className="text-xs text-slate-500 ml-auto">{loading ? 'Loading…' : ''}</span>
    </div>
    <div className="flex-1 overflow-auto">
      <table className="w-full"><thead className="sticky top-0 bg-surface-900"><tr>
        {['Person', 'Level', 'Reports to', 'Target', 'Achieved', '%', 'Registrations', ''].map(h => <th className="table-header px-4 py-3 text-left" key={h}>{h}</th>)}
      </tr></thead><tbody>
        {ordered.map(({ m, depth }) => <tr className="table-row" key={m.staff_id}>
          <td className="table-cell"><div style={{ paddingLeft: depth * 18 }}><p className="font-medium">{m.name}</p><p className="text-xs text-slate-500 font-mono">{m.code || '—'}{m.team_size ? ` · team ${m.team_size}` : ''}</p></div></td>
          <td className="table-cell">{LEVEL_NAME[m.level] ?? m.level}</td>
          <td className="table-cell">{m.reports_to ? nameOf[m.reports_to] ?? '—' : '—'}</td>
          <td className="table-cell">{m.target_source === 'none' ? '—' : money(m.target)}{m.target_source === 'rollup' && <span className="badge-yellow ml-2">team</span>}</td>
          <td className="table-cell">{money(m.achieved)}</td>
          <td className="table-cell">{m.achievement_pct == null ? '—' : <span className={m.achievement_pct >= 50 ? 'badge-green' : 'badge-red'}>{m.achievement_pct.toFixed(1)}%</span>}</td>
          <td className="table-cell">{m.registrations}{m.registrations_target != null ? ` / ${m.registrations_target}` : ''}</td>
          <td className="table-cell"><div className="flex gap-2">
            <button className="btn-primary btn-sm" onClick={() => setTargetFor(m)}>Target</button>
            <button className="btn-secondary btn-sm" onClick={() => setAddFor({ staff_id: m.staff_id })}>Move</button>
            <button className="btn-secondary btn-sm" onClick={() => remove(m)}>Remove</button>
          </div></td>
        </tr>)}
        {!ordered.length && <tr><td colSpan={8} className="table-cell text-center text-slate-500 py-10">Nobody is on the sales hierarchy yet. Add the Director first, then everyone under them.</td></tr>}
      </tbody></table>
    </div>
    {addFor && <AssignModal initial={addFor.staff_id} data={assign} rank={rank} onClose={() => setAddFor(null)} onDone={() => { setAddFor(null); void load() }} />}
    {targetFor && <TargetModal member={targetFor} period={period} onClose={() => setTargetFor(null)} onDone={() => { setTargetFor(null); void load() }} />}
  </div>
}

function AssignModal({ initial, data, rank, onClose, onDone }: { initial?: string; data: { items: Assignment[]; agents: Agent[] }; rank: Record<string, number>; onClose: () => void; onDone: () => void }) {
  const current = data.items.find(i => i.staff_id === initial)
  const [staff, setStaff] = useState(initial ?? '')
  const [level, setLevel] = useState(current?.level ?? 'field_officer')
  const [boss, setBoss] = useState(current?.reports_to ?? '')
  const [busy, setBusy] = useState(false)
  const bosses = data.items.filter(i => i.staff_id !== staff && (rank[i.level] ?? 99) < (rank[level] ?? 0))
  const save = async () => {
    setBusy(true)
    try {
      const res = await window.api.salesTeam.assign({ staff_id: staff, level_key: level, reports_to_staff_id: level === 'director' ? undefined : boss })
      if (res.success) { toast.success('Saved'); onDone() } else toast.error(res.error || 'Could not save')
    } finally { setBusy(false) }
  }
  return <Modal title={initial ? 'Move person' : 'Add person to the sales team'} onClose={onClose} footer={<>
    <button className="btn-secondary" onClick={onClose}>Cancel</button>
    <button className="btn-primary" disabled={busy || !staff || (level !== 'director' && !boss)} onClick={save}>Save</button>
  </>}>
    <div className="flex flex-col gap-3">
      <div><label className="label">Person (agent / staff record)</label>
        <select className="input" value={staff} disabled={!!initial} onChange={e => setStaff(e.target.value)}>
          <option value="">Choose…</option>
          {data.agents.map(a => <option key={a.id} value={a.id}>{a.name}{a.code ? ` (${a.code})` : ''}</option>)}
        </select></div>
      <div><label className="label">Level</label>
        <select className="input" value={level} onChange={e => { setLevel(e.target.value); setBoss('') }}>
          {Object.keys(LEVEL_NAME).map(k => <option key={k} value={k}>{LEVEL_NAME[k]}</option>)}
        </select></div>
      {level !== 'director' && <div><label className="label">Reports to</label>
        <select className="input" value={boss} onChange={e => setBoss(e.target.value)}>
          <option value="">Choose…</option>
          {bosses.map(b => <option key={b.staff_id} value={b.staff_id}>{b.name} — {LEVEL_NAME[b.level]}</option>)}
        </select>
        {!bosses.length && <p className="text-xs text-amber-400 mt-1">Nobody on a higher level yet. Add the higher levels first.</p>}</div>}
      <p className="text-xs text-slate-500">A person always reports to someone on a higher level. Moving a person keeps their team with them; the old position is kept in the history.</p>
    </div>
  </Modal>
}

function TargetModal({ member, period, onClose, onDone }: { member: Member; period: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(member.target_source === 'own' ? String(member.target) : '')
  const [regs, setRegs] = useState(member.registrations_target != null ? String(member.registrations_target) : '')
  const [history, setHistory] = useState<TargetRow[]>([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { window.api.salesTeam.targets(member.staff_id).then((r: { success: boolean; data: TargetRow[] }) => { if (r.success) setHistory(r.data) }).catch(() => {}) }, [member.staff_id])
  const save = async () => {
    setBusy(true)
    try {
      const res = await window.api.salesTeam.setTarget({ staff_id: member.staff_id, period, amount: Number(amount), registrations_target: regs })
      if (res.success) { toast.success('Target saved (the previous one is kept in the history)'); onDone() } else toast.error(res.error || 'Could not save')
    } finally { setBusy(false) }
  }
  return <Modal title={`Target for ${member.name} — ${period}`} onClose={onClose} footer={<>
    <button className="btn-secondary" onClick={onClose}>Cancel</button>
    <button className="btn-primary" disabled={busy || amount === '' || Number(amount) < 0} onClick={save}>Save target</button>
  </>}>
    <div className="flex flex-col gap-3">
      {member.target_source === 'rollup' && <p className="text-xs text-amber-400">Today this is the total of the team's targets ({money(member.target)}). Saving a number here overrides that total.</p>}
      <div><label className="label">Money target (Rs)</label><input className="input" type="number" min={0} value={amount} onChange={e => setAmount(e.target.value)} autoFocus /></div>
      <div><label className="label">Smart Buy registrations target (optional)</label><input className="input" type="number" min={0} value={regs} onChange={e => setRegs(e.target.value)} /></div>
      {history.length > 0 && <div><p className="text-xs text-slate-400 mb-1">History</p>
        <div className="max-h-40 overflow-auto text-xs">{history.map(h => <div key={h.id} className="flex justify-between border-b border-slate-800 py-1">
          <span>{h.period}</span><span>{money(h.amount)}{h.registrations_target != null ? ` · ${h.registrations_target} reg.` : ''}</span>
          <span className={h.active ? 'text-emerald-400' : 'text-slate-500'}>{h.active ? 'active' : 'replaced'}</span></div>)}</div></div>}
    </div>
  </Modal>
}
