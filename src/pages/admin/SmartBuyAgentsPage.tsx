import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import MemberPaymentHistoryModal from '@/components/shared/MemberPaymentHistoryModal'
import { Plus, Search, Users, Coins, TrendingUp, Wallet, ArrowLeft, Eye } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SmartBuyAgentsPage() {
  const [agents, setAgents] = useState<Row[]>([])
  const [branches, setBranches] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
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

  const filtered = agents.filter(a => {
    const q = search.trim().toLowerCase()
    if (!q) return true
    return String(a.code || '').toLowerCase().includes(q) || String(a.name || '').toLowerCase().includes(q)
  })

  if (viewingId) {
    return <SmartBuyAgentDetail agentId={viewingId} onBack={() => { setViewingId(null); load() }} />
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy Agents" subtitle={`${filtered.length} agent(s)`}
        actions={
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Agent
          </button>
        }
      />

      <div className="flex gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name or code..." className="input pl-8 text-sm" />
        </div>
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
                    <span className={a.status === 'active' ? 'badge-green' : 'badge-gray'}>{a.status as string}</span>
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
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Default Commission %</label><input type="number" value={form.default_commission_pct} onChange={f('default_commission_pct')} className="input" min={0} max={100} step="0.01" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Monthly Target (Rs.)</label><input type="number" value={form.monthly_target} onChange={f('monthly_target')} className="input" min={0} /></div>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
          <select value={form.status} onChange={f('status')} className="input">
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}

function SmartBuyAgentDetail({ agentId, onBack }: { agentId: string; onBack: () => void }) {
  const [data, setData] = useState<{ agent: Row; members: Row[]; stats: Row; remittances: Row[] } | null>(null)
  const [loading, setLoading] = useState(true)
  const [showRemit, setShowRemit] = useState(false)
  const [historyMemberId, setHistoryMemberId] = useState<string | null>(null)

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

  const { agent, members, stats, remittances } = data
  const balance = Number(stats.cash_balance || 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-3 px-6 py-4 flex-shrink-0" style={{ borderBottom: '1px solid var(--border)' }}>
        <button onClick={onBack} className="btn-ghost btn-sm p-1.5"><ArrowLeft size={16} /></button>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{agent.name as string}</h1>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>{agent.code as string} · {(agent.branch_name as string) || 'No branch'}</p>
        </div>
        <button onClick={() => setShowRemit(true)} className="btn-primary btn-sm gap-1.5"><Wallet size={14} /> Record Remittance</button>
      </div>

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
      </div>

      {showRemit && (
        <RecordRemittanceModal agentId={agentId} balance={balance} onClose={() => setShowRemit(false)} onSaved={() => { setShowRemit(false); load() }} />
      )}
      {historyMemberId && (
        <MemberPaymentHistoryModal memberId={historyMemberId} onClose={() => setHistoryMemberId(null)} />
      )}
    </div>
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
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Amount (Rs.) *</label><input type="number" value={amount} onChange={e => setAmount(parseFloat(e.target.value) || 0)} className="input" min={0} /></div>
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
