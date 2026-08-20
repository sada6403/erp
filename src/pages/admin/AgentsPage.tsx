import { useEffect, useState } from 'react'
import NumberInput from '@/components/shared/NumberInput'
import CreatableSearchSelect from '@/components/shared/CreatableSearchSelect'
import Modal from '@/components/shared/Modal'
import DeleteConfirmModal from '@/components/shared/DeleteConfirmModal'
import StatCard from '@/components/shared/StatCard'
import { Plus, Edit2, Eye, Upload, FileDown, Download, FileSpreadsheet, FileText, Target, DollarSign, Receipt, Search, Trash2, Contact, KeyRound } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDeleteAction } from '@/hooks/useDeleteAction'

type Agent = Record<string, unknown> & { id: string; code: string; name: string; status: string }
type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Rendered as the "Agents" tab inside Employee Management (UsersPage.tsx) —
// not a standalone page/route anymore (Issue 17: Agent is a staff position/
// type within one unified module, not a separate module). The underlying
// data model is untouched: agents still live in their own table, linked to
// users via agents.user_id, exactly as before — only the navigation/UI is
// unified, since the agents table's id is referenced extensively by the
// Smart Buy module and a real schema merge was explicitly out of scope.
export function AgentsSection() {
  const [agents, setAgents] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Agent | null>(null)
  const [viewing, setViewing] = useState<Agent | null>(null)
  const [viewingDetails, setViewingDetails] = useState<Agent | null>(null)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')

  const load = async (branchId?: string) => {
    setLoading(true)
    try {
      const [a, b] = await Promise.all([
        window.api.agents.reportAllSummary({ branchId: branchId || undefined }),
        window.api.admin.branches.list(),
      ])
      if (a.success) setAgents(a.data as Row[])
      if (b.success) setBranches(b.data as Row[])
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load(branchFilter) }, [branchFilter]) // eslint-disable-line react-hooks/exhaustive-deps

  const filteredAgents = agents.filter(a => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return [a.code, a.name, a.nic, a.phone, a.email, a.position, a.branch_name, a.region_name, a.zone_name, a.status]
      .some(v => String(v || '').toLowerCase().includes(q))
  })

  const downloadTemplate = async () => {
    try {
      const res = await window.api.agents.downloadTemplate()
      if (res.success) toast.success('Template saved')
      else if (!res.cancelled) toast.error(res.error || 'Failed to save template')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to save template')
    }
  }

  const bulkImport = async () => {
    setImporting(true)
    let res
    try {
      res = await window.api.agents.importExcel()
    } catch (err) {
      setImporting(false)
      toast.error((err as Error)?.message || 'Import failed')
      return
    }
    setImporting(false)
    if (res.cancelled) return
    if (!res.success) { toast.error(res.error || 'Import failed'); return }
    if (res.imported) toast.success(`Imported ${res.imported} agent(s)`)
    if (res.skipped) {
      toast.error(`Skipped ${res.skipped} row(s)${res.errors?.[0] ? ` — e.g. ${res.errors[0]}` : ''}`, { duration: 6000 })
    }
    if (res.imported) load(branchFilter)
  }

  const branchName = (id: unknown) => (branches.find(b => b.id === id)?.name as string) || '—'

  const toggleStatus = async (a: Row) => {
    const nextStatus = a.status === 'active' ? 'inactive' : 'active'
    try {
      const res = await window.api.agents.update(a.id as string, { status: nextStatus })
      if (res.success) { toast.success(`Agent marked ${nextStatus}`); load(branchFilter) }
      else toast.error(String(res.error || 'Failed to update status'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update status')
    }
  }

  const del = useDeleteAction<Row & { id: string }>(id => window.api.agents.delete(id), () => load(branchFilter))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <p className="text-sm text-slate-400">{filteredAgents.length} agent(s)</p>
        <div className="flex gap-2">
          <button onClick={downloadTemplate} className="btn-secondary btn-sm gap-1.5">
            <FileDown size={14} /> Template
          </button>
          <button onClick={bulkImport} disabled={importing} className="btn-secondary btn-sm gap-1.5">
            <Upload size={14} /> {importing ? 'Importing...' : 'Bulk Import'}
          </button>
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Agent
          </button>
        </div>
      </div>

      <div className="flex gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by Agent ID, name, NIC, mobile, email, position, branch, region, zone..." className="input pl-8 text-sm" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm max-w-xs">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Agent ID', 'Name', 'Position', 'Branch', 'Region', 'Monthly Target', 'Commission Earned', 'Status', 'Login', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={10} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filteredAgents.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-16 text-slate-500">{agents.length === 0 ? 'No agents yet — add one to get started' : 'No agents match your filters'}</td></tr>
            ) : filteredAgents.map(a => {
              return (
                <tr key={a.id as string} className="table-row cursor-pointer" onClick={() => setViewingDetails(a as Agent)}>
                  <td className="table-cell font-mono text-xs font-semibold">{a.code as string}</td>
                  <td className="table-cell font-medium">{a.name as string}</td>
                  <td className="table-cell text-slate-400">{(a.position as string) || '—'}</td>
                  <td className="table-cell text-slate-400">{branchName(a.branch_id)}</td>
                  <td className="table-cell text-slate-400">{(a.region_name as string) || '—'}</td>
                  <td className="table-cell text-slate-400">Rs.{money(a.monthly_target)}</td>
                  <td className="table-cell text-brand-400 font-semibold">Rs.{money(a.commission_total)}</td>
                  <td className="table-cell">
                    <button
                      onClick={e => { e.stopPropagation(); toggleStatus(a) }}
                      className={a.status === 'active' ? 'badge-green' : 'badge-gray'}
                      title="Click to toggle active/inactive"
                    >
                      {a.status as string}
                    </button>
                  </td>
                  <td className="table-cell">
                    <span className={a.user_id ? 'badge-blue' : 'badge-gray'}>{a.user_id ? 'Linked' : 'No Login'}</span>
                  </td>
                  <td className="table-cell" onClick={e => e.stopPropagation()}>
                    <div className="flex gap-1">
                      <button onClick={() => setViewingDetails(a as Agent)} className="btn-ghost btn-sm p-1.5" title="Staff Details"><Contact size={13} /></button>
                      <button onClick={() => setViewing(a as Agent)} className="btn-ghost btn-sm p-1.5" title="Commission Report"><Eye size={13} /></button>
                      <button onClick={() => { setEditing(a as Agent); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                      <button onClick={() => del.requestDelete(a as Row & { id: string })} className="btn-ghost btn-sm p-1.5 hover:text-red-500" title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {showForm && (
        <AgentForm agent={editing} branches={branches} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
      {viewing && (
        <AgentReportModal agent={viewing} onClose={() => setViewing(null)} />
      )}
      {viewingDetails && (
        <StaffDetailsModal
          agent={viewingDetails}
          onClose={() => setViewingDetails(null)}
          onChanged={() => { load(branchFilter) }}
          onViewFullReport={() => { setViewingDetails(null); setViewing(viewingDetails) }}
          onEdit={() => { setViewingDetails(null); setEditing(viewingDetails); setShowForm(true) }}
        />
      )}

      {del.target && (
        <DeleteConfirmModal
          title="Delete Agent"
          itemLabel={String(del.target.name || '')}
          message="This only works if the agent has no invoices, schemes, or commission history. The agent will be removed from this device and the cloud database."
          busy={del.busy}
          onCancel={del.cancel}
          onConfirm={del.confirm}
        />
      )}
    </div>
  )
}

function AgentForm({ agent, branches, onClose, onSave }: { agent: Agent | null; branches: Row[]; onClose: () => void; onSave: () => void }) {
  const [regions, setRegions] = useState<Row[]>([])
  const [positions, setPositions] = useState<Row[]>([])
  const [form, setForm] = useState({
    code: String(agent?.code || ''),
    name: String(agent?.name || ''),
    phone: String(agent?.phone || ''),
    email: String(agent?.email || ''),
    nic: String(agent?.nic || ''),
    branch_id: String(agent?.branch_id || ''),
    default_commission_pct: Number(agent?.default_commission_pct || 0),
    monthly_target: Number(agent?.monthly_target || 0),
    status: String(agent?.status || 'active'),
    notes: String(agent?.notes || ''),
    etf_number: String(agent?.etf_number || ''),
    epf_number: String(agent?.epf_number || ''),
    date_of_birth: String(agent?.date_of_birth || ''),
    position: String(agent?.position || ''),
    region_id: String(agent?.region_id || ''),
    appointment_date: String(agent?.appointment_date || ''),
    missing_documents: String(agent?.missing_documents || ''),
  })
  const [saving, setSaving] = useState(false)
  const [duplicateOf, setDuplicateOf] = useState<string | null>(null)

  useEffect(() => {
    window.api.regions.list({}).then((r: { success: boolean; data?: Row[] }) => { if (r.success) setRegions(r.data || []) }).catch(() => {})
    window.api.positions.list().then((r: { success: boolean; data?: Row[] }) => { if (r.success) setPositions(r.data || []) }).catch(() => {})
  }, [])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (!form.code.trim()) { toast.error('Agent / Employee ID is required'); return }
    if (!form.name.trim()) { toast.error('Full name is required'); return }
    setSaving(true)
    setDuplicateOf(null)
    try {
      const res = agent
        ? await window.api.agents.update(agent.id, form)
        : await window.api.agents.create(form)
      if (res.success) {
        toast.success(agent ? 'Agent updated' : 'Agent created')
        onSave()
      } else {
        toast.error(String(res.error || 'Save failed'), { duration: 6000 })
        // §2: "If the Agent ID already exists, show the existing staff
        // record instead of creating another one" — backend returns
        // existingId specifically for a duplicate code/NIC rejection.
        if ((res as { existingId?: string }).existingId) setDuplicateOf((res as { existingId?: string }).existingId as string)
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={agent ? 'Edit Agent' : 'Add Agent'} size="lg" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-5">
        {duplicateOf && (
          <div className="rounded-lg border px-3 py-2 text-xs" style={{ borderColor: '#f59e0b', background: 'color-mix(in srgb, #f59e0b 10%, transparent)', color: '#a16207' }}>
            A matching staff record already exists. Close this form and open that Agent's Staff Details instead of creating a duplicate.
          </div>
        )}

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Personal Information</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label><input value={form.name} onChange={f('name')} className="input" autoFocus /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC Number</label><input value={form.nic} onChange={f('nic')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Date of Birth</label><input type="date" value={form.date_of_birth} onChange={f('date_of_birth')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">ETF Number</label><input value={form.etf_number} onChange={f('etf_number')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">EPF Number</label><input value={form.epf_number} onChange={f('epf_number')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Mobile</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-slate-400 mb-1">Missing Documents</label><input value={form.missing_documents} onChange={f('missing_documents')} className="input" placeholder="e.g. NIC copy, photo" /></div>
            <div className="col-span-2"><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-16 resize-none" /></div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Role &amp; Location</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Agent / Employee ID *</label><input value={form.code} onChange={f('code')} className="input" placeholder="NF/NA/258" /></div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Position / Designation</label>
              <CreatableSearchSelect
                items={positions.map(p => ({ id: String(p.name), label: String(p.name) }))}
                value={form.position}
                onChange={name => setForm(p => ({ ...p, position: name }))}
                placeholder="Select or add a position..."
                createLabel="Add position"
                onCreate={async (name) => {
                  const res = await window.api.positions.create({ name })
                  if (!res.success) { toast.error(res.error || 'Failed to create position'); return null }
                  setPositions(prev => [...prev, { id: res.data.id, name }])
                  toast.success(`Position "${name}" added`)
                  return { id: name, label: name }
                }}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Branch</label>
              <select value={form.branch_id} onChange={f('branch_id')} className="input">
                <option value="">— Select —</option>
                {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Region</label>
              <select value={form.region_id} onChange={f('region_id')} className="input">
                <option value="">— Select —</option>
                {regions.map(r => <option key={r.id as string} value={r.id as string}>{r.name as string}{r.zone_name ? ` (${r.zone_name})` : ''}</option>)}
              </select>
            </div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Appointment Date</label><input type="date" value={form.appointment_date} onChange={f('appointment_date')} className="input" /></div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
              <select value={form.status} onChange={f('status')} className="input">
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Default Commission %</label><NumberInput value={form.default_commission_pct} onChange={f('default_commission_pct')} className="input" min={0} max={100} step="0.01" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Monthly Target (Rs.)</label><NumberInput value={form.monthly_target} onChange={f('monthly_target')} className="input" min={0} /></div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// Staff Details — the combined profile view: Personal Information, Role &
// Location (both straight off the already-loaded agent row — no separate
// fetch), Performance & Earnings (existing agents:report + chits:agents:detail
// endpoints, condensed — "View Full Report" opens the existing, already-
// built AgentReportModal for the full breakdown/export), and Login/Access
// (shows the linked user if any, or a "Create Login" action if not).
function StaffDetailsModal({ agent, onClose, onChanged, onViewFullReport, onEdit }: {
  agent: Agent
  onClose: () => void
  onChanged: () => void
  onViewFullReport: () => void
  onEdit: () => void
}) {
  const [posStats, setPosStats] = useState<Row | null>(null)
  const [smartBuyStats, setSmartBuyStats] = useState<Row | null>(null)
  const [linkedUser, setLinkedUser] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [showCreateLogin, setShowCreateLogin] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const today = new Date().toISOString().slice(0, 10)
      const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
      const [posRes, sbRes, usersRes] = await Promise.all([
        window.api.agents.report({ agentId: agent.id, dateFrom: monthStart, dateTo: today }),
        window.api.chits?.agents?.detail?.(agent.id).catch(() => ({ success: false })) ?? Promise.resolve({ success: false }),
        agent.user_id ? window.api.admin.users.list() : Promise.resolve({ success: false }),
      ])
      if (posRes.success) setPosStats(posRes.data as Row)
      if ((sbRes as { success: boolean }).success) setSmartBuyStats((sbRes as { data: Row }).data)
      if ((usersRes as { success: boolean }).success) {
        const users = ((usersRes as { data: Row[] }).data || [])
        setLinkedUser(users.find(u => u.id === agent.user_id) || null)
      }
    } catch {
      // Performance data is a nice-to-have on this screen — a failure here
      // must not block viewing the Personal/Role/Location sections.
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = (posStats?.stats || {}) as Row

  return (
    <Modal title={`${agent.code} — ${agent.name}`} size="lg" onClose={onClose}
      footer={<>
        <button onClick={onEdit} className="btn-secondary gap-1.5"><Edit2 size={13} /> Edit in Agent Management</button>
        <button onClick={onClose} className="btn-primary">Close</button>
      </>}>
      <div className="space-y-5">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Personal Information</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Full Name" value={agent.name as string} />
            <Field label="NIC Number" value={(agent.nic as string) || '—'} />
            <Field label="Date of Birth" value={agent.date_of_birth ? String(agent.date_of_birth).slice(0, 10) : '—'} />
            <Field label="ETF Number" value={(agent.etf_number as string) || '—'} />
            <Field label="EPF Number" value={(agent.epf_number as string) || '—'} />
            <Field label="Mobile" value={(agent.phone as string) || '—'} />
            <Field label="Email" value={(agent.email as string) || '—'} />
            <Field label="Missing Documents" value={(agent.missing_documents as string) || 'None'} />
          </div>
          {agent.notes ? <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>{agent.notes as string}</p> : null}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Role &amp; Location</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
            <Field label="Agent / Employee ID" value={agent.code as string} mono />
            <Field label="Position" value={(agent.position as string) || '—'} />
            <Field label="Branch" value={(agent.branch_name as string) || '—'} />
            <Field label="Region" value={(agent.region_name as string) || '—'} />
            <Field label="Zone" value={(agent.zone_name as string) || '—'} />
            <Field label="Appointment Date" value={agent.appointment_date ? String(agent.appointment_date).slice(0, 10) : '—'} />
            <div>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>Status</p>
              <span className={agent.status === 'active' ? 'badge-green' : 'badge-gray'}>{agent.status as string}</span>
            </div>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Performance &amp; Earnings</h3>
            <button onClick={onViewFullReport} className="text-xs text-brand-400 hover:underline">View Full Report →</button>
          </div>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatCard label="POS Commission (This Month)" value={`Rs.${money(stats.commission_total)}`} icon={Receipt} color="blue" />
              <StatCard label="POS Sales (This Month)" value={`Rs.${money(stats.sales_total)}`} icon={DollarSign} color="green" />
              {smartBuyStats && (
                <>
                  <StatCard label="Smart Buy Commission Earned" value={`Rs.${money(smartBuyStats.commission_earned)}`} icon={Target} color="purple" />
                  <StatCard label="Smart Buy Commission Pending" value={`Rs.${money(smartBuyStats.commission_pending)}`} icon={Target} color="yellow" />
                  <StatCard label="Collected This Month" value={`Rs.${money(smartBuyStats.collected_this_month)}`} icon={DollarSign} color="green" />
                  <StatCard label="Total Collected" value={`Rs.${money(smartBuyStats.total_collected)}`} icon={DollarSign} color="blue" />
                </>
              )}
            </div>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Login / Access</h3>
          {agent.user_id ? (
            linkedUser ? (
              <div className="rounded-lg border p-3 text-sm space-y-1" style={{ borderColor: 'var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span style={{ color: 'var(--text-1)' }}>{linkedUser.name as string}</span>
                  <span className={linkedUser.is_active ? 'badge-green' : 'badge-gray'}>{linkedUser.is_active ? 'Active' : 'Disabled'}</span>
                </div>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                  Role: {(linkedUser.role_name as string) || '—'} · PIN {linkedUser.has_pin ? 'configured' : 'not set'} ·
                  {' '}Last login: {linkedUser.last_login_at ? new Date(String(linkedUser.last_login_at)).toLocaleString() : 'Never'}
                </p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>Login/role/PIN are managed from User List — staff details here always stay in Agent Management.</p>
              </div>
            ) : (
              <p className="text-sm text-slate-500">Loading linked account...</p>
            )
          ) : (
            <div className="rounded-lg border p-3 flex items-center justify-between" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm" style={{ color: 'var(--text-3)' }}>This agent has no login account yet.</p>
              <button onClick={() => setShowCreateLogin(true)} className="btn-primary btn-sm gap-1.5" disabled={agent.status !== 'active'}>
                <KeyRound size={13} /> Create Login
              </button>
            </div>
          )}
          {agent.status !== 'active' && !agent.user_id && (
            <p className="text-xs mt-1.5 text-amber-400">Agent must be Active before a login can be created.</p>
          )}
        </div>
      </div>

      {showCreateLogin && (
        <CreateLoginModal agent={agent} onClose={() => setShowCreateLogin(false)} onDone={() => { setShowCreateLogin(false); onChanged(); load() }} />
      )}
    </Modal>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className={mono ? 'font-mono text-sm' : 'text-sm'} style={{ color: 'var(--text-1)' }}>{value}</p>
    </div>
  )
}

// Create Login for an existing Agent — calls agents:createUserForAgent
// (never admin.users.create), which re-validates everything server-side and
// pulls name/branch straight from the Agent row. The admin only configures
// the login-specific fields here (spec §13): Role, PIN, Active status.
function CreateLoginModal({ agent, onClose, onDone }: { agent: Agent; onClose: () => void; onDone: () => void }) {
  const [roles, setRoles] = useState<Row[]>([])
  const [roleId, setRoleId] = useState('')
  const [pin, setPin] = useState('')
  const [confirmPin, setConfirmPin] = useState('')
  const [isActive, setIsActive] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.admin.roles.list().then((r: { success: boolean; data?: Row[] }) => {
      if (r.success) setRoles((r.data || []).filter(role => role.session_scope === 'agent'))
    }).catch(() => {})
  }, [])

  const save = async () => {
    if (!roleId) { toast.error('Select a role'); return }
    if (!/^\d{4,6}$/.test(pin)) { toast.error('PIN must be 4-6 digits'); return }
    if (pin !== confirmPin) { toast.error('PIN confirmation does not match'); return }
    setSaving(true)
    try {
      const res = await window.api.agents.createUserForAgent(agent.id, { role_id: roleId, pin, is_active: isActive ? 1 : 0 })
      if (res.success) { toast.success('Login created — agent can now sign in with this PIN'); onDone() }
      else toast.error(String(res.error || 'Failed to create login'), { duration: 6000 })
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to create login')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Create Login — ${agent.name}`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Creating...' : 'Create User'}</button></>}>
      <div className="space-y-4">
        <div className="rounded-lg p-3 text-xs" style={{ background: 'var(--bg-soft)', color: 'var(--text-3)' }}>
          Name, Branch, Position, and every other staff detail come from this Agent's record automatically — nothing to re-type here.
        </div>
        {roles.length === 0 ? (
          <p className="text-xs text-amber-400">
            No role with the "Agent" restricted portal scope exists yet. Create one first in Roles &amp; Permissions
            (Restricted Portal Scope = "Agent"), then come back here.
          </p>
        ) : (
          <div>
            <label className="label">Role *</label>
            <select value={roleId} onChange={e => setRoleId(e.target.value)} className="input">
              <option value="">Select role...</option>
              {roles.map(r => <option key={r.id as string} value={r.id as string}>{r.name as string}</option>)}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Login PIN * (4-6 digits)</label>
            <input value={pin} onChange={e => setPin(e.target.value)} className="input font-mono text-xl tracking-widest" maxLength={6} inputMode="numeric" pattern="[0-9]*" placeholder="1234" />
          </div>
          <div>
            <label className="label">Confirm PIN *</label>
            <input value={confirmPin} onChange={e => setConfirmPin(e.target.value)} className="input font-mono text-xl tracking-widest" maxLength={6} inputMode="numeric" pattern="[0-9]*" placeholder="1234" />
          </div>
        </div>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={isActive} onChange={e => setIsActive(e.target.checked)} className="w-4 h-4 accent-brand-500" />
          <span className="text-sm" style={{ color: 'var(--text-2)' }}>Active</span>
        </label>
      </div>
    </Modal>
  )
}

function AgentReportModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10)
  const [dateFrom, setDateFrom] = useState(monthStart)
  const [dateTo, setDateTo] = useState(today)
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.agents.report({ agentId: agent.id, dateFrom, dateTo })
      if (res.success) setData(res.data)
      else toast.error(res.error || 'Failed to load report')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load report')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stats = (data?.stats || {}) as Row
  const target = (data?.targetProgress || {}) as Row
  const products = (data?.products || []) as Row[]
  const invoices = (data?.invoices || []) as Row[]

  const cleanRows = (rows: Row[]) => rows.map(r => Object.fromEntries(Object.entries(r).map(([k, v]) => [k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()), v ?? ''])))

  const metadata = {
    'Agent': `${agent.code} — ${agent.name}`,
    'Date Range': `${dateFrom} to ${dateTo}`,
    'Generated Time': new Date().toLocaleString(),
  }

  const summary: Array<[string, unknown]> = [
    ['Sales Total', stats.sales_total],
    ['Commission Total', stats.commission_total],
    ['Invoices', stats.invoice_count],
    ['Monthly Target', target.target],
    ['Target Achieved', target.achieved],
  ]

  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportPdf({
        filename: `agent-${agent.code}-${today}`,
        title: `Agent Commission Report — ${agent.name}`,
        metadata, summary,
        sections: [
          { title: 'Products Sold', rows: cleanRows(products) },
          { title: 'Invoices', rows: cleanRows(invoices) },
        ],
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'PDF export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'PDF export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportExcel = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportExcel({
        filename: `agent-${agent.code}-${today}`,
        sheets: [
          { name: 'Report Info', rows: Object.entries(metadata).map(([Field, Value]) => ({ Field, Value })) },
          { name: 'Products Sold', rows: cleanRows(products) },
          { name: 'Invoices', rows: cleanRows(invoices) },
        ],
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Excel export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Excel export failed')
    } finally {
      setExporting(false)
    }
  }

  const exportCsv = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportCsvRows({
        filename: `agent-${agent.code}-products-${today}`,
        rows: cleanRows(products),
        metadata,
      })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'CSV export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'CSV export failed')
    } finally {
      setExporting(false)
    }
  }

  const pct = Number(target.pct || 0)

  return (
    <Modal title={`${agent.code} — ${agent.name}`} size="xl" onClose={onClose}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="text-xs font-semibold text-slate-400">
            From
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="input mt-1" />
          </label>
          <label className="text-xs font-semibold text-slate-400">
            To
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="input mt-1" />
          </label>
          <button onClick={load} disabled={loading} className="btn-primary btn-sm">{loading ? 'Loading...' : 'Refresh'}</button>
          <div className="flex gap-2 ml-auto">
            <button onClick={exportCsv} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} disabled={exporting} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF</button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <StatCard label="Sales Total" value={`Rs.${money(stats.sales_total)}`} sub={`${stats.invoice_count || 0} invoices`} icon={DollarSign} color="green" />
          <StatCard label="Commission Earned" value={`Rs.${money(stats.commission_total)}`} icon={Receipt} color="blue" />
          <StatCard label="Monthly Target" value={`Rs.${money(target.target)}`} sub={target.target ? `${pct}% achieved this month` : 'No target set'} icon={Target} color="purple" />
        </div>

        {Number(target.target) > 0 && (
          <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
            <div className="flex justify-between text-xs mb-1.5" style={{ color: 'var(--text-3)' }}>
              <span>This month: Rs.{money(target.achieved)} of Rs.{money(target.target)}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--bg-soft)' }}>
              <div className="h-full rounded-full" style={{ width: `${Math.min(100, pct)}%`, background: pct >= 100 ? '#22c55e' : 'var(--brand-primary)' }} />
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Products Sold</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Product', 'SKU', 'Qty Sold', 'Sales', 'Commission Allocated'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {products.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8 text-slate-500">No product sales in this range</td></tr>
                ) : products.map((p, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{String(p.product_name || '-')}</td>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-3)' }}>{String(p.sku || '-')}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>{String(p.qty_sold || 0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>Rs.{money(p.line_sales_total)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-400">Rs.{money(p.commission_allocated)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Invoices</h3>
          <div className="overflow-x-auto rounded-lg border max-h-48 overflow-y-auto" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Bill No', 'Date', 'Branch', 'Customer', 'Total', 'Commission'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {invoices.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8 text-slate-500">No invoices in this range</td></tr>
                ) : invoices.map((inv, i) => (
                  <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 font-mono text-xs" style={{ color: 'var(--text-1)' }}>{String(inv.invoice_number || '-')}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{inv.created_at ? new Date(String(inv.created_at)).toLocaleDateString() : '-'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{String(inv.branch_name || '-')}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{String(inv.customer_name || 'Walk-in')}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>Rs.{money(inv.total_amount)}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold text-brand-400">Rs.{money(inv.agent_commission_amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}
