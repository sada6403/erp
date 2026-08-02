import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import StatCard from '@/components/shared/StatCard'
import TypeToConfirmModal from '@/components/shared/TypeToConfirmModal'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'
import { Plus, Users, Coins, Repeat, Search, Download, FileSpreadsheet, FileText, Trash2, Power, PowerOff, Flame } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function ChitSchemesPage() {
  const navigate = useNavigate()
  const { user } = useAuthStore()
  const isSuperAdmin = Boolean(((user?.role as unknown as Row)?.permissions as Row)?.all)
  const [schemes, setSchemes] = useState<Row[]>([])
  const [purging, setPurging] = useState<Row | null>(null)
  const [branches, setBranches] = useState<Row[]>([])
  const [agents, setAgents] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [exporting, setExporting] = useState(false)

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

  const deleteScheme = async (s: Row, e: React.MouseEvent) => {
    e.stopPropagation()
    const hasActivity = Number(s.members_enrolled || 0) > 0 || Number(s.contributions_collected || 0) > 0
    const confirmMsg = hasActivity
      ? `"${s.name}" has enrolled members / collected contributions — it will be marked Cancelled (not removed) so history is preserved. Continue?`
      : `Permanently delete "${s.name}"? This scheme has no members or contributions, so it can be removed outright.`
    if (!confirm(confirmMsg)) return
    try {
      const res = await window.api.chits.delete(s.id as string)
      if (res.success) {
        toast.success(res.data?.hardDeleted ? 'Scheme deleted' : 'Scheme cancelled')
        load()
      } else {
        toast.error(String(res.error || 'Failed to delete scheme'))
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete scheme')
    }
  }

  const toggleActive = async (s: Row, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await window.api.chits.toggleActive(s.id as string)
      if (res.success) { toast.success(`Scheme marked ${res.data?.status}`); load() }
      else toast.error(String(res.error || 'Failed to update status'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to update status')
    }
  }

  const purgeScheme = async () => {
    if (!purging) return
    try {
      const res = await window.api.chits.purgeCancelled(purging.id as string)
      if (res.success) { toast.success('Scheme permanently purged'); setPurging(null); load() }
      else toast.error(String(res.error || 'Failed to purge scheme'))
    } catch (err: any) {
      toast.error(err.message || 'Failed to purge scheme')
    }
  }

  const filtered = schemes.filter(s => {
    const q = search.trim().toLowerCase()
    if (q && !String(s.name || '').toLowerCase().includes(q) && !String(s.scheme_number || '').toLowerCase().includes(q)) return false
    if (branchFilter && s.branch_id !== branchFilter) return false
    if (statusFilter && s.status !== statusFilter) return false
    return true
  })

  const totals = schemes.reduce<{ members: number; contributions: number; active: number }>((acc, s) => ({
    members: acc.members + Number(s.members_enrolled || 0),
    contributions: acc.contributions + Number(s.contributions_collected || 0),
    active: acc.active + (s.status === 'active' ? 1 : 0),
  }), { members: 0, contributions: 0, active: 0 })

  const exportRows = () => filtered.map(s => ({
    'Scheme #': s.scheme_number, Name: s.name, Branch: s.branch_name, Agent: s.agent_name,
    Status: s.status, Members: `${s.members_enrolled}/${s.member_count}`, Cycles: `${s.cycles_completed}/${s.cycle_count}`,
    'Chit Value': `Rs.${money(s.chit_value)}`, Collected: `Rs.${money(s.contributions_collected)}`,
  }))
  const exportMeta = { 'Report': 'Smart Buy Scheme Summary', Branch: branches.find(b => b.id === branchFilter)?.name as string || 'All Branches', Generated: new Date().toLocaleString() }
  const filename = `smartbuy-schemes-${new Date().toISOString().slice(0, 10)}`

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportCsvRows({ filename, rows: exportRows(), metadata: exportMeta })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Export failed')
    } finally { setExporting(false) }
  }
  const exportExcel = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportExcel({ filename, sheets: [{ name: 'Schemes', rows: exportRows() }] })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Export failed')
    } finally { setExporting(false) }
  }
  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportPdf({ filename, title: 'Smart Buy Scheme Summary', metadata: exportMeta, sections: [{ title: 'Schemes', rows: exportRows() }] })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Export failed')
    } finally { setExporting(false) }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy" subtitle={`${filtered.length} scheme(s)`}
        actions={
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF</button>
            <button onClick={() => setShowForm(true)} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> New Smart Buy Scheme
            </button>
          </div>
        }
      />

      <div className="grid grid-cols-3 gap-3 px-6 py-4 flex-shrink-0">
        <StatCard label="Active Schemes" value={totals.active} icon={Repeat} color="brand" />
        <StatCard label="Members Enrolled" value={totals.members} icon={Users} color="blue" />
        <StatCard label="Contributions Collected" value={`Rs.${money(totals.contributions)}`} icon={Coins} color="green" />
      </div>

      <div className="flex flex-wrap gap-3 px-6 pb-3 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or scheme number..." className="input pl-8 text-sm" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
        </select>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Scheme #', 'Name', 'Product', 'Agent', 'Members', 'Cycles', 'Contributions', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">{schemes.length === 0 ? 'No chit schemes yet — create one to get started' : 'No schemes match your search'}</td></tr>
            ) : filtered.map(s => (
              <tr key={s.id as string} className="table-row cursor-pointer" onClick={() => navigate(`/admin/chits/${s.id}`)}>
                <td className="table-cell font-mono text-xs font-semibold">{s.scheme_number as string}</td>
                <td className="table-cell font-medium">{s.name as string}</td>
                <td className="table-cell text-slate-400">{(s.product_name as string) || '—'}</td>
                <td className="table-cell text-slate-400">{(s.agent_name as string) || '—'}</td>
                <td className="table-cell">
                  {Number(s.members_enrolled || 0)} / {Number(s.member_count || 0)}
                  {s.status === 'pending' && (
                    <div className="text-[11px] text-amber-400 mt-0.5">
                      Need {Math.max(0, Number(s.min_members || 0) - Number(s.members_enrolled || 0))} more members
                    </div>
                  )}
                </td>
                <td className="table-cell">{Number(s.cycles_completed || 0)} / {Number(s.cycle_count || 0)}</td>
                <td className="table-cell text-brand-400 font-semibold">Rs.{money(s.contributions_collected)}</td>
                <td className="table-cell">
                  <span className={s.status === 'active' ? 'badge-green' : s.status === 'pending' ? 'badge-yellow' : s.status === 'completed' ? 'badge-blue' : 'badge-gray'}>{s.status as string}</span>
                </td>
                <td className="table-cell">
                  <div className="flex gap-1">
                    {(s.status === 'active' || s.status === 'inactive') && (
                      <button
                        onClick={e => toggleActive(s, e)}
                        className="btn-ghost btn-sm p-1.5"
                        title={s.status === 'active' ? 'Mark Inactive' : 'Mark Active'}
                      >
                        {s.status === 'active' ? <PowerOff size={13} /> : <Power size={13} />}
                      </button>
                    )}
                    {isSuperAdmin && s.status !== 'cancelled' && s.status !== 'completed' && (
                      <button
                        onClick={e => deleteScheme(s, e)}
                        className="btn-ghost btn-sm p-1.5 hover:text-red-500"
                        title="Delete / cancel scheme"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    {isSuperAdmin && s.status === 'cancelled' && (
                      <button
                        onClick={e => { e.stopPropagation(); setPurging(s) }}
                        className="btn-ghost btn-sm p-1.5 hover:text-red-600"
                        title="Permanently purge this cancelled scheme"
                      >
                        <Flame size={13} />
                      </button>
                    )}
                  </div>
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
      {purging && (
        <TypeToConfirmModal
          title="Permanently Purge Scheme"
          message={`This deletes "${purging.name}" (${purging.scheme_number}) and every member, contribution, draw, and commission record tied to it — for good. This cannot be undone. Only possible because no product was ever actually redeemed through this scheme.`}
          confirmText={String(purging.scheme_number)}
          actionLabel="Purge Permanently"
          onClose={() => setPurging(null)}
          onConfirm={purgeScheme}
        />
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
    member_count: 50, cycle_count: 12, min_members: 50, frequency: 'monthly',
    contribution_amount: 0, chit_value: 0,
    early_redemption_count: 0, early_redemption_amount: 0,
    repayment_months: 12, agent_commission_pct: 0,
    start_date: new Date().toISOString().slice(0, 10), notes: '',
    registration_start_date: '', registration_end_date: '',
    late_payment_days: 5, late_fee_amount: 0,
  })
  const [saving, setSaving] = useState(false)

  // Pre-fill company-wide Smart Buy defaults (Admin Configuration Module) —
  // still fully overridable per scheme below.
  useEffect(() => {
    window.api.settings.get().then((res: { success: boolean; data?: Row }) => {
      if (!res.success || !res.data) return
      setForm(p => ({
        ...p,
        min_members: Number(res.data!.smartbuy_default_min_members ?? p.min_members),
        late_payment_days: Number(res.data!.smartbuy_default_late_payment_days ?? p.late_payment_days),
        late_fee_amount: Number(res.data!.smartbuy_default_late_fee_amount ?? p.late_fee_amount),
        repayment_months: Number(res.data!.smartbuy_default_repayment_months ?? p.repayment_months),
      }))
    }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Scheme name is required'); return }
    if (form.member_count <= 0) { toast.error('Member count must be greater than 0'); return }
    if (form.cycle_count <= 0) { toast.error('Cycle count must be greater than 0'); return }
    if (form.min_members <= 0) { toast.error('Minimum members must be greater than 0'); return }
    if (form.min_members > form.member_count) { toast.error('Minimum members cannot exceed member count (capacity)'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.create(form)
      if (res.success) {
        toast.success('Smart Buy scheme created')
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
    <Modal title="New Smart Buy Scheme" size="lg" onClose={onClose}
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
            <ProductSearchSelect
              products={products}
              value={form.product_id}
              onChange={id => setForm(p => ({ ...p, product_id: id }))}
            />
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
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Minimum Members to Activate *</label><input type="number" value={form.min_members} onChange={f('min_members')} className="input" min={1} /></div>
        <p className="text-xs text-slate-500 -mt-2">Scheme stays "Pending" — no draws, no first installment collection — until enrolled members reach this number.</p>
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
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Registration Opens</label><input type="date" value={form.registration_start_date} onChange={f('registration_start_date')} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Registration Closes</label><input type="date" value={form.registration_end_date} onChange={f('registration_end_date')} className="input" /></div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">Leave blank for no registration lock — new members can enroll any time.</p>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Late Payment Grace (days into month)</label><input type="number" value={form.late_payment_days} onChange={f('late_payment_days')} className="input" min={0} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Late Fee (Rs.)</label><input type="number" value={form.late_fee_amount} onChange={f('late_fee_amount')} className="input" min={0} /></div>
        </div>
        <p className="text-xs text-slate-500 -mt-2">A cycle payment collected after this day of the month automatically adds the late fee. Set grace days to 0 to disable.</p>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}
