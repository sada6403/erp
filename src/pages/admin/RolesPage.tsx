import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, Trash2, Shield, ShieldCheck, Lock } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

const SUPER_ADMIN_ROLE_ID = '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d'

const ALL_PERMISSIONS: { key: string; label: string; description: string; group: string }[] = [
  { key: 'all',       label: 'Super Admin',        description: 'Full access to everything',         group: 'Special' },
  { key: 'pos',       label: 'POS / Billing',       description: 'Access to POS terminal and billing', group: 'Operations' },
  { key: 'inventory', label: 'Inventory',            description: 'Products, stock, purchase orders',  group: 'Operations' },
  { key: 'customers', label: 'Customers',            description: 'Customer list and installments',    group: 'Operations' },
  { key: 'deliveries',label: 'Deliveries',           description: 'Delivery management and tracking',  group: 'Operations' },
  { key: 'expenses',  label: 'Expenses',             description: 'Expense tracking and management',   group: 'Operations' },
  { key: 'reports',   label: 'Reports / Analytics',  description: 'Dashboard and sales analytics',     group: 'Management' },
  { key: 'employees', label: 'Employee Management',  description: 'Manage users and roles',            group: 'Management' },
  { key: 'branches',  label: 'Branch Management',    description: 'Branches and audit logs',           group: 'Management' },
  { key: 'transfers', label: 'Stock Transfers',      description: 'Inter-branch stock transfers',      group: 'Management' },
  { key: 'settings',  label: 'Settings',             description: 'App configuration and sync',        group: 'Management' },
]

const GROUPS = ['Special', 'Operations', 'Management']

type Role = { id: string; name: string; permissions: string }
type PermMap = Record<string, boolean>

function parsePerms(raw: string): PermMap {
  try { return JSON.parse(raw) } catch { return {} }
}

const emptyForm = { name: '', permissions: {} as PermMap }

export default function RolesPage() {
  const { user } = useAuthStore()
  const [roles, setRoles]       = useState<Role[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Role | null>(null)
  const [form, setForm]         = useState(emptyForm)
  const [saving, setSaving]     = useState(false)

  const myPerms = ((user?.role as unknown as Record<string,unknown>)?.permissions as PermMap) || {}
  const isSuperAdmin = Boolean(myPerms.all)

  const load = async () => {
    const res = await window.api.admin.roles.list()
    if (res.success) setRoles(res.data as Role[])
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm(emptyForm)
    setShowForm(true)
  }

  const openEdit = (r: Role) => {
    setEditing(r)
    setForm({ name: r.name, permissions: parsePerms(r.permissions) })
    setShowForm(true)
  }

  const togglePerm = (key: string) => {
    setForm(f => {
      const next = { ...f.permissions, [key]: !f.permissions[key] }
      // If 'all' is checked, check all others; if unchecked, leave them
      if (key === 'all' && next.all) {
        ALL_PERMISSIONS.forEach(p => { next[p.key] = true })
      }
      return { ...f, permissions: next }
    })
  }

  const save = async () => {
    if (!form.name.trim()) { toast.error('Role name is required'); return }
    setSaving(true)
    try {
      const payload = { name: form.name.trim(), permissions: form.permissions }
      const res = editing
        ? await window.api.admin.roles.update(editing.id, payload)
        : await window.api.admin.roles.create(payload)
      if (res.success) {
        toast.success(editing ? 'Role updated' : 'Role created')
        setShowForm(false)
        load()
      } else {
        toast.error(res.error || 'Failed to save role')
      }
    } finally { setSaving(false) }
  }

  const deleteRole = async (r: Role) => {
    if (r.id === SUPER_ADMIN_ROLE_ID) { toast.error('Cannot delete Super Admin role'); return }
    if (!confirm(`Delete role "${r.name}"? Users with this role must be reassigned first.`)) return
    const res = await window.api.admin.roles.delete(r.id)
    if (res.success) { toast.success('Role deleted'); load() }
    else toast.error(res.error || 'Delete failed')
  }

  const permCount = (r: Role) => Object.values(parsePerms(r.permissions)).filter(Boolean).length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Roles & Permissions"
        subtitle={`${roles.length} roles configured`}
        actions={
          isSuperAdmin && (
            <button onClick={openCreate} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> New Role
            </button>
          )
        }
      />

      <div className="flex-1 overflow-auto p-6">
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
          {roles.map(r => {
            const perms = parsePerms(r.permissions)
            const isSuper = r.id === SUPER_ADMIN_ROLE_ID || perms.all
            const count = permCount(r)
            return (
              <div key={r.id} className="card">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {isSuper
                      ? <ShieldCheck size={18} className="text-purple-500 flex-shrink-0" />
                      : <Shield size={18} className="text-blue-500 flex-shrink-0" />}
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{r.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                        {isSuper ? 'Full access to all features' : `${count} permission${count !== 1 ? 's' : ''} granted`}
                      </p>
                    </div>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="btn-ghost btn-sm p-1.5">
                        <Edit2 size={13} />
                      </button>
                      {r.id !== SUPER_ADMIN_ROLE_ID && (
                        <button onClick={() => deleteRole(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      )}
                      {r.id === SUPER_ADMIN_ROLE_ID && (
                        <Lock size={13} style={{ color: 'var(--text-3)' }} className="mt-1.5 mr-1" />
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {ALL_PERMISSIONS.filter(p => p.key !== 'all').map(p => {
                    const active = isSuper || Boolean(perms[p.key])
                    return (
                      <span key={p.key}
                        className={`px-2 py-0.5 rounded-full text-xs font-medium border ${
                          active
                            ? 'bg-blue-50 text-blue-700 border-blue-200'
                            : 'border-transparent'
                        }`}
                        style={active ? {} : { background: 'var(--bg-page)', color: 'var(--text-3)', borderColor: 'var(--border)' }}
                      >
                        {p.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {showForm && (
        <Modal
          title={editing ? `Edit Role — ${editing.name}` : 'Create New Role'}
          onClose={() => setShowForm(false)}
          size="lg"
          footer={
            <>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving} className="btn-primary">
                {saving ? 'Saving…' : editing ? 'Update Role' : 'Create Role'}
              </button>
            </>
          }
        >
          <div className="space-y-5">
            <div>
              <label className="label">Role Name *</label>
              <input
                className="input"
                value={form.name}
                onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Branch Manager, Cashier, Warehouse Staff"
                disabled={editing?.id === SUPER_ADMIN_ROLE_ID}
              />
            </div>

            <div>
              <p className="text-sm font-semibold mb-3" style={{ color: 'var(--text-1)' }}>Permissions</p>
              {GROUPS.map(group => (
                <div key={group} className="mb-4">
                  <p className="text-xs font-semibold uppercase tracking-widest mb-2" style={{ color: 'var(--text-3)' }}>{group}</p>
                  <div className="space-y-2">
                    {ALL_PERMISSIONS.filter(p => p.group === group).map(p => {
                      const checked = Boolean(form.permissions[p.key])
                      const disabled = editing?.id === SUPER_ADMIN_ROLE_ID || (p.key !== 'all' && Boolean(form.permissions.all))
                      return (
                        <label key={p.key} className="flex items-start gap-3 cursor-pointer group">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => togglePerm(p.key)}
                            disabled={disabled}
                            className="mt-0.5 w-4 h-4 accent-blue-600 flex-shrink-0"
                          />
                          <div>
                            <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>{p.label}</p>
                            <p className="text-xs" style={{ color: 'var(--text-3)' }}>{p.description}</p>
                          </div>
                        </label>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
