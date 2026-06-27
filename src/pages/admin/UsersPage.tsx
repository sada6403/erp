import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, Trash2, Users, ShieldCheck, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

const SUPER_ADMIN_ID = 'u9999999-9999-4999-8999-999999999999'

const PERMISSION_GROUPS = [
  { key: 'all', label: 'Super Admin', description: 'Full system access across all modules and branches' },
  { key: 'pos', label: 'POS Billing', description: 'POS screen, sales, quotations, credit bills' },
  { key: 'inventory', label: 'Inventory', description: 'Products, GRN, stock lookup, stock count' },
  { key: 'transfers', label: 'Stock Transfers', description: 'Transfer requests, receiving, approvals' },
  { key: 'customers', label: 'Customers', description: 'Customer records, credit profile, history' },
  { key: 'deliveries', label: 'Deliveries', description: 'Delivery orders and dispatch workflow' },
  { key: 'reports', label: 'Reports', description: 'Dashboards, analytics, branch reports' },
  { key: 'employees', label: 'Employees', description: 'Users and staff management' },
  { key: 'expenses', label: 'Expenses', description: 'Expense entries and supplier payments' },
  { key: 'settings', label: 'Settings', description: 'System, printer, barcode, invoice layouts' },
  { key: 'branches', label: 'Branches', description: 'Branch records, audit logs, sync monitor' },
] as const

type Role = Record<string, unknown> & { id: string; name: string; permissions: string }

export default function UsersPage() {
  const [users, setUsers] = useState<Record<string,unknown>[]>([])
  const [roles, setRoles] = useState<Role[]>([])
  const [branches, setBranches] = useState<Record<string,unknown>[]>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [editingUser, setEditingUser] = useState<Record<string,unknown>|null>(null)
  const [editingRole, setEditingRole] = useState<Role | null>(null)
  const [tab, setTab] = useState<'users' | 'roles'>('users')
  const [search, setSearch] = useState('')
  const currentUser = useAuthStore(s => s.user)

  const load = async () => {
    const [u, r, b] = await Promise.all([
      window.api.admin.users.list(),
      window.api.admin.roles.list(),
      window.api.admin.branches.list()
    ])
    if (u.success) setUsers(u.data as Record<string,unknown>[])
    if (r.success) setRoles(r.data as Role[])
    if (b.success) setBranches(b.data as Record<string,unknown>[])
  }

  useEffect(() => { load() }, [])

  const filteredUsers = users.filter(u => {
    const q = search.toLowerCase().trim()
    if (!q) return true
    return [u.name, u.email, u.role_name, u.branch_name].some(v => String(v || '').toLowerCase().includes(q))
  })

  const roleUsage = roles.reduce<Record<string, number>>((acc, role) => {
    acc[role.id] = users.filter(u => u.role_id === role.id).length
    return acc
  }, {})

  const deleteUser = async (u: Record<string,unknown>) => {
    if (u.id === SUPER_ADMIN_ID) { toast.error('Cannot delete super admin'); return }
    if (u.id === currentUser?.id) { toast.error('Cannot delete your own account'); return }
    if (!confirm(`Delete user "${u.name}"? This cannot be undone.`)) return
    const res = await window.api.admin.users.delete(u.id as string)
    if (res.success) { toast.success('User deleted'); load() }
    else toast.error(res.error || 'Failed')
  }

  const deleteRole = async (role: Role) => {
    if (role.name === 'Super Admin') { toast.error('Cannot delete Super Admin role'); return }
    if ((roleUsage[role.id] || 0) > 0) { toast.error('Role is assigned to users'); return }
    if (!confirm(`Delete role "${role.name}"?`)) return
    const res = await window.api.admin.roles.delete(role.id)
    if (res.success) { toast.success('Role deleted'); load() }
    else toast.error(res.error || 'Failed')
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Users & Role Access"
        subtitle={`${users.length} users, ${roles.length} roles`}
        actions={
          tab === 'users' ? (
            <button onClick={() => { setEditingUser(null); setShowUserForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add User
            </button>
          ) : (
            <button onClick={() => { setEditingRole(null); setShowRoleForm(true) }} className="btn-primary btn-sm gap-1.5">
              <Plus size={14} /> Add Role
            </button>
          )
        }
      />

      <div className="flex items-center justify-between gap-3 px-6 pt-4 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-2">
          <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={Users} label="Users" />
          <TabButton active={tab === 'roles'} onClick={() => setTab('roles')} icon={ShieldCheck} label="Role-Based Access" />
        </div>
        {tab === 'users' && (
          <div className="relative w-72 mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-8" placeholder="Search users..." />
          </div>
        )}
      </div>

      {tab === 'users' ? (
        <UsersTable
          users={filteredUsers}
          currentUserId={currentUser?.id as string | undefined}
          onEdit={u => { setEditingUser(u); setShowUserForm(true) }}
          onDelete={deleteUser}
        />
      ) : (
        <RolesSection
          roles={roles}
          roleUsage={roleUsage}
          onEdit={r => { setEditingRole(r); setShowRoleForm(true) }}
          onDelete={deleteRole}
        />
      )}

      {showUserForm && (
        <UserForm
          user={editingUser}
          roles={roles}
          branches={branches}
          onClose={() => setShowUserForm(false)}
          onSave={() => { setShowUserForm(false); load() }}
        />
      )}

      {showRoleForm && (
        <RoleForm
          role={editingRole}
          onClose={() => setShowRoleForm(false)}
          onSave={() => { setShowRoleForm(false); load() }}
        />
      )}
    </div>
  )
}

function TabButton({ active, onClick, icon: Icon, label }: { active: boolean; onClick: () => void; icon: typeof Users; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-semibold border border-b-0 transition-colors ${
        active ? 'bg-[var(--bg-card)] text-blue-500' : 'hover:bg-[var(--bg-soft)]'
      }`}
      style={{ borderColor: active ? 'var(--border)' : 'transparent', color: active ? undefined : 'var(--text-3)' }}
    >
      <Icon size={15} />
      {label}
    </button>
  )
}

function UsersTable({ users, currentUserId, onEdit, onDelete }: {
  users: Record<string, unknown>[]
  currentUserId?: string
  onEdit: (u: Record<string, unknown>) => void
  onDelete: (u: Record<string, unknown>) => void
}) {
  const roleColor: Record<string, string> = {
    'Super Admin': 'badge-purple',
    'Branch Manager': 'badge-blue',
    'Cashier': 'badge-green',
    'Warehouse Staff': 'badge-yellow',
    'Delivery Staff': 'badge-gray'
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-surface-900 z-10">
          <tr>
            {['Name', 'Email', 'Role', 'Branch', 'PIN', 'Status', 'Last Login', ''].map(h =>
              <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const isSuperAdmin = u.id === SUPER_ADMIN_ID
            const isSelf = u.id === currentUserId
            return (
              <tr key={u.id as string} className="table-row">
                <td className="table-cell">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 bg-brand-600/30 rounded-full flex items-center justify-center text-xs font-bold text-brand-400">
                      {String(u.name || 'U')[0]?.toUpperCase()}
                    </div>
                    <span className="font-medium">{u.name as string}</span>
                    {isSuperAdmin && <span className="text-xs text-brand-400 font-mono">[admin]</span>}
                  </div>
                </td>
                <td className="table-cell text-slate-400 text-xs">{u.email as string}</td>
                <td className="table-cell"><span className={`${roleColor[u.role_name as string] || 'badge-gray'}`}>{u.role_name as string}</span></td>
                <td className="table-cell text-slate-400">{(u.branch_name as string) || 'All Branches'}</td>
                <td className="table-cell font-mono text-slate-400">{u.pin ? '****' : '-'}</td>
                <td className="table-cell"><span className={u.is_active ? 'badge-green' : 'badge-red'}>{u.is_active ? 'Active' : 'Inactive'}</span></td>
                <td className="table-cell text-xs text-slate-500">{u.last_login_at ? new Date(u.last_login_at as string).toLocaleDateString() : 'Never'}</td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button onClick={() => onEdit(u)} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                    {!isSuperAdmin && !isSelf && (
                      <button onClick={() => onDelete(u)} className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-300" title="Delete">
                        <Trash2 size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {users.length === 0 && <tr><td colSpan={8} className="text-center py-16 text-slate-500">No users found</td></tr>}
        </tbody>
      </table>
    </div>
  )
}

function RolesSection({ roles, roleUsage, onEdit, onDelete }: {
  roles: Role[]
  roleUsage: Record<string, number>
  onEdit: (r: Role) => void
  onDelete: (r: Role) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {roles.map(role => {
          const permissions = parsePermissions(role.permissions)
          const isAll = Boolean(permissions.all)
          return (
            <div key={role.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{role.name}</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{roleUsage[role.id] || 0} assigned user(s)</p>
                </div>
                <span className={isAll ? 'badge-purple' : 'badge-blue'}>{isAll ? 'Full Access' : `${Object.values(permissions).filter(Boolean).length} rules`}</span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-4 min-h-16">
                {PERMISSION_GROUPS.filter(p => Boolean(permissions[p.key]) || isAll).map(p => (
                  <span key={p.key} className="badge-gray">{p.label}</span>
                ))}
              </div>
              <div className="flex justify-end gap-1 mt-4 pt-3 border-t" style={{ borderColor: 'var(--border)' }}>
                <button onClick={() => onEdit(role)} className="btn-secondary btn-sm gap-1.5"><Edit2 size={13} /> Edit</button>
                {role.name !== 'Super Admin' && (
                  <button onClick={() => onDelete(role)} disabled={(roleUsage[role.id] || 0) > 0} className="btn-ghost btn-sm gap-1.5 text-red-400 disabled:opacity-40">
                    <Trash2 size={13} /> Delete
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      <div className="card">
        <h3 className="font-semibold text-sm mb-4" style={{ color: 'var(--text-1)' }}>Permission Matrix</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th className="table-header">Permission</th>
                {roles.map(role => <th key={role.id} className="table-header text-center">{role.name}</th>)}
              </tr>
            </thead>
            <tbody>
              {PERMISSION_GROUPS.map(p => (
                <tr key={p.key} className="table-row">
                  <td className="table-cell">
                    <p className="font-medium">{p.label}</p>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>{p.description}</p>
                  </td>
                  {roles.map(role => {
                    const permissions = parsePermissions(role.permissions)
                    const enabled = Boolean(permissions.all || permissions[p.key])
                    return (
                      <td key={role.id} className="table-cell text-center">
                        <span className={enabled ? 'badge-green' : 'badge-gray'}>{enabled ? 'Allow' : 'No'}</span>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function UserForm({ user, roles, branches, onClose, onSave }: {
  user: Record<string,unknown>|null
  roles: Role[]
  branches: Record<string,unknown>[]
  onClose: () => void
  onSave: () => void
}) {
  const [form, setForm] = useState({
    name: String(user?.name || ''),
    email: String(user?.email || ''),
    password: '',
    role_id: String(user?.role_id || ''),
    branch_id: String(user?.branch_id || ''),
    pin: String(user?.pin || ''),
    is_active: user?.is_active !== undefined ? user.is_active : 1,
  })
  const [saving, setSaving] = useState(false)
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) =>
    setForm(p => ({...p, [k]: e.target.value}))

  const save = async () => {
    if (!form.name || !form.email || (!user && !form.password) || !form.role_id) {
      toast.error('Name, email, password and role are required'); return
    }
    setSaving(true)
    const payload: Record<string,unknown> = { ...form }
    if (!payload.password) delete payload.password
    const res = user
      ? await window.api.admin.users.update(user.id as string, payload)
      : await window.api.admin.users.create(payload)
    setSaving(false)
    if (res.success) {
      toast.success(user ? 'User updated' : 'User created')
      onSave()
    } else {
      toast.error(String(res.error || 'Save failed'))
    }
  }

  return (
    <Modal title={user ? 'Edit User' : 'Add User'} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button>
      </>}>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><label className="label">Full Name *</label><input value={form.name} onChange={f('name')} className="input" autoFocus /></div>
        <div><label className="label">Email *</label><input value={form.email} onChange={f('email')} className="input" /></div>
        <div><label className="label">Password {user ? '(leave blank to keep)' : '*'}</label><input type="password" value={form.password} onChange={f('password')} className="input" /></div>
        <div>
          <label className="label">Role *</label>
          <select value={form.role_id} onChange={f('role_id')} className="input">
            <option value="">Select role...</option>
            {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Branch</label>
          <select value={form.branch_id} onChange={f('branch_id')} className="input">
            <option value="">All Branches</option>
            {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
          </select>
        </div>
        <div><label className="label">PIN (4-6 digits)</label><input value={form.pin} onChange={f('pin')} className="input font-mono" placeholder="1234" maxLength={6} /></div>
        <div className="flex items-end pb-1">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.is_active)} onChange={e => setForm(p => ({...p, is_active: e.target.checked ? 1 : 0}))} className="w-4 h-4 accent-brand-500" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Active</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}

function RoleForm({ role, onClose, onSave }: { role: Role | null; onClose: () => void; onSave: () => void }) {
  const initialPermissions = parsePermissions(role?.permissions)
  const [name, setName] = useState(role?.name || '')
  const [permissions, setPermissions] = useState<Record<string, boolean>>(initialPermissions)
  const [saving, setSaving] = useState(false)
  const isSuperAdminRole = role?.name === 'Super Admin'

  const setPermission = (key: string, value: boolean) => {
    if (key === 'all') {
      setPermissions(value ? { all: true } : {})
      return
    }
    setPermissions(p => ({ ...p, all: false, [key]: value }))
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Role name is required'); return }
    const cleanPermissions = Object.fromEntries(Object.entries(permissions).filter(([, value]) => value))
    setSaving(true)
    const payload = { name: name.trim(), permissions: cleanPermissions }
    const res = role
      ? await window.api.admin.roles.update(role.id, payload)
      : await window.api.admin.roles.create(payload)
    setSaving(false)
    if (res.success) {
      toast.success(role ? 'Role updated' : 'Role created')
      onSave()
    } else {
      toast.error(String(res.error || 'Save failed'))
    }
  }

  return (
    <Modal title={role ? 'Edit Role Access' : 'Create Role Access'} onClose={onClose} size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving || isSuperAdminRole} className="btn-primary">{saving ? 'Saving...' : 'Save Role'}</button>
      </>}>
      <div className="space-y-5">
        {isSuperAdminRole && (
          <div className="rounded-lg border px-3 py-2 text-sm text-amber-300 bg-amber-900/20 border-amber-700/40">
            Super Admin role is protected. Create a new admin role if you need a different permission set.
          </div>
        )}
        <div>
          <label className="label">Role Name *</label>
          <input value={name} onChange={e => setName(e.target.value)} className="input" disabled={isSuperAdminRole} autoFocus />
        </div>
        <div>
          <h3 className="font-semibold text-sm mb-3" style={{ color: 'var(--text-1)' }}>Permissions</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {PERMISSION_GROUPS.map(p => {
              const checked = Boolean(permissions.all || permissions[p.key])
              const disabled = isSuperAdminRole || (permissions.all && p.key !== 'all')
              return (
                <label key={p.key} className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={e => setPermission(p.key, e.target.checked)}
                    className="w-4 h-4 accent-blue-600 mt-0.5"
                  />
                  <span>
                    <span className="block text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{p.label}</span>
                    <span className="block text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{p.description}</span>
                  </span>
                </label>
              )
            })}
          </div>
        </div>
      </div>
    </Modal>
  )
}

function parsePermissions(raw: unknown): Record<string, boolean> {
  if (!raw) return {}
  if (typeof raw === 'object') return raw as Record<string, boolean>
  try { return JSON.parse(String(raw)) as Record<string, boolean> }
  catch { return {} }
}
