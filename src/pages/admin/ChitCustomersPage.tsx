import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Search, Eye, Coins } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

export default function ChitCustomersPage() {
  const [customers, setCustomers] = useState<Row[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [viewing, setViewing] = useState<Row | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.chits.customersList({})
      if (res.success) setCustomers(res.data as Row[])
      else toast.error(res.error || 'Failed to load chit fund customers')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load chit fund customers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = customers.filter(c => {
    const q = search.toLowerCase().trim()
    if (!q) return true
    return [c.name, c.phone, c.nic].some(v => String(v || '').toLowerCase().includes(q))
  })

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Chit Fund Customers" subtitle={`${filtered.length} customer(s) enrolled in a chit scheme`}
        actions={
          <button onClick={() => setShowForm(true)} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Chit Customer
          </button>
        }
      />

      <div className="flex gap-3 px-6 py-3 border-b border-slate-800 flex-shrink-0">
        <div className="relative flex-1 max-w-sm">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, phone, NIC..." className="input pl-8 text-sm" />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Customer', 'Phone', 'Schemes', 'Product(s)', 'Branch(es)', 'Agent(s)', 'Contributions Paid', 'Outstanding Due', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">No chit fund customers yet</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id as string} className="table-row">
                <td className="table-cell">
                  <div>
                    <p className="font-medium">{c.name as string}</p>
                    {Boolean(c.nic) && <p className="text-xs text-slate-500 font-mono">{c.nic as string}</p>}
                  </div>
                </td>
                <td className="table-cell text-slate-400">{(c.phone as string) || '—'}</td>
                <td className="table-cell">
                  <span className="badge-blue">{c.scheme_count as number} scheme{(c.scheme_count as number) === 1 ? '' : 's'}</span>
                  <p className="text-xs text-slate-500 mt-0.5 max-w-[14rem] truncate" title={c.scheme_names as string}>{(c.scheme_names as string) || '—'}</p>
                </td>
                <td className="table-cell text-slate-400 text-xs max-w-[10rem] truncate" title={c.product_names as string}>{(c.product_names as string) || '—'}</td>
                <td className="table-cell text-slate-400 text-xs max-w-[10rem] truncate" title={c.branch_names as string}>{(c.branch_names as string) || '—'}</td>
                <td className="table-cell text-slate-400 text-xs max-w-[10rem] truncate" title={c.agent_names as string}>{(c.agent_names as string) || '—'}</td>
                <td className="table-cell font-semibold text-brand-400">Rs.{Number(c.total_contributions_paid).toLocaleString()}</td>
                <td className="table-cell">
                  <span className={(c.outstanding_due as number) > 0 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                    Rs.{Number(c.outstanding_due).toLocaleString()}
                  </span>
                </td>
                <td className="table-cell">
                  <button onClick={() => setViewing(c)} className="btn-ghost btn-sm p-1.5"><Eye size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <AddChitCustomerModal onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
      {viewing && (
        <ChitCustomerDetail customer={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  )
}

function AddChitCustomerModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', email: '', nic: '', address: '' })
  const [schemes, setSchemes] = useState<Row[]>([])
  const [agents, setAgents] = useState<Row[]>([])
  const [schemeId, setSchemeId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.chits.list({ status: 'active' }),
      window.api.agents.list({}),
    ]).then(([schemesRes, agentsRes]: [{ success: boolean; data?: Row[]; error?: string }, { success: boolean; data?: Row[]; error?: string }]) => {
      if (schemesRes.success) {
        const open = (schemesRes.data || []).filter(s => Number(s.members_enrolled ?? 0) < Number(s.member_count ?? 0))
        setSchemes(open)
      } else {
        toast.error(schemesRes.error || 'Failed to load chit schemes')
      }
      if (agentsRes.success) setAgents(agentsRes.data || [])
    }).catch(() => toast.error('Failed to load chit schemes')).finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const scheme = schemes.find(s => s.id === schemeId)
    if (scheme) setAgentId((scheme.agent_id as string) || '')
  }, [schemeId])

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Customer name is required'); return }
    if (!form.phone.trim()) { toast.error('Phone is required'); return }
    if (!schemeId) { toast.error('Select a chit scheme'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.members.add(schemeId, {
        customer_name: form.name.trim(), customer_phone: form.phone.trim(),
        customer_email: form.email.trim() || undefined, customer_nic: form.nic.trim() || undefined,
        customer_address: form.address.trim() || undefined, agent_id: agentId || undefined,
      })
      if (res.success) { toast.success('Chit fund customer added'); onSave() }
      else toast.error(res.error || 'Failed to add customer')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to add customer')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title="Add Chit Fund Customer" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving || loading} className="btn-primary">{saving ? 'Saving...' : 'Add Customer'}</button></>}>
      <div className="space-y-4">
        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Customer Details</h3>
          <div className="space-y-3">
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label><input value={form.name} onChange={f('name')} className="input" /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone *</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
              <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.nic} onChange={f('nic')} className="input" /></div>
            </div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Address</label><input value={form.address} onChange={f('address')} className="input" /></div>
          </div>
          <p className="text-xs text-slate-500 mt-2">If this phone or NIC already belongs to an existing customer, that record will be reused instead of creating a duplicate.</p>
        </div>

        <div>
          <h3 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Chit Fund Enrollment</h3>
          {loading ? (
            <p className="text-sm text-slate-500">Loading schemes...</p>
          ) : schemes.length === 0 ? (
            <p className="text-sm text-slate-500">No open chit schemes with available slots right now.</p>
          ) : (
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Chit Scheme *</label>
                <select value={schemeId} onChange={e => setSchemeId(e.target.value)} className="input">
                  <option value="">— Select a scheme —</option>
                  {schemes.map(s => (
                    <option key={s.id as string} value={s.id as string}>
                      {(s.scheme_number as string)} — {(s.name as string)} ({(s.members_enrolled as number) ?? 0}/{(s.member_count as number) ?? 0})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Agent (optional — defaults to scheme's agent)</label>
                <select value={agentId} onChange={e => setAgentId(e.target.value)} className="input">
                  <option value="">— Use scheme default —</option>
                  {agents.map(a => <option key={a.id as string} value={a.id as string}>{(a.code as string)} — {(a.name as string)}</option>)}
                </select>
              </div>
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ChitCustomerDetail({ customer, onClose }: { customer: Row; onClose: () => void }) {
  const [memberships, setMemberships] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.customers.chitMemberships(customer.id as string).then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setMemberships(res.data || [])
      else toast.error(res.error || 'Failed to load chit memberships')
    }).catch(() => toast.error('Failed to load chit memberships')).finally(() => setLoading(false))
  }, [customer.id])

  return (
    <Modal title={`${customer.name as string} — Chit Fund Details`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="card"><p className="text-xs text-slate-400">Schemes</p><p className="text-lg font-bold">{memberships.length}</p></div>
          <div className="card"><p className="text-xs text-slate-400">Total Paid</p><p className="text-lg font-bold text-brand-400">Rs.{memberships.reduce((sum, m) => sum + Number(m.contributions_paid || 0), 0).toLocaleString()}</p></div>
          <div className="card"><p className="text-xs text-slate-400">Outstanding Due</p><p className="text-lg font-bold text-red-400">Rs.{Number(customer.outstanding_due).toLocaleString()}</p></div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5"><Coins size={14} /> Chit Memberships</h3>
          {loading ? (
            <p className="text-sm text-slate-500">Loading...</p>
          ) : memberships.length === 0 ? (
            <p className="text-sm text-slate-500">No memberships found.</p>
          ) : (
            <div className="space-y-2">
              {memberships.map(cm => (
                <div key={cm.id as string} className="px-3 py-2 rounded-lg" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{cm.scheme_number as string} — {cm.scheme_name as string}</p>
                    <span className={`badge-${cm.status === 'redeemed' ? 'green' : cm.status === 'withdrawn' ? 'gray' : 'blue'} text-xs`}>{cm.status as string}</span>
                  </div>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    {(cm.product_name as string) || 'No product set'} · {(cm.branch_name as string) || 'No branch'} · Agent: {(cm.agent_name as string) || '—'}
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    Join order #{cm.join_order as number} · Paid Rs.{Number(cm.contributions_paid).toLocaleString()} of Rs.{Number(cm.chit_value).toLocaleString()}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
