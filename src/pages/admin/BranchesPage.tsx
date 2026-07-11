import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, GitBranch, CheckCircle, XCircle, Trash2, AlertTriangle, Copy } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

function getPerms(u: unknown): Record<string, unknown> {
  const user = u as Record<string, unknown>
  return (user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>
    || user?.permissions as Record<string, unknown> || {}
}

export default function BranchesPage() {
  const { user } = useAuthStore()
  const perms = getPerms(user)
  const isAdmin = Boolean(perms.all)

  const [branches, setBranches] = useState<Record<string,unknown>[]>([])
  const [users, setUsers] = useState<Record<string,unknown>[]>([])
  const [showForm,   setShowForm]   = useState(false)
  const [editing,    setEditing]    = useState<Record<string,unknown> | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<Record<string,unknown> | null>(null)
  const [deleting, setDeleting] = useState(false)

  const load = async () => {
    const [branchRes, userRes] = await Promise.all([
      window.api.admin.branches.list(),
      window.api.admin.users.list(),
    ])
    if (branchRes.success) {
      const data = branchRes.data as Record<string,unknown>[]
      setBranches(data)
    }
    if (userRes.success) setUsers(userRes.data as Record<string,unknown>[])
    return branchRes.success ? branchRes.data as Record<string,unknown>[] : null
  }

  useEffect(() => { load() }, [])

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleting(true)
    try {
      const res = await (window.api.admin.branches as unknown as { delete: (id: string) => Promise<{ success: boolean; error?: string }> }).delete(deleteTarget.id as string)
      if (res.success) {
        toast.success(`"${deleteTarget.name}" deleted`)
        setDeleteTarget(null)
        load()
      } else {
        toast.error(res.error || 'Delete failed')
      }
    } catch {
      toast.error('Delete failed')
    }
    setDeleting(false)
  }

  const isMain = (b: Record<string,unknown>) =>
    String(b.id) === 'b1111111-1111-4111-8111-111111111111'

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Branch Management"
        subtitle={`${branches.length} branches`}
        actions={
          <button
            onClick={() => { setEditing(null); setShowForm(true) }}
            className="btn-primary btn-sm gap-1.5"
          >
            <Plus size={14} /> Add Branch
          </button>
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {branches.map(b => (
            <div
              key={b.id as string}
              className={`card hover:border-slate-600 transition-colors ${isMain(b) ? 'border-brand-500/40' : ''}`}
            >
              <div className="flex items-start justify-between mb-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${isMain(b) ? 'bg-brand-500/30' : 'bg-brand-600/20'}`}>
                  <GitBranch size={18} className="text-brand-400" />
                </div>
                <div className="flex items-center gap-1">
                  {b.is_active
                    ? <CheckCircle size={14} className="text-green-400" />
                    : <XCircle size={14} className="text-red-400" />}
                  <button
                    onClick={async () => {
                      const fresh = await load()
                      const freshB = fresh?.find((x: Record<string,unknown>) => x.id === b.id) ?? b
                      setEditing(freshB); setShowForm(true)
                    }}
                    className="btn-ghost btn-sm p-1.5"
                    title="Edit branch"
                  >
                    <Edit2 size={13} />
                  </button>
                  {isAdmin && !isMain(b) && (
                    <button
                      onClick={() => setDeleteTarget(b)}
                      className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-300 hover:bg-red-900/20"
                      title="Delete branch"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 mb-1">
                <h3 className="font-bold" style={{ color: 'var(--text-1)' }}>{b.name as string}</h3>
                {b.code
                  ? <button
                      type="button"
                      onClick={async () => { await navigator.clipboard.writeText(String(b.code)); toast.success('Branch code copied') }}
                      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-brand-600/20 text-brand-300 text-xs font-mono rounded"
                      title="Copy branch code"
                    >
                      {String(b.code)}
                      <Copy size={10} />
                    </button>
                  : null}
                {isMain(b) && (
                  <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-300 text-xs rounded">Head Office</span>
                )}
              </div>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Manager: {String(b.manager_name || 'Unassigned')}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>{b.address as string || 'No address'}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                {`${String(b.phone ?? '')}${b.email ? ` · ${String(b.email)}` : ''}`}
              </p>
            </div>
          ))}
        </div>
      </div>

      {showForm && (
        <BranchForm
          branch={editing}
          users={users}
          onClose={() => setShowForm(false)}
          onSave={() => { setShowForm(false); load() }}
        />
      )}

      {/* Delete Confirmation */}
      {deleteTarget && (
        <Modal
          title="Delete Branch"
          onClose={() => setDeleteTarget(null)}
          footer={
            <>
              <button onClick={() => setDeleteTarget(null)} className="btn-secondary">Cancel</button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-2"
              >
                <Trash2 size={14} />
                {deleting ? 'Deleting…' : 'Yes, Delete Branch'}
              </button>
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex items-start gap-3 p-3 rounded-lg bg-red-900/20 border border-red-700/30">
              <AlertTriangle size={18} className="text-red-400 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm text-red-200 font-medium">
                  Delete "{deleteTarget.name as string}"?
                </p>
                <p className="text-xs text-red-300/70 mt-1">
                  This cannot be undone. The branch must have no active users or invoices.
                </p>
              </div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function BranchForm({
  branch, users, onClose, onSave,
}: {
  branch: Record<string,unknown> | null
  users: Record<string,unknown>[]
  onClose: () => void
  onSave: () => void
}) {
  const isMain = String(branch?.id || '') === 'b1111111-1111-4111-8111-111111111111'

  const hasExistingPin = Boolean(branch?.branch_pin)
  const [form, setForm] = useState({
    name:       String(branch?.name       || ''),
    code:       String(branch?.code       || ''),
    branch_pin: '', // PINs are stored hashed — blank means "keep current PIN"
    address:    String(branch?.address    || ''),
    phone:      String(branch?.phone      || ''),
    email:      String(branch?.email      || ''),
    manager_id: String(branch?.manager_id || ''),
    is_active:  branch ? Boolean(branch.is_active ?? true) : true,
  })
  const [saving, setSaving] = useState(false)

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  const save = async () => {
    if (!form.name.trim()) { toast.error('Branch name required'); return }
    if (form.branch_pin && !/^\d{4,6}$/.test(form.branch_pin)) {
      toast.error('Branch PIN must be 4–6 digits'); return
    }
    setSaving(true)
    try {
        const payload: Record<string, unknown> = {
          ...form,
          code:       form.code.toUpperCase().trim() || null,
          branch_pin: form.branch_pin.trim() || null,
          manager_id: form.manager_id || null,
          is_active:  form.is_active ? 1 : 0,
        }
      // Blank PIN on an existing branch = keep the current (hashed) PIN
      if (branch && !form.branch_pin.trim()) delete payload.branch_pin
      const res = branch
        ? await window.api.admin.branches.update(branch.id as string, payload)
        : await window.api.admin.branches.create(payload)
      if (!res.success) {
        toast.error(res.error || 'Save failed'); return
      }
      toast.success(branch ? 'Branch updated' : 'Branch created')
      onSave()
    } finally { setSaving(false) }
  }

  return (
    <Modal
      title={branch ? (isMain ? 'Edit Head Office' : `Edit Branch — ${branch.name as string}`) : 'Add Branch'}
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Saving…' : 'Save Changes'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Branch Name *</label>
            <input value={form.name} onChange={f('name')} className="input" placeholder="e.g. Main Branch" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              Branch Code
              {isMain && <span className="text-amber-400 ml-1">(Head Office)</span>}
            </label>
            <input
              value={form.code}
              onChange={f('code')}
              className="input font-mono uppercase"
              placeholder="e.g. MAIN, BR01"
              maxLength={10}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Branch Manager</label>
          <select value={form.manager_id} onChange={f('manager_id')} className="input">
            <option value="">Unassigned</option>
            {users
              .filter(u => Boolean(u.is_active))
              .map(u => (
                <option key={String(u.id)} value={String(u.id)}>
                  {String(u.name || 'User')} · {String(u.role_name || 'Staff')}
                </option>
              ))}
          </select>
          <p className="text-[11px] mt-1" style={{ color: 'var(--text-3)' }}>
            This user will be treated as the branch contact/owner for branch-level workflows.
          </p>
        </div>

        <div className="rounded-lg p-3 border border-slate-700 bg-slate-800/40">
          <div className="grid grid-cols-2 gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1">
                Branch Login PIN
                {hasExistingPin
                  ? <span className="text-slate-500 ml-1">(leave blank to keep current)</span>
                  : <span className="text-red-400 ml-1">*</span>}
              </label>
              <input
                value={form.branch_pin}
                onChange={e => {
                  const v = e.target.value.replace(/\D/g, '').slice(0, 6)
                  setForm(p => ({ ...p, branch_pin: v }))
                }}
                className="input font-mono tracking-widest text-center text-lg"
                placeholder={hasExistingPin ? '••••' : 'e.g. 1001'}
                maxLength={6}
                inputMode="numeric"
              />
            </div>
            <div className="text-xs text-slate-400 leading-relaxed pb-1">
              <p className="font-medium text-slate-300 mb-0.5">How it works:</p>
              <p>Staff enter this PIN at the POS terminal to select their branch before logging in with their personal PIN.</p>
              <p className="text-slate-500 mt-1">4–6 digits only.</p>
            </div>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Address</label>
          <textarea
            value={form.address}
            onChange={f('address')}
            className="input w-full resize-none"
            rows={2}
            placeholder="Street address, city, postal code"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Phone</label>
            <input value={form.phone} onChange={f('phone')} className="input" placeholder="+94 11 000 0000" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Email</label>
            <input value={form.email} onChange={f('email')} className="input" placeholder="branch@company.com" type="email" />
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-lg border border-slate-700 bg-slate-800/40">
          <div>
            <p className="text-sm font-medium text-slate-200">Branch Active</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {isMain ? 'Head Office must always remain active' : 'Inactive branches cannot process sales'}
            </p>
          </div>
          <button
            type="button"
            disabled={isMain}
            onClick={() => !isMain && setForm(p => ({ ...p, is_active: !p.is_active }))}
            className={`relative w-11 h-6 rounded-full transition-colors ${form.is_active ? 'bg-brand-500' : 'bg-slate-600'} ${isMain ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${form.is_active ? 'translate-x-5' : 'translate-x-0'}`} />
          </button>
        </div>
      </div>
    </Modal>
  )
}
