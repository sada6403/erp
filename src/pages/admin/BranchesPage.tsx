import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, GitBranch, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'

export default function BranchesPage() {
  const [branches, setBranches] = useState<Record<string,unknown>[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Record<string,unknown> | null>(null)

  const load = async () => {
    const res = await window.api.admin.branches.list()
    if (res.success) setBranches(res.data as Record<string,unknown>[])
  }

  useEffect(() => { load() }, [])

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Branch Management" subtitle={`${branches.length} branches`}
        actions={<button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5"><Plus size={14} /> Add Branch</button>}
      />
      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branches.map(b => (
            <div key={b.id as string} className="card hover:border-slate-600 transition-colors">
              <div className="flex items-start justify-between mb-3">
                <div className="w-10 h-10 bg-brand-600/20 rounded-xl flex items-center justify-center"><GitBranch size={18} className="text-brand-400" /></div>
                <div className="flex items-center gap-2">
                  {b.is_active ? <CheckCircle size={14} className="text-green-400" /> : <XCircle size={14} className="text-red-400" />}
                  <button onClick={() => { setEditing(b); setShowForm(true) }} className="btn-ghost btn-sm p-1.5"><Edit2 size={13} /></button>
                </div>
              </div>
              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold text-white">{b.name as string}</h3>
                {b.code ? <span className="px-1.5 py-0.5 bg-brand-600/20 text-brand-300 text-xs font-mono rounded">{String(b.code)}</span> : null}
              </div>
              <p className="text-xs text-slate-400">{b.address as string || 'No address'}</p>
              <p className="text-xs text-slate-500 mt-1">{`${String(b.phone ?? '')}${b.email ? ` · ${String(b.email)}` : ''}`}</p>
            </div>
          ))}
        </div>
      </div>
      {showForm && <BranchForm branch={editing} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />}
    </div>
  )
}

function BranchForm({ branch, onClose, onSave }: { branch: Record<string,unknown>|null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({ name: String(branch?.name||''), address: String(branch?.address||''), phone: String(branch?.phone||''), email: String(branch?.email||''), code: String(branch?.code||'') })
  const [saving, setSaving] = useState(false)
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({...p, [k]: e.target.value}))
  const save = async () => {
    if (!form.name) { toast.error('Name required'); return }
    setSaving(true)
    const payload = { ...form, code: form.code.toUpperCase().trim() || null }
    if (branch) await window.api.admin.branches.update(branch.id as string, payload)
    else await window.api.admin.branches.create(payload)
    setSaving(false)
    toast.success(branch ? 'Branch updated' : 'Branch created')
    onSave()
  }
  return (
    <Modal title={branch ? 'Edit Branch' : 'Add Branch'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Branch Name *</label><input value={form.name} onChange={f('name')} className="input" /></div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Branch Code <span className="text-slate-500">(for PIN login)</span></label>
            <input value={form.code} onChange={f('code')} className="input font-mono uppercase" placeholder="e.g. MAIN, BR01" maxLength={10} />
          </div>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Address</label><input value={form.address} onChange={f('address')} className="input" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Phone</label><input value={form.phone} onChange={f('phone')} className="input" /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Email</label><input value={form.email} onChange={f('email')} className="input" /></div>
        </div>
      </div>
    </Modal>
  )
}
