import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import { Plus, Users, Coins, Repeat, Search } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ChitSchemesPage() {
  const navigate = useNavigate()
  const [schemes, setSchemes] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [agents, setAgents] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')

  const load = async () => {
    setLoading(true)
    try {
      const [s, b, a, p] = await Promise.all([
        window.api.chits.list(),
        window.api.admin.branches.list(),
        window.api.agents.list(),
        window.api.products.list(),
      ])
      if (s.success) setSchemes(s.data as Row[])
      else toast.error(String(s.error || 'Failed to load chit schemes'))
      if (b.success) setBranches(b.data as Row[])
      else toast.error(String(b.error || 'Failed to load branches'))
      if (a.success) setAgents(a.data as Row[])
      else toast.error(String(a.error || 'Failed to load agents'))
      if (p.success) setProducts(p.data as Row[])
      else toast.error(String(p.error || 'Failed to load products'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to load data')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = schemes.filter(s => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return String(s.name || '').toLowerCase().includes(q) || String(s.scheme_number || '').toLowerCase().includes(q)
  })

  const totals = schemes.reduce<{ members: number; contributions: number; active: number }>((acc, s) => ({
    members: acc.members + Number(s.members_enrolled || 0),
    contributions: acc.contributions + Number(s.contributions_collected || 0),
    active: acc.active + (s.status === 'active' ? 1 : 0),
  }), { members: 0, contributions: 0, active: 0 })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Chit Fund" subtitle={`${filtered.length} scheme(s)`}
        actions={
          <button onClick={() => setShowForm(true)} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New Chit Scheme
          </button>
        }
      />

      <div className="grid grid-cols-3 gap-3 px-6 py-4 flex-shrink-0">
        <StatCard label="Active Schemes" value={totals.active} icon={Repeat} color="brand" />
        <StatCard label="Members Enrolled" value={totals.members} icon={Users} color="blue" />
        <StatCard label="Contributions Collected" value={`Rs.${money(totals.contributions)}`} icon={Coins} color="green" />
      </div>

      <div className="flex gap-3 px-6 pb-3 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or scheme number..." className="input pl-8 text-sm" />
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Scheme #', 'Name', 'Product', 'Agent', 'Members', 'Cycles', 'Contributions', 'Status'].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={8} className="text-center py-16 text-slate-500">{schemes.length === 0 ? 'No chit schemes yet — create one to get started' : 'No schemes match your search'}</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id as string} className="table-row cursor-pointer" onClick={() => navigate(`/admin/chits/${s.id}`)}>
                <td className="table-cell font-mono text-xs font-semibold">{s.scheme_number as string}</td>
                <td className="table-cell font-medium">{s.name as string}</td>
                <td className="table-cell text-slate-400">{(s.product_name as string) || '—'}</td>
                <td className="table-cell text-slate-400">{(s.agent_name as string) || '—'}</td>
                <td className="table-cell">{Number(s.members_enrolled || 0)} / {Number(s.member_count || 0)}</td>
                <td className="table-cell">{Number(s.cycles_completed || 0)} / {Number(s.cycle_count || 0)}</td>
                <td className="table-cell text-brand-400 font-semibold">Rs.{money(s.contributions_collected)}</td>
                <td className="table-cell">
                  <span className={s.status === 'active' ? 'badge-green' : s.status === 'completed' ? 'badge-blue' : 'badge-gray'}>{s.status as string}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <ChitSchemeForm branches={branches} agents={agents} products={products}
          onClose={() => setShowForm(false)}
          onSave={(id) => { setShowForm(false); load(); navigate(`/admin/chits/${id}`) }} />
      )}
    </div>
  )
}

function ChitSchemeForm({ branches, agents, products, onClose, onSave }: {
  branches: Row[]; agents: Row[]; products: Row[]
  onClose: () => void; onSave: (id: string) => void
}) {
  const [form, setForm] = useState({
    name: '', branch_id: '', product_id: '', agent_id: '',
    member_count: 50, cycle_count: 12, frequency: 'monthly',
    contribution_amount: 0, chit_value: 0,
    early_redemption_count: 0, early_redemption_amount: 0,
    repayment_months: 12, agent_commission_pct: 0,
    start_date: new Date().toISOString().slice(0, 10), notes: '',
  })
  const [saving, setSaving] = useState(false)

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Scheme name is required'); return }
    if (form.member_count <= 0) { toast.error('Member count must be greater than 0'); return }
    if (form.cycle_count <= 0) { toast.error('Cycle count must be greater than 0'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.create(form)
      if (res.success) {
        toast.success('Chit scheme created')
        onSave(res.data.id)
      } else {
        toast.error(String(res.error || 'Save failed'))
      }
    } catch (err: any) {
      toast.error(err.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="New Chit Scheme" size="lg" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Create Scheme'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Scheme Name *</label><input value={form.name} onChange={f('name')} className="input" placeholder="e.g. Rice Cooker Chit — Batch 4" /></div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Branch</label>
            <select value={form.branch_id} onChange={f('branch_id')} className="input">
              <option value="">— Select —</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Product</label>
            <select value={form.product_id} onChange={f('product_id')} className="input">
              <option value="">— Select —</option>
              {products.map(p => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Agent</label>
            <select value={form.agent_id} onChange={f('agent_id')} className="input">
              <option value="">— Select —</option>
              {agents.map(a => <option key={a.id as string} value={a.id as string}>{a.name as string} ({a.code as string})</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Member Count *</label><input type="number" value={form.member_count} onChange={f('member_count')} className="input" min={1} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Draw Cycles *</label><input type="number" value={form.cycle_count} onChange={f('cycle_count')} className="input" min={1} /></div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Frequency</label>
            <select value={form.frequency} onChange={f('frequency')} className="input">
              <option value="monthly">Monthly</option>
              <option value="weekly">Weekly</option>
            </select>
          </div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">If member count exceeds draw cycles, all remaining members receive their product together at the final cycle.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Contribution / Cycle (Rs.)</label><input type="number" value={form.contribution_amount} onChange={f('contribution_amount')} className="input" min={0} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Full Chit Value (Rs.)</label><input type="number" value={form.chit_value} onChange={f('chit_value')} className="input" min={0} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Early Redemption Slots</label><input type="number" value={form.early_redemption_count} onChange={f('early_redemption_count')} className="input" min={0} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Early Redemption Amount (Rs.)</label><input type="number" value={form.early_redemption_amount} onChange={f('early_redemption_amount')} className="input" min={0} /></div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">The first N members (by join order) can take the product immediately for this starting amount, then repay the rest afterward.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Repayment Duration (months)</label><input type="number" value={form.repayment_months} onChange={f('repayment_months')} className="input" min={1} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Agent Commission %</label><input type="number" value={form.agent_commission_pct} onChange={f('agent_commission_pct')} className="input" min={0} max={100} step="0.01" /></div>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Start Date</label><input type="date" value={form.start_date} onChange={f('start_date')} className="input" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}
