import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import type { Customer } from '@/types'
import { Plus, Search, Edit2, Eye, Upload, FileDown, Coins } from 'lucide-react'
import toast from 'react-hot-toast'
import { validateCustomer } from '@/lib/validateCustomer'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [search, setSearch]       = useState('')
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<Customer | null>(null)
  const [viewing, setViewing]     = useState<Customer | null>(null)
  const [enrolling, setEnrolling] = useState<Customer | null>(null)
  const [loading, setLoading]     = useState(true)
  const [importing, setImporting] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.customers.list({})
      if (res.success) setCustomers(res.data as Customer[])
      else toast.error(res.error || 'Failed to load customers')
    } catch {
      toast.error('Failed to load customers')
    } finally {
      setLoading(false)
    }
  }

  const downloadTemplate = async () => {
    try {
      const res = await window.api.customers.downloadTemplate()
      if (res.success) toast.success('Template saved')
      else if (!res.cancelled) toast.error(res.error || 'Failed to save template')
    } catch {
      toast.error('Failed to save template')
    }
  }

  const bulkImport = async () => {
    setImporting(true)
    try {
      const res = await window.api.customers.importExcel()
      if (res.cancelled) return
      if (!res.success) { toast.error(res.error || 'Import failed'); return }
      if (res.imported) toast.success(`Imported ${res.imported} customer(s)`)
      if (res.skipped) {
        toast.error(`Skipped ${res.skipped} row(s)${res.errors?.[0] ? ` — e.g. ${res.errors[0]}` : ''}`, { duration: 6000 })
      }
      if (res.imported) load()
    } catch {
      toast.error('Import failed')
    } finally {
      setImporting(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = customers.filter(c =>
    !search ||
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    (c.phone || '').includes(search) ||
    (c.nic || '').includes(search)
  )

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Customers" subtitle={`${filtered.length} customers`}
        actions={
          <div className="flex gap-2">
            <button onClick={downloadTemplate} className="btn-secondary btn-sm gap-1.5">
              <FileDown size={14} /> Template
            </button>
            <button onClick={bulkImport} disabled={importing} className="btn-secondary btn-sm gap-1.5">
              <Upload size={14} /> {importing ? 'Importing...' : 'Bulk Import'}
            </button>
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add Customer
            </button>
          </div>
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
              {['Customer', 'Phone', 'NIC', 'Outstanding Due', 'Loyalty Pts', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={6} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : filtered.map(c => (
              <tr key={c.id} className="table-row">
                <td className="table-cell">
                  <div>
                    <p className="font-medium">{c.name}</p>
                    {c.email && <p className="text-xs text-slate-500">{c.email}</p>}
                  </div>
                </td>
                <td className="table-cell text-slate-400">{c.phone || '—'}</td>
                <td className="table-cell text-slate-400 font-mono text-xs">{c.nic || '—'}</td>
                <td className="table-cell">
                  <span className={c.outstanding_due > 0 ? 'text-red-400 font-semibold' : 'text-slate-400'}>
                    Rs.{c.outstanding_due.toLocaleString()}
                  </span>
                </td>
                <td className="table-cell">
                  <span className="badge-blue">{c.loyalty_points} pts</span>
                </td>
                <td className="table-cell">
                  <div className="flex gap-1">
                    <button onClick={() => setViewing(c)} className="btn-ghost btn-sm p-1.5"><Eye size={13} /></button>
                    <button onClick={() => { setEditing(c); setShowForm(true) }} className="btn-ghost btn-sm p-1.5"><Edit2 size={13} /></button>
                    <button onClick={() => setEnrolling(c)} className="btn-ghost btn-sm p-1.5" title="Add to Chit Scheme"><Coins size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showForm && (
        <CustomerForm customer={editing} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
      {viewing && (
        <CustomerHistory customer={viewing} onClose={() => setViewing(null)} />
      )}
      {enrolling && (
        <EnrollInChitModal customer={enrolling} onClose={() => setEnrolling(null)} onSave={() => setEnrolling(null)} />
      )}
    </div>
  )
}

function EnrollInChitModal({ customer, onClose, onSave }: { customer: Customer; onClose: () => void; onSave: () => void }) {
  const [schemes, setSchemes] = useState<Record<string, unknown>[]>([])
  const [agents, setAgents] = useState<Record<string, unknown>[]>([])
  const [schemeId, setSchemeId] = useState('')
  const [agentId, setAgentId] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    Promise.all([
      window.api.chits.list({ status: 'active' }),
      window.api.agents.list({}),
    ]).then(([schemesRes, agentsRes]: [{ success: boolean; data?: Record<string, unknown>[]; error?: string }, { success: boolean; data?: Record<string, unknown>[]; error?: string }]) => {
      if (schemesRes.success) {
        const open = (schemesRes.data || []).filter(s => Number(s.members_enrolled ?? 0) < Number(s.member_count ?? 0))
        setSchemes(open)
      } else {
        toast.error(schemesRes.error || 'Failed to load chit schemes')
      }
      if (agentsRes.success) setAgents(agentsRes.data || [])
    }).catch(() => toast.error('Failed to load chit schemes')).finally(() => setLoading(false))
  }, [])

  const scheme = schemes.find(s => s.id === schemeId)
  useEffect(() => { if (scheme) setAgentId((scheme.agent_id as string) || '') }, [schemeId])

  const save = async () => {
    if (!schemeId) { toast.error('Select a chit scheme'); return }
    setSaving(true)
    try {
      const res = await window.api.chits.members.add(schemeId, { customer_id: customer.id, agent_id: agentId || undefined })
      if (res.success) { toast.success('Customer added to chit scheme'); onSave() }
      else toast.error(res.error || 'Failed to add to scheme')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to add to scheme')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Add "${customer.name}" to a Chit Scheme`} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving || loading} className="btn-primary">{saving ? 'Adding...' : 'Add to Scheme'}</button></>}>
      <div className="space-y-3">
        {loading ? (
          <p className="text-sm text-slate-500">Loading schemes...</p>
        ) : schemes.length === 0 ? (
          <p className="text-sm text-slate-500">No open chit schemes with available slots right now.</p>
        ) : (
          <>
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
          </>
        )}
      </div>
    </Modal>
  )
}

function CustomerForm({ customer, onClose, onSave }: { customer: Customer | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({ name: customer?.name || '', phone: customer?.phone || '', email: customer?.email || '', nic: customer?.nic || '', address: customer?.address || '', notes: customer?.notes || '', credit_limit: customer?.credit_limit || 0 })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const err = validateCustomer(form)
    if (err) { toast.error(err); return }
    setSaving(true)
    try {
      if (customer) {
        const res = await window.api.customers.update(customer.id, form)
        if (res.success) { toast.success('Customer updated'); onSave() }
        else toast.error(res.error || 'Failed to update customer')
      } else {
        const res = await window.api.customers.create(form)
        if (res.success) { toast.success('Customer created'); onSave() }
        else toast.error(res.error || 'Failed to create customer')
      }
    } catch {
      toast.error('Failed to save customer')
    } finally {
      setSaving(false)
    }
  }

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  return (
    <Modal title={customer ? 'Edit Customer' : 'Add Customer'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Full Name *</label><input value={form.name} onChange={f('name')} className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Mobile Number *</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">NIC</label><input value={form.nic} onChange={f('nic')} className="input" /></div>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Address *</label><input value={form.address} onChange={f('address')} className="input" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Credit Limit (Rs.)</label><input type="number" value={form.credit_limit} onChange={f('credit_limit')} className="input" /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={f('notes')} className="input h-20 resize-none" /></div>
      </div>
    </Modal>
  )
}

function CustomerHistory({ customer, onClose }: { customer: Customer; onClose: () => void }) {
  const [invoices, setInvoices] = useState<Record<string,unknown>[]>([])
  const [installments, setInstallments] = useState<Record<string,unknown>[]>([])
  const [chitMemberships, setChitMemberships] = useState<Record<string,unknown>[]>([])

  useEffect(() => {
    window.api.customers.history(customer.id).then((r: any) => {
      if (r.success) setInvoices(r.data as Record<string,unknown>[])
      else toast.error(r.error || 'Failed to load invoice history')
    }).catch(() => toast.error('Failed to load invoice history'))
    window.api.customers.installments(customer.id).then((r: any) => {
      if (r.success) setInstallments(r.data as Record<string,unknown>[])
      else toast.error(r.error || 'Failed to load installments')
    }).catch(() => toast.error('Failed to load installments'))
    window.api.customers.chitMemberships(customer.id).then((r: any) => {
      if (r.success) setChitMemberships(r.data as Record<string,unknown>[])
      else toast.error(r.error || 'Failed to load chit memberships')
    }).catch(() => toast.error('Failed to load chit memberships'))
  }, [customer.id])

  return (
    <Modal title={`${customer.name} — History`} onClose={onClose} size="lg">
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="card"><p className="text-xs text-slate-400">Outstanding</p><p className="text-lg font-bold text-red-400">Rs.{customer.outstanding_due.toLocaleString()}</p></div>
          <div className="card"><p className="text-xs text-slate-400">Loyalty Points</p><p className="text-lg font-bold text-brand-400">{customer.loyalty_points}</p></div>
          <div className="card"><p className="text-xs text-slate-400">Total Invoices</p><p className="text-lg font-bold">{invoices.length}</p></div>
        </div>

        <div>
          <h3 className="text-sm font-semibold mb-2">Recent Invoices</h3>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {invoices.slice(0,10).map(i => (
              <div key={i.id as string} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                <div><p className="text-xs font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{i.invoice_number as string}</p><p className="text-xs" style={{ color: 'var(--text-3)' }}>{new Date(i.created_at as string).toLocaleDateString()}</p></div>
                <span className="text-sm font-bold text-brand-400">Rs.{Number(i.total_amount).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>

        {installments.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Installments</h3>
            <div className="space-y-2">
              {installments.map(inst => (
                <div key={inst.id as string} className="flex items-center justify-between px-3 py-2 rounded-lg" style={{ background: 'var(--bg-page)', border: '1px solid var(--border)' }}>
                  <div><p className="text-xs font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{inst.invoice_number as string}</p><p className="text-xs" style={{ color: 'var(--text-3)' }}>Due: {inst.next_due_date as string}</p></div>
                  <div className="text-right"><p className="text-sm font-bold text-red-400">Rs.{Number(inst.due_amount).toLocaleString()}</p><span className={`badge-${inst.status === 'active' ? 'green' : inst.status === 'overdue' ? 'red' : 'gray'} text-xs`}>{inst.status as string}</span></div>
                </div>
              ))}
            </div>
          </div>
        )}

        {chitMemberships.length > 0 && (
          <div>
            <h3 className="text-sm font-semibold mb-2">Chit Memberships</h3>
            <div className="space-y-2">
              {chitMemberships.map(cm => (
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
          </div>
        )}
      </div>
    </Modal>
  )
}
