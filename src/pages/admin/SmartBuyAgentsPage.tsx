import { useEffect, useState } from 'react'
import NumberInput from '@/components/shared/NumberInput'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import MemberPaymentHistoryModal from '@/components/shared/MemberPaymentHistoryModal'
import { Plus, Search, Users, Coins, TrendingUp, Wallet, ArrowLeft, Eye, KeyRound, Check, CircleDollarSign, Download, FileSpreadsheet, FileText, Edit2, Trash2, X, Clock, Ban } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const COMMISSION_STATUS_META: Record<string, { label: string; badge: string }> = {
  pending_manager_approval: { label: 'Pending Manager Approval', badge: 'badge-yellow' },
  pending_admin_approval:   { label: 'Pending Admin Approval', badge: 'badge-yellow' },
  approved_for_payment:     { label: 'Approved for Payment', badge: 'badge-blue' },
  paid:                     { label: 'Paid', badge: 'badge-green' },
  rejected:                 { label: 'Rejected', badge: 'badge-red' },
  cancelled:                { label: 'Cancelled', badge: 'badge-gray' },
}

export default function SmartBuyAgentsPage() {
  const [agents, setAgents] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [exporting, setExporting] = useState(false)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [viewingId, setViewingId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [a, b] = await Promise.all([
        window.api.chits.agents.report({}),
        window.api.admin.branches.list(),
      ])
      if (a.success) setAgents(a.data as Row[])
      else toast.error(a.error || 'Failed to load agents')
      if (b.success) setBranches(b.data as Row[])
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load agents')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleStatus = async (a: Row, e: React.MouseEvent) => {
    e.stopPropagation()
    const nextStatus = a.status === 'active' ? 'inactive' : 'active'
    try {
      const res = await window.api.agents.update(a.id as string, { status: nextStatus })
      if (res.success) { toast.success(`Agent marked ${nextStatus}`); load() }
      else toast.error(String(res.error || 'Failed to update status'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update status')
    }
  }

  const approveAgent = async (a: Row, e: React.MouseEvent) => {
    e.stopPropagation()
    try {
      const res = await window.api.agents.approve(a.id as string)
      if (res.success) { toast.success('Agent approved'); load() }
      else toast.error(String(res.error || 'Failed to approve agent'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to approve agent')
    }
  }

  const deleteAgent = async (a: Row, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Delete agent "${a.name}"? This only works if the agent has no invoices, schemes, or commission history.`)) return
    try {
      const res = await window.api.agents.delete(a.id as string)
      if (res.success) { toast.success('Agent deleted'); load() }
      else toast.error(String(res.error || 'Failed to delete agent'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to delete agent')
    }
  }

  const filtered = agents.filter(a => {
    const q = search.trim().toLowerCase()
    if (q && !String(a.code || '').toLowerCase().includes(q) && !String(a.name || '').toLowerCase().includes(q)) return false
    if (branchFilter && a.branch_id !== branchFilter) return false
    return true
  })

  const exportRows = () => filtered.map(a => ({
    Code: a.code, Name: a.name, Branch: a.branch_name, Status: a.status,
    Members: a.members_assigned, 'This Month': `Rs.${money(a.collected_this_month)}`,
    'Commission Earned': `Rs.${money(a.commission_earned)}`, 'Cash Balance': `Rs.${money(a.cash_balance)}`,
  }))
  const exportMeta = { Report: 'Smart Buy Agents', Branch: branches.find(b => b.id === branchFilter)?.name as string || 'All Branches', Generated: new Date().toLocaleString() }
  const filename = `smartbuy-agents-${new Date().toISOString().slice(0, 10)}`
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
      const res = await window.api.reports.exportExcel({ filename, sheets: [{ name: 'Agents', rows: exportRows() }] })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Export failed')
    } finally { setExporting(false) }
  }
  const exportPdf = async () => {
    setExporting(true)
    try {
      const res = await window.api.reports.exportPdf({ filename, title: 'Smart Buy Agents', metadata: exportMeta, sections: [{ title: 'Agents', rows: exportRows() }] })
      if (res && !res.success && !res.cancelled) toast.error(res.error || 'Export failed')
    } finally { setExporting(false) }
  }

  if (viewingId) {
    return <SmartBuyAgentDetail agentId={viewingId} onBack={() => { setViewingId(null); load() }} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy Agents" subtitle={`${filtered.length} agent(s)`}
        actions={
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><Download size={13} /> CSV</button>
            <button onClick={exportExcel} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><FileSpreadsheet size={13} /> Excel</button>
            <button onClick={exportPdf} disabled={exporting || filtered.length === 0} className="btn-secondary btn-sm gap-1.5"><FileText size={13} /> PDF</button>
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add Agent
            </button>
          </div>
        }
      />

      <div className="flex flex-wrap gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..." className="input pl-8 text-sm" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input text-sm w-auto">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading...</p>
        ) : filtered.length === 0 ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>{agents.length === 0 ? 'No agents yet — add one to get started' : 'No agents match your search'}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filtered.map(a => {
              const balance = Number(a.cash_balance || 0)
              return (
                <div key={a.id as string} onClick={() => setViewingId(a.id as string)}
                  className="rounded-xl border p-4 cursor-pointer transition-colors hover:border-[var(--brand-primary)]"
                  style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{a.name as string}</p>
                      <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{a.code as string} · {(a.branch_name as string) || 'No branch'}</p>
                    </div>
                    <div className="flex items-center gap-1">
                      {a.status === 'pending' ? (
                        <button
                          onClick={e => approveAgent(a, e)}
                          className="badge-yellow"
                          title="Approve this agent to make them active"
                        >
                          Pending — Approve
                        </button>
                      ) : (
                        <button
                          onClick={e => toggleStatus(a, e)}
                          className={a.status === 'active' ? 'badge-green' : 'badge-gray'}
                          title="Click to toggle active/inactive"
                        >
                          {a.status as string}
                        </button>
                      )}
                      <button onClick={e => { e.stopPropagation(); setEditing(a); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                      <button onClick={e => deleteAgent(a, e)} className="btn-ghost btn-sm p-1.5 hover:text-red-500" title="Delete"><Trash2 size={13} /></button>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                      <p className="flex items-center gap-1" style={{ color: 'var(--text-3)' }}><Users size={11} /> Members</p>
                      <p className="font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>{Number(a.members_assigned || 0)}</p>
                    </div>
                    <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                      <p className="flex items-center gap-1" style={{ color: 'var(--text-3)' }}><Coins size={11} /> This Month</p>
                      <p className="font-semibold mt-0.5" style={{ color: 'var(--text-1)' }}>Rs.{money(a.collected_this_month)}</p>
                    </div>
                    <div className="rounded-lg p-2" style={{ background: 'var(--bg-soft)' }}>
                      <p className="flex items-center gap-1" style={{ color: 'var(--text-3)' }}><TrendingUp size={11} /> Commission</p>
                      <p className="font-semibold mt-0.5 text-brand-400">Rs.{money(a.commission_earned)}</p>
                    </div>
                    <div className="rounded-lg p-2" style={{ background: balance > 0 ? 'color-mix(in srgb, #f59e0b 12%, transparent)' : 'var(--bg-soft)' }}>
                      <p className="flex items-center gap-1" style={{ color: 'var(--text-3)' }}><Wallet size={11} /> Cash Balance</p>
                      <p className="font-semibold mt-0.5" style={{ color: balance > 0 ? '#f59e0b' : 'var(--text-1)' }}>Rs.{money(balance)}</p>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {showForm && (
        <AgentFormModal agent={editing} branches={branches} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
    </div>
  )
}

function AgentFormModal({ agent, branches, onClose, onSave }: { agent: Row | null; branches: Row[]; onClose: () => void; onSave: () => void }) {
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
  })
  const [saving, setSaving] = useState(false)
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (!form.code.trim()) { toast.error('Agent code is required'); return }
    if (!form.name.trim()) { toast.error('Agent name is required'); return }
    setSaving(true)
    try {
      const res = agent
        ? await window.api.agents.update(agent.id as string, form)
        : await window.api.agents.create(form)
      if (res.success) { toast.success(agent ? 'Agent updated' : 'Agent created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={agent ? 'Edit Smart Buy Agent' : 'Add Smart Buy Agent'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Agent Code *</label><input value={form.code} onChange={f('code')} className="input" placeholder="AG-101" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label><input value={form.name} onChange={f('name')} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.nic} onChange={f('nic')} className="input" /></div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Branch</label>
            <select value={form.branch_id} onChange={f('branch_id')} className="input">
              <option value="">— Select —</option>
              {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Default Commission %</label><NumberInput value={form.default_commission_pct} onChange={f('default_commission_pct')} className="input" min={0} max={100} step="0.01" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Monthly Target (Rs.)</label><NumberInput value={form.monthly_target} onChange={f('monthly_target')} className="input" min={0} /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
          <select value={form.status} onChange={f('status')} className="input">
            <option value="active">Active</option>
            <option value="pending">Pending Approval</option>
            <option value="inactive">Inactive</option>
          </select>
          {form.status === 'pending' && (
            <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
              Saved but not yet live — use the Approve action on the agent card to activate.
            </p>
          )}
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}

function SmartBuyAgentDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const { user } = useAuthStore()
  const isSuperAdmin = Boolean(((user?.role as unknown as Row)?.permissions as Row)?.all)
  const [data, setData] = useState<{ agent: Row; members: Row[]; stats: Row; remittances: Row[]; commissionLedger: Row[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRemit, setShowRemit] = useState(false)
  const [showLinkLogin, setShowLinkLogin] = useState(false)
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null)
  const [approvalModal, setApprovalModal] = useState<{ id: string; kind: 'approve' | 'reject' | 'cancel' } | null>(null)
  const [approvalHistoryId, setApprovalHistoryId] = useState<string | null>(null)
  const [statementFilters, setStatementFilters] = useState({ dateFrom: '', dateTo: '', status: '' })
  const [statementLoading, setStatementLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.chits.agents.detail(agentId)
      if (res.success) setData(res.data)
      else toast.error(res.error || 'Failed to load agent')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load agent')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [agentId]) // eslint-disable-line react-hooks/exhaustive-deps

  if (loading || !data) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>Loading...</div>
  }

  const { agent, members, stats, remittances, commissionLedger } = data
  const balance = Number(stats.cash_balance || 0)

  // Goes through commissions:payouts:create (not the bare markPaid) so every
  // "mark paid" click leaves a real commission_payouts record — amount,
  // method, who paid it, when — instead of just flipping a status flag.
  const markCommissionPaid = async (id: string) => {
    try {
      const res = await window.api.commissions.payouts.create({
        agentId: agent.id as string, ledgerIds: [id], method: 'cash',
      })
      if (res.success) { toast.success('Marked as paid'); load() }
      else toast.error(String(res.error || 'Failed to mark paid'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to mark paid')
    }
  }

  const submitApprovalAction = async (remarks: string) => {
    if (!approvalModal) return
    const { id, kind } = approvalModal
    try {
      const res = kind === 'approve'
        ? await window.api.commissions.ledger.approve(id, remarks || undefined)
        : kind === 'reject'
          ? await window.api.commissions.ledger.reject(id, remarks)
          : await window.api.commissions.ledger.cancel(id, remarks || undefined)
      if (res.success) {
        toast.success(kind === 'approve' ? 'Commission approved' : kind === 'reject' ? 'Commission rejected' : 'Commission cancelled')
        setApprovalModal(null)
        load()
      } else toast.error(String(res.error || 'Action failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Action failed')
    }
  }

  const downloadStatement = async () => {
    setStatementLoading(true)
    try {
      const res = await window.api.commissions.statement.generate(agent.id as string, {
        dateFrom: statementFilters.dateFrom || undefined,
        dateTo: statementFilters.dateTo || undefined,
        status: statementFilters.status || undefined,
      })
      if (!res.success) { toast.error(res.error || 'Failed to generate statement'); return }
      const { agent: a, summary, transactions } = res.data as { agent: Row; summary: Row; transactions: Row[] }
      const pdfRes = await window.api.reports.exportPdf({
        filename: `commission-statement-${a.code}-${new Date().toISOString().slice(0, 10)}`,
        title: `Commission Statement — ${a.name as string}`,
        metadata: {
          'Agent Code': a.code, 'Branch': a.branch_name, 'SmartBuy Manager': a.smartbuy_manager_name || 'Unassigned',
          'Period': statementFilters.dateFrom || statementFilters.dateTo
            ? `${statementFilters.dateFrom || '—'} to ${statementFilters.dateTo || '—'}` : 'All time',
        },
        summary: [
          ['Total Sales', money(summary.total_sales)], ['Total Schemes', summary.total_schemes],
          ['Total Products Sold', summary.total_products_sold], ['Commission Generated', money(summary.commission_generated)],
          ['Approved Commission', money(summary.commission_approved)], ['Paid Commission', money(summary.commission_paid)],
          ['Pending Commission', money(summary.commission_pending)],
        ],
        sections: [{
          title: 'Transactions',
          rows: transactions.map(t => ({
            Date: t.date ? new Date(String(t.date)).toLocaleDateString() : '—',
            Product: t.product || '—', Scheme: t.scheme_name || '—', Customer: t.customer_name || '—',
            'Sales Amount': `Rs.${money(t.sales_amount)}`, 'Commission Amount': `Rs.${money(t.commission_amount)}`,
            Status: COMMISSION_STATUS_META[String(t.status)]?.label || String(t.status),
          })),
        }],
      })
      if (pdfRes && !pdfRes.success && !pdfRes.cancelled) toast.error(pdfRes.error || 'PDF export failed')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to generate statement')
    } finally {
      setStatementLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} className="btn-ghost btn-sm p-1.5"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{agent.name as string}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{agent.code as string} · {(agent.branch_name as string) || 'No branch'}</p>
        </div>
        <button onClick={() => setShowLinkLogin(true)} className="btn-secondary btn-sm gap-1.5"><KeyRound size={14} /> {agent.user_id ? 'Login Account' : 'Link Login Account'}</button>
        <button onClick={() => setShowRemit(true)} className="btn-primary btn-sm gap-1.5"><Wallet size={14} /> Record Remittance</button>
      </div>
      {Boolean(agent.user_id) && (
        <p className="px-6 pt-2 text-xs flex-shrink-0" style={{ color: 'var(--text-3)' }}>
          Login linked: <strong>{(agent.linked_user_name as string) || (agent.linked_user_email as string) || (agent.user_id as string)}</strong>
        </p>
      )}

      <div className="grid grid-cols-4 gap-3 px-6 py-4 flex-shrink-0">
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Members Assigned</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{members.length}</p>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Total Collected</p>
          <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Rs.{money(stats.total_collected)}</p>
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Commission Earned</p>
          <p className="text-lg font-bold text-brand-400">Rs.{money(stats.commission_earned)}</p>
          {Number(stats.commission_pending || 0) > 0 && (
            <p className="text-[11px] mt-0.5" style={{ color: '#f59e0b' }}>Rs.{money(stats.commission_pending)} pending approval</p>
          )}
        </div>
        <div className="rounded-lg border p-3" style={{ borderColor: balance > 0 ? '#f59e0b' : 'var(--border)' }}>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Cash Balance (to submit)</p>
          <p className="text-lg font-bold" style={{ color: balance > 0 ? '#f59e0b' : 'var(--text-1)' }}>Rs.{money(balance)}</p>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6 space-y-6">
        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Assigned Members</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Customer', 'Phone', 'Scheme', 'Contributions Paid', 'Status', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {members.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No members assigned to this agent</td></tr>
                ) : members.map(m => (
                  <tr key={m.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 font-medium" style={{ color: 'var(--text-1)' }}>{(m.customer_name as string) || '—'}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-2)' }}>{(m.customer_phone as string) || '—'}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{(m.scheme_name as string) || '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums" style={{ color: 'var(--text-2)' }}>Rs.{money(m.contributions_paid)} / {money(m.chit_value)}</td>
                    <td className="px-3 py-2"><span className={m.status === 'redeemed' ? 'badge-green' : 'badge-blue'}>{m.status as string}</span></td>
                    <td className="px-3 py-2">
                      <button onClick={() => setHistoryMemberId(m.id as string)} className="btn-ghost btn-sm p-1.5" title="Payment History"><Eye size={13} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Remittance History</h3>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Date', 'Amount', 'Method', 'Bank Ref', 'Received By'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {remittances.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No remittances recorded yet</td></tr>
                ) : remittances.map(r => (
                  <tr key={r.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{new Date(String(r.submitted_at)).toLocaleDateString()}</td>
                    <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>Rs.{money(r.amount)}</td>
                    <td className="px-3 py-2 text-xs capitalize" style={{ color: 'var(--text-2)' }}>{(r.method as string)?.replace('_', ' ')}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(r.bank_reference as string) || '—'}</td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(r.received_by_name as string) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Commission Ledger</h3>
            <div className="flex flex-wrap items-center gap-2">
              <input type="date" value={statementFilters.dateFrom}
                onChange={e => setStatementFilters(p => ({ ...p, dateFrom: e.target.value }))}
                className="input text-xs w-auto" title="From date" />
              <input type="date" value={statementFilters.dateTo}
                onChange={e => setStatementFilters(p => ({ ...p, dateTo: e.target.value }))}
                className="input text-xs w-auto" title="To date" />
              <select value={statementFilters.status} onChange={e => setStatementFilters(p => ({ ...p, status: e.target.value }))} className="input text-xs w-auto">
                <option value="">All Statuses</option>
                {Object.entries(COMMISSION_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
              <button onClick={downloadStatement} disabled={statementLoading} className="btn-secondary btn-sm gap-1.5">
                <Download size={13} /> {statementLoading ? 'Generating…' : 'Download Commission Statement'}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Date', 'Scheme', 'Rule', 'Role', 'Base Amount', 'Commission', 'Status', ''].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {commissionLedger.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No commission earned yet</td></tr>
                ) : commissionLedger.map(c => {
                  const isReg = c.registration_agent_id === agentId
                  const isSales = c.sales_agent_id === agentId
                  const amount = (isReg ? Number(c.registration_commission || 0) : 0) + (isSales ? Number(c.sales_commission || 0) : 0)
                  const role = isReg && isSales ? 'Registration + Sales' : isReg ? 'Registration' : 'Sales'
                  const status = String(c.status)
                  const meta = COMMISSION_STATUS_META[status] || { label: status, badge: 'badge-gray' }
                  const canApprove = status === 'pending_manager_approval' || (status === 'pending_admin_approval' && isSuperAdmin)
                  const canCancel = isSuperAdmin && !['paid', 'rejected', 'cancelled'].includes(status)
                  return (
                    <tr key={c.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{c.created_at ? new Date(String(c.created_at)).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{(c.scheme_name as string) || '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(c.rule_name as string) || 'Default rate'} {Boolean(c.is_bonus) && <span className="badge-purple ml-1">Bonus</span>}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{role}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs" style={{ color: 'var(--text-3)' }}>Rs.{money(c.base_amount)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>Rs.{money(amount)}</td>
                      <td className="px-3 py-2">
                        <span className={meta.badge}>{meta.label}</span>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          {canApprove && (
                            <button onClick={() => setApprovalModal({ id: c.id as string, kind: 'approve' })} className="btn-ghost btn-sm p-1.5 text-green-500" title="Approve"><Check size={13} /></button>
                          )}
                          {canApprove && (
                            <button onClick={() => setApprovalModal({ id: c.id as string, kind: 'reject' })} className="btn-ghost btn-sm p-1.5 text-red-500" title="Reject"><X size={13} /></button>
                          )}
                          {status === 'approved_for_payment' && isSuperAdmin && (
                            <button onClick={() => markCommissionPaid(c.id as string)} className="btn-ghost btn-sm p-1.5 text-blue-500" title="Mark Paid"><CircleDollarSign size={13} /></button>
                          )}
                          {canCancel && (
                            <button onClick={() => setApprovalModal({ id: c.id as string, kind: 'cancel' })} className="btn-ghost btn-sm p-1.5 text-slate-500" title="Cancel"><Ban size={13} /></button>
                          )}
                          <button onClick={() => setApprovalHistoryId(c.id as string)} className="btn-ghost btn-sm p-1.5" title="Approval History"><Clock size={13} /></button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showRemit && (
        <RecordRemittanceModal agentId={agentId} balance={balance} onClose={() => setShowRemit(false)} onSaved={() => { setShowRemit(false); load() }} />
      )}
      {showLinkLogin && (
        <LinkLoginModal agent={agent} onClose={() => setShowLinkLogin(false)} onSaved={() => { setShowLinkLogin(false); load() }} />
      )}
      {historyMemberId && (
        <MemberPaymentHistoryModal memberId={historyMemberId} onClose={() => setHistoryMemberId(null)} />
      )}
      {approvalModal && (
        <ApprovalActionModal kind={approvalModal.kind} onClose={() => setApprovalModal(null)} onSubmit={submitApprovalAction} />
      )}
      {approvalHistoryId && (
        <ApprovalHistoryModal commissionId={approvalHistoryId} onClose={() => setApprovalHistoryId(null)} />
      )}
    </div>
  )
}

function ApprovalActionModal({ kind, onClose, onSubmit }: {
  kind: 'approve' | 'reject' | 'cancel'
  onClose: () => void
  onSubmit: (remarks: string) => Promise<void>
}) {
  const [remarks, setRemarks] = useState('')
  const [saving, setSaving] = useState(false)
  const required = kind === 'reject'
  const titles = { approve: 'Approve Commission', reject: 'Reject Commission', cancel: 'Cancel Commission' }
  const submit = async () => {
    if (required && !remarks.trim()) { toast.error('A reason is required'); return }
    setSaving(true)
    try { await onSubmit(remarks.trim()) } finally { setSaving(false) }
  }
  return (
    <Modal title={titles[kind]} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={submit} disabled={saving} className="btn-primary">{saving ? 'Saving…' : titles[kind]}</button></>}>
      <div>
        <label className="block text-xs font-medium text-slate-400 mb-1">
          Remarks {required && <span className="text-red-400">*</span>}
        </label>
        <textarea value={remarks} onChange={e => setRemarks(e.target.value)} className="input h-24 resize-none"
          placeholder={required ? 'Reason for rejection...' : 'Optional remarks...'} />
      </div>
    </Modal>
  )
}

function ApprovalHistoryModal({ commissionId, onClose }: { commissionId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    window.api.commissions.approvalLogs.list(commissionId).then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setRows(res.data as Row[])
      else toast.error(res.error || 'Failed to load history')
    }).finally(() => setLoading(false))
  }, [commissionId])
  return (
    <Modal title="Approval History" onClose={onClose} footer={<button onClick={onClose} className="btn-secondary">Close</button>}>
      {loading ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>No history yet</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id as string} className="border-l-2 pl-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                {(r.action as string).replace(/_/g, ' ')}
                <span className="text-xs ml-2" style={{ color: 'var(--text-3)' }}>
                  {new Date(String(r.created_at)).toLocaleString()}
                </span>
              </p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                By {(r.changed_by_name as string) || 'System'}
                {r.previous_status ? ` · ${String(r.previous_status).replace(/_/g, ' ')} → ${String(r.new_status).replace(/_/g, ' ')}` : ` · ${String(r.new_status).replace(/_/g, ' ')}`}
              </p>
              {Boolean(r.remarks) && <p className="text-xs mt-0.5 italic" style={{ color: 'var(--text-2)' }}>"{r.remarks as string}"</p>}
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

// Links (or unlinks) this agent to a users row so the agent can sign in and
// see only their own Smart Buy data. The user account itself (and its role)
// must already exist — created via the Users page with a role that has the
// 'agent' session scope — this modal only pairs an existing login to the
// agent record.
function LinkLoginModal({ agent, onClose, onSaved }: { agent: Row; onClose: () => void; onSaved: () => void }) {
  const [users, setUsers] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedUserId, setSelectedUserId] = useState(String(agent.user_id || ''))
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    (async () => {
      try {
        const res = await window.api.admin.users.list()
        if (res.success) setUsers(res.data as Row[])
        else toast.error(String(res.error || 'Failed to load users'))
      } catch (err) {
        toast.error((err as Error)?.message || 'Failed to load users')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const save = async (userId: string | null) => {
    setSaving(true)
    try {
      const res = await window.api.agents.linkUser(agent.id as string, userId)
      if (res.success) { toast.success(userId ? 'Login account linked' : 'Login account unlinked'); onSaved() }
      else toast.error(String(res.error || 'Failed to update login link'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update login link')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Link Login Account" onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        {agent.user_id && <button onClick={() => save(null)} disabled={saving} className="btn-secondary">Unlink</button>}
        <button onClick={() => save(selectedUserId || null)} disabled={saving || !selectedUserId} className="btn-primary">{saving ? 'Saving...' : 'Link'}</button>
      </>}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          Pick an existing user account for this agent to sign in with. The account's role must be an "Agent" role (session scope) to land in the restricted Smart Buy portal — create the user first via Users &amp; Roles if it doesn't exist yet.
        </p>
        {loading ? (
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Loading users...</p>
        ) : (
          <select value={selectedUserId} onChange={e => setSelectedUserId(e.target.value)} className="input">
            <option value="">— Select a user —</option>
            {users.map(u => (
              <option key={u.id as string} value={u.id as string}>
                {u.name as string} ({u.email as string}) — {(u.role_name as string) || 'No role'}
              </option>
            ))}
          </select>
        )}
      </div>
    </Modal>
  )
}

function RecordRemittanceModal({ agentId, balance, onClose, onSaved }: { agentId: string; balance: number; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(Math.max(0, balance))
  const [method, setMethod] = useState('cash')
  const [bankReference, setBankReference] = useState('')
  const [submittedAt, setSubmittedAt] = useState(() => new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (amount <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.remittances.record({
        agent_id: agentId, amount, method, bank_reference: bankReference || undefined, submitted_at: submittedAt,
      })
      if (res.success) { toast.success('Remittance recorded'); onSaved() }
      else toast.error(String(res.error || 'Failed to record remittance'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to record remittance')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Record Remittance" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Record'}</button></>}>
      <div className="space-y-3">
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>Current cash-in-hand balance: <strong>Rs.{money(balance)}</strong></p>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Amount (Rs.) *</label><NumberInput value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="input" min={0} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Method</label>
            <select value={method} onChange={e => setMethod(e.target.value)} className="input">
              <option value="cash">Cash (Office)</option>
              <option value="bank_deposit">Bank Deposit</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Date *</label>
            <input type="date" value={submittedAt} onChange={e => setSubmittedAt(e.target.value)} className="input" />
          </div>
        </div>
        {method === 'bank_deposit' && (
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Bank Reference</label><input value={bankReference} onChange={e => setBankReference(e.target.value)} className="input" /></div>
        )}
      </div>
    </Modal>
  )
}
