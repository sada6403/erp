import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import DeleteConfirmModal from '@/components/shared/DeleteConfirmModal'
import { Plus, Edit2, Trash2, Search, Banknote, History, Power } from 'lucide-react'
import toast from 'react-hot-toast'
import { useDeleteAction } from '@/hooks/useDeleteAction'
import { useAuthStore } from '@/store/authStore'

type Supplier = Record<string, unknown> & { id: string }

export default function SuppliersPage() {
  const { user: currentUser } = useAuthStore()
  const canDelete = Boolean((currentUser?.role?.permissions as Record<string, boolean>)?.all
    || (currentUser?.role?.permissions as Record<string, boolean>)?.inventory)

  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<Supplier | null>(null)
  const [paymentSupplier, setPaymentSupplier] = useState<Supplier | null>(null)
  const [search, setSearch]       = useState('')
  const [activatingId, setActivatingId] = useState<string | null>(null)

  const load = async () => {
    try {
      const res = await window.api.admin.suppliers.list()
      if (res.success) setSuppliers(res.data as Supplier[])
      else toast.error(res.error || 'Failed to load suppliers')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load suppliers')
    }
  }

  useEffect(() => { load() }, [])

  const filtered = suppliers.filter(s =>
    !search ||
    String(s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(s.business_name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(s.mobile_number || s.phone || '').includes(search)
  )

  const totalDue = suppliers.reduce((s, sup) => s + Number(sup.due_balance || 0), 0)

  const del = useDeleteAction<Supplier>(id => window.api.admin.suppliers.delete(id), load)

  const activate = async (supplier: Supplier) => {
    setActivatingId(supplier.id)
    try {
      const supplierApi = window.api.admin.suppliers as {
        restore?: (id: string) => Promise<any>
        update: (id: string, payload: Record<string, unknown>) => Promise<any>
      }
      // During Vite hot reload the renderer can update before Electron's
      // preload is restarted. Fall back to the existing update bridge so
      // reactivation still works in that mixed-version window.
      const res = typeof supplierApi.restore === 'function'
        ? await supplierApi.restore(supplier.id)
        : await supplierApi.update(supplier.id, { is_active: 1 })
      if (!res.success) return toast.error(res.error || 'Failed to activate supplier')
      toast.success(`${String(supplier.name || 'Supplier')} activated`)
      await load()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to activate supplier')
    } finally {
      setActivatingId(null)
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Supplies List" subtitle={`${suppliers.length} suppliers`}
        actions={
          <div className="flex gap-2 items-center">
            {totalDue > 0 && (
              <div className="flex gap-2 text-xs">
                <span className="px-2 py-1 bg-red-900/40 border border-red-700 text-red-300 rounded">Due Balance: Rs.{totalDue.toLocaleString()}</span>
                <span className="px-2 py-1 bg-slate-800 border border-slate-700 text-slate-300 rounded">Total Balance: Rs.{totalDue.toLocaleString()}</span>
              </div>
            )}
            <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14}/> Add Supplier
            </button>
          </div>
        }
      />

      {/* Filters */}
      <div className="flex gap-3 px-6 py-3 border-b border-slate-800">
        <div className="relative max-w-xs flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"/>
          <input className="input pl-8 text-sm" placeholder="Enter Keyword..." value={search} onChange={e => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Image', 'Code', 'Name', 'Business Name', 'Address', 'Mobile', 'Land Line', 'Email', 'Pay Terms', 'Due Balance', 'Balance', 'Status', 'Action'].map(h =>
                <th key={h} className="table-header px-3 py-3 text-left text-xs">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id as string} className="table-row">
                <td className="table-cell px-3">
                  <div className="w-8 h-8 bg-surface-700 rounded border border-slate-700 flex items-center justify-center text-slate-500 text-xs">
                    {String(s.name || '').charAt(0).toUpperCase()}
                  </div>
                </td>
                <td className="table-cell px-3 text-xs text-slate-400 font-mono">{String(s.contact || '—')}</td>
                <td className="table-cell px-3">
                  <p className="font-medium text-sm flex items-center gap-1">
                    <span className="text-brand-400">↑</span> {String(s.name)}
                  </p>
                </td>
                <td className="table-cell px-3 text-sm text-slate-400">{String(s.business_name || '—')}</td>
                <td className="table-cell px-3 text-xs text-slate-400 max-w-[120px] truncate">{String(s.address || '—')}</td>
                <td className="table-cell px-3 text-sm text-slate-400">{String(s.mobile_number || s.phone || '—')}</td>
                <td className="table-cell px-3 text-sm text-slate-400">{String(s.landline || '—')}</td>
                <td className="table-cell px-3 text-xs text-slate-400">{String(s.email || '—')}</td>
                <td className="table-cell px-3 text-xs text-slate-400">{String(s.pay_terms || '—')}</td>
                <td className="table-cell px-3 text-sm text-red-400 font-medium">
                  {Number(s.due_balance || 0) > 0 ? `Rs.${Number(s.due_balance).toLocaleString()}` : '—'}
                </td>
                <td className="table-cell px-3 text-sm font-semibold">Rs.{Number(s.due_balance || 0).toLocaleString()}</td>
                <td className="table-cell px-3">
                  <span className={s.is_active ? 'badge-green' : 'badge-gray'}>{s.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="table-cell px-3">
                  <div className="flex items-center gap-1">
                    {Boolean(s.is_active) && Number(s.due_balance || 0) > 0 && (
                      <button onClick={() => setPaymentSupplier(s)} className="btn-ghost btn-sm p-1.5 text-green-400" title="Pay Due Balance">
                        <Banknote size={14}/>
                      </button>
                    )}
                    {!Boolean(s.is_active) && canDelete && (
                      <button onClick={() => activate(s)} disabled={activatingId === s.id}
                        className="btn-ghost btn-sm p-1.5 text-green-400 disabled:opacity-50" title="Activate Supplier">
                        <Power size={14}/>
                      </button>
                    )}
                    <button onClick={() => setPaymentSupplier(s)} className="btn-ghost btn-sm p-1.5 text-slate-400" title="Payment History">
                      <History size={13}/>
                    </button>
                    <button onClick={() => { setEditing(s); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit">
                      <Edit2 size={13}/>
                    </button>
                    {canDelete && Boolean(s.is_active) && (
                      <button onClick={() => del.requestDelete(s)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Delete">
                        <Trash2 size={13}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td colSpan={13} className="text-center py-16 text-slate-500">No suppliers found</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showForm && (
        <SupplierForm supplier={editing} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}

      {paymentSupplier && (
        <SupplierPaymentModal
          supplier={paymentSupplier}
          onClose={() => setPaymentSupplier(null)}
          onPaid={() => { setPaymentSupplier(null); load() }}
        />
      )}

      {del.target && (
        <DeleteConfirmModal
          title="Delete Supplier"
          itemLabel={String(del.target.name || '')}
          message="This supplier will be deactivated on this device and the cloud database. Existing purchase/expense history referencing it is preserved."
          busy={del.busy}
          onCancel={del.cancel}
          onConfirm={del.confirm}
        />
      )}
    </div>
  )
}

function SupplierPaymentModal({ supplier, onClose, onPaid }: { supplier: Supplier; onClose: () => void; onPaid: () => void }) {
  const today = new Date().toISOString().split('T')[0]
  const due = Number(supplier.due_balance || 0)
  const canPay = Boolean(supplier.is_active) && due > 0
  const [form, setForm] = useState({ amount: due > 0 ? String(due) : '', payment_method: '', payment_date: today, reference_no: '', notes: '' })
  const [payments, setPayments] = useState<Record<string, unknown>[]>([])
  const [loadingHistory, setLoadingHistory] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.admin.suppliers.payments(supplier.id)
      .then((res: any) => {
        if (res.success) setPayments(res.data || [])
        else toast.error(res.error || 'Failed to load payment history')
      })
      .catch((e: any) => toast.error(e?.message || 'Failed to load payment history'))
      .finally(() => setLoadingHistory(false))
  }, [supplier.id])

  const save = async () => {
    const amount = Number(form.amount)
    if (!Number.isFinite(amount) || amount <= 0) return toast.error('Enter a valid payment amount')
    if (amount > due) return toast.error('Payment cannot exceed the due balance')
    if (!form.payment_method) return toast.error('Select a payment method')
    setSaving(true)
    try {
      const res = await window.api.admin.suppliers.payDue(supplier.id, { ...form, amount })
      if (!res.success) return toast.error(res.error || 'Failed to record supplier payment')
      toast.success(`Payment recorded. Remaining due: Rs.${Number(res.data?.balance_after || 0).toLocaleString()}`)
      onPaid()
    } catch (e: any) {
      toast.error(e?.message || 'Failed to record supplier payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={`Supplier Payments — ${String(supplier.name || '')}`} onClose={onClose} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Close</button>
        {canPay && <button onClick={save} disabled={saving} className="btn-primary gap-1.5"><Banknote size={14}/>{saving ? 'Saving...' : 'Record Payment'}</button>}
      </>}>
      <div className="space-y-5">
        <div className="flex items-center justify-between rounded-lg border border-red-800/60 bg-red-950/30 px-4 py-3">
          <span className="text-sm text-slate-300">Current Due Balance</span>
          <span className="text-lg font-bold text-red-400">Rs.{due.toLocaleString()}</span>
        </div>

        {!Boolean(supplier.is_active) && (
          <div className="rounded-lg border border-amber-700/60 bg-amber-950/30 px-4 py-3 text-sm text-amber-300">
            Activate this supplier before recording a due payment.
          </div>
        )}

        {canPay && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Payment Amount *</label>
              <input type="number" min="0.01" max={due} step="0.01" className="input" value={form.amount}
                onChange={e => setForm(p => ({ ...p, amount: e.target.value }))} autoFocus />
            </div>
            <div>
              <label className="label">Payment Method *</label>
              <select className="input" value={form.payment_method} onChange={e => setForm(p => ({ ...p, payment_method: e.target.value }))}>
                <option value="">Select Method</option>
                <option value="cash">Cash</option>
                <option value="card">Card</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="cheque">Cheque</option>
                <option value="other">Other</option>
              </select>
            </div>
            <div>
              <label className="label">Payment Date *</label>
              <input type="date" max={today} className="input" value={form.payment_date}
                onChange={e => setForm(p => ({ ...p, payment_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Reference / Cheque No.</label>
              <input className="input" value={form.reference_no} placeholder="Optional reference"
                onChange={e => setForm(p => ({ ...p, reference_no: e.target.value }))} />
            </div>
            <div className="col-span-2">
              <label className="label">Notes</label>
              <textarea className="input h-16 resize-none" value={form.notes} placeholder="Optional payment notes"
                onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-white mb-2">Payment History</h3>
          <div className="max-h-56 overflow-auto rounded-lg border border-slate-700">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-surface-800">
                <tr>{['Date', 'Amount', 'Method', 'Reference', 'Paid By', 'Balance After'].map(h => <th key={h} className="px-3 py-2 text-left text-slate-400">{h}</th>)}</tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={String(p.id)} className="border-t border-slate-800">
                    <td className="px-3 py-2">{new Date(String(p.payment_date)).toLocaleDateString()}</td>
                    <td className="px-3 py-2 font-semibold text-green-400">Rs.{Number(p.amount || 0).toLocaleString()}</td>
                    <td className="px-3 py-2 capitalize">{String(p.payment_method || '').replace('_', ' ')}</td>
                    <td className="px-3 py-2">{String(p.reference_no || '—')}</td>
                    <td className="px-3 py-2">{String(p.paid_by_name || '—')}</td>
                    <td className="px-3 py-2">Rs.{Number(p.balance_after || 0).toLocaleString()}</td>
                  </tr>
                ))}
                {!loadingHistory && payments.length === 0 && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">No supplier payments recorded</td></tr>}
                {loadingHistory && <tr><td colSpan={6} className="px-3 py-8 text-center text-slate-500">Loading...</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function SupplierForm({ supplier, onClose, onSave }: { supplier: Supplier | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    name:          String(supplier?.name          || ''),
    first_name:    String(supplier?.first_name    || ''),
    last_name:     String(supplier?.last_name     || ''),
    middle_name:   String(supplier?.middle_name   || ''),
    business_name: String(supplier?.business_name || ''),
    mobile_number: String(supplier?.mobile_number || supplier?.phone || ''),
    alt_mobile:    String(supplier?.alt_mobile    || ''),
    landline:      String(supplier?.landline      || ''),
    email:         String(supplier?.email         || ''),
    tax_number:    String(supplier?.tax_number    || ''),
    pay_terms:     String(supplier?.pay_terms     || ''),
    address:       String(supplier?.address       || ''),
    city:          String(supplier?.city          || ''),
    state:         String(supplier?.state         || ''),
    country:       String(supplier?.country       || ''),
    zip_code:      String(supplier?.zip_code      || ''),
    contact:       String(supplier?.contact       || ''),
  })
  const [saving, setSaving] = useState(false)

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!form.name.trim() && !form.first_name.trim()) { toast.error('Name or First Name required'); return }
    setSaving(true)
    const payload = {
      ...form,
      name: form.name.trim() || `${form.first_name} ${form.last_name}`.trim(),
      phone: form.mobile_number,
    }
    try {
      const res = supplier
        ? await window.api.admin.suppliers.update(supplier.id as string, payload)
        : await window.api.admin.suppliers.create(payload)
      if (res.success) {
        toast.success('Saved')
        onSave()
      } else {
        toast.error(res.error || 'Failed to save supplier')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to save supplier')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={supplier ? 'Edit Supplier' : 'Create New Supplier'} onClose={onClose} size="xl"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
      </>}>
      <div className="space-y-5 max-h-[72vh] overflow-y-auto pr-1">

        {/* Supplier Basic Details */}
        <div>
          <h3 className="text-sm font-bold text-white underline mb-3">Supplier Basic Details</h3>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="label">First Name *</label>
              <input value={form.first_name} onChange={f('first_name')} className="input" placeholder="Enter First Name" autoFocus />
            </div>
            <div>
              <label className="label">Middle Name</label>
              <input value={form.middle_name} onChange={f('middle_name')} className="input" placeholder="Enter Middle Name" />
            </div>
            <div>
              <label className="label">Last Name</label>
              <input value={form.last_name} onChange={f('last_name')} className="input" placeholder="Enter Last Name" />
            </div>
            <div>
              <label className="label">Display Name (override)</label>
              <input value={form.name} onChange={f('name')} className="input" placeholder="Auto-filled if blank" />
            </div>
            <div>
              <label className="label">Business Name</label>
              <input value={form.business_name} onChange={f('business_name')} className="input" placeholder="Enter Business Name" />
            </div>
            <div>
              <label className="label">Tax Number</label>
              <input value={form.tax_number} onChange={f('tax_number')} className="input" placeholder="Enter Tax Number" />
            </div>
            <div>
              <label className="label">Mobile Number *</label>
              <input value={form.mobile_number} onChange={f('mobile_number')} className="input" placeholder="Ex: 77XXXXXXX" />
            </div>
            <div>
              <label className="label">Alternate Mobile Number</label>
              <input value={form.alt_mobile} onChange={f('alt_mobile')} className="input" placeholder="Enter Alternate Mobile" />
            </div>
            <div>
              <label className="label">Land Line Number</label>
              <input value={form.landline} onChange={f('landline')} className="input" placeholder="Enter Land Line Number" />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" value={form.email} onChange={f('email')} className="input" placeholder="Enter Email" />
            </div>
            <div>
              <label className="label">Pay Terms</label>
              <input value={form.pay_terms} onChange={f('pay_terms')} className="input" placeholder="e.g. 30 Days, Month..." />
            </div>
            <div>
              <label className="label">Reference Code</label>
              <input value={form.contact} onChange={f('contact')} className="input" placeholder="Enter Code" />
            </div>
          </div>
        </div>

        {/* Address */}
        <div>
          <h3 className="text-sm font-bold text-white underline mb-3">Address</h3>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-3">
              <label className="label">Address Line 1</label>
              <input value={form.address} onChange={f('address')} className="input" placeholder="Enter Address Line 1" />
            </div>
            <div>
              <label className="label">City</label>
              <input value={form.city} onChange={f('city')} className="input" placeholder="Enter City" />
            </div>
            <div>
              <label className="label">State</label>
              <input value={form.state} onChange={f('state')} className="input" placeholder="Enter State" />
            </div>
            <div>
              <label className="label">Zip Code</label>
              <input value={form.zip_code} onChange={f('zip_code')} className="input" placeholder="Enter Zip Code" />
            </div>
            <div>
              <label className="label">Country</label>
              <input value={form.country} onChange={f('country')} className="input" placeholder="Enter Country" />
            </div>
          </div>
        </div>

      </div>
    </Modal>
  )
}
