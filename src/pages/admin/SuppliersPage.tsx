import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, Search } from 'lucide-react'
import toast from 'react-hot-toast'

type Supplier = Record<string, unknown>

export default function SuppliersPage() {
  const [suppliers, setSuppliers] = useState<Supplier[]>([])
  const [showForm, setShowForm]   = useState(false)
  const [editing, setEditing]     = useState<Supplier | null>(null)
  const [search, setSearch]       = useState('')

  const load = async () => {
    const res = await window.api.admin.suppliers.list()
    if (res.success) setSuppliers(res.data as Supplier[])
  }

  useEffect(() => { load() }, [])

  const filtered = suppliers.filter(s =>
    !search ||
    String(s.name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(s.business_name || '').toLowerCase().includes(search.toLowerCase()) ||
    String(s.mobile_number || s.phone || '').includes(search)
  )

  const totalDue = suppliers.reduce((s, sup) => s + Number(sup.due_balance || 0), 0)

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
                  <button onClick={() => { setEditing(s); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit">
                    <Edit2 size={13}/>
                  </button>
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
    </div>
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
    if (supplier) await window.api.admin.suppliers.update(supplier.id as string, payload)
    else          await window.api.admin.suppliers.create(payload)
    setSaving(false)
    toast.success('Saved')
    onSave()
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
