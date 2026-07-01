import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, Trash2, Users, ShieldCheck, Search, Lock, UserX, UserCheck, KeyRound, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

const SUPER_ADMIN_ID = 'u9999999-9999-4999-8999-999999999999'

const PERMISSION_GROUPS = [
  { key: 'all',       label: 'Company Admin',   description: 'Full access to all modules and branches in this company' },
  { key: 'pos',       label: 'POS Billing',      description: 'POS screen, sales, quotations, credit bills' },
  { key: 'inventory', label: 'Inventory',         description: 'Products, GRN, stock lookup, stock count' },
  { key: 'transfers', label: 'Stock Transfers',   description: 'Transfer requests, receiving, approvals' },
  { key: 'customers', label: 'Customers',          description: 'Customer records, credit profile, history' },
  { key: 'deliveries',label: 'Deliveries',         description: 'Delivery orders and dispatch workflow' },
  { key: 'reports',   label: 'Reports',            description: 'Dashboards, analytics, branch reports' },
  { key: 'employees', label: 'Employees',          description: 'Users and staff management' },
  { key: 'expenses',  label: 'Expenses',           description: 'Expense entries and supplier payments' },
  { key: 'settings',  label: 'Settings',           description: 'System, printer, barcode, invoice layouts' },
  { key: 'branches',  label: 'Branches',           description: 'Branch records, audit logs, sync monitor' },
] as const

// Roles that a Branch Manager is NOT allowed to assign (privilege escalation guard)
const PRIVILEGED_ROLE_NAMES = ['Company Admin', 'Branch Manager']

type Role = Record<string, unknown> & { id: string; name: string; permissions: string }

export default function UsersPage() {
  const [users,        setUsers]        = useState<Record<string,unknown>[]>([])
  const [roles,        setRoles]        = useState<Role[]>([])
  const [branches,     setBranches]     = useState<Record<string,unknown>[]>([])
  const [showUserForm, setShowUserForm] = useState(false)
  const [showRoleForm, setShowRoleForm] = useState(false)
  const [editingUser,  setEditingUser]  = useState<Record<string,unknown>|null>(null)
  const [editingRole,  setEditingRole]  = useState<Role | null>(null)
  const [actionUser,   setActionUser]   = useState<Record<string,unknown>|null>(null)
  const [hardDeleteUser, setHardDeleteUser] = useState<Record<string,unknown>|null>(null)
  const [tab,          setTab]          = useState<'users' | 'roles'>('users')
  const [search,       setSearch]       = useState('')
  const currentUser = useAuthStore(s => s.user)

  // ── Permission helpers ──────────────────────────────────────────────────────
  const isGlobalUser   = Boolean(currentUser?.role?.permissions?.all)
  const callerBranchId = currentUser?.branch?.id

  const load = async () => {
    const [u, r, b] = await Promise.all([
      window.api.admin.users.list(),
      window.api.admin.roles.list(),
      window.api.admin.branches.list(),
    ])
    if (u.success) setUsers(u.data as Record<string,unknown>[])
    if (r.success) setRoles(r.data as Role[])
    if (b.success) setBranches(b.data as Record<string,unknown>[])
  }

  useEffect(() => { load() }, [])

  // Branch Manager → own branch users only
  const visibleUsers = users.filter(u => {
    if (!isGlobalUser && callerBranchId && u.branch_id !== callerBranchId) return false
    return true
  })

  const filteredUsers = visibleUsers.filter(u => {
    const q = search.toLowerCase().trim()
    if (!q) return true
    return [u.name, u.email, u.role_name, u.branch_name].some(v =>
      String(v || '').toLowerCase().includes(q)
    )
  })

  const roleUsage = roles.reduce<Record<string, number>>((acc, role) => {
    acc[role.id] = visibleUsers.filter(u => u.role_id === role.id).length
    return acc
  }, {})

  const deleteUser = async (u: Record<string,unknown>) => {
    if (u.id === SUPER_ADMIN_ID) { toast.error('Cannot deactivate super admin'); return }
    if (u.id === currentUser?.id) { toast.error('Cannot deactivate your own account'); return }
    if (!isGlobalUser && PRIVILEGED_ROLE_NAMES.includes(u.role_name as string)) {
      toast.error('Cannot deactivate admin accounts'); return
    }
    if (!confirm(`Deactivate user "${u.name}"? They will not be able to login until re-activated.`)) return
    const res = await window.api.admin.users.delete(u.id as string)
    if (res.success) { toast.success('User deactivated'); load() }
    else toast.error(res.error || 'Failed')
  }

  const toggleActive = async (u: Record<string,unknown>, active: boolean) => {
    if (u.id === SUPER_ADMIN_ID) { toast.error('Cannot change super admin status'); return }
    const res = await window.api.admin.users.toggleActive(u.id as string, active)
    if (res.success) { toast.success(active ? `${u.name} enabled` : `${u.name} disabled`); load() }
    else toast.error(res.error || 'Failed')
  }

  const deleteRole = async (role: Role) => {
    if (role.name === 'Company Admin') { toast.error('Cannot delete Company Admin role'); return }
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
        subtitle={`${filteredUsers.length} users, ${roles.length} roles`}
        actions={
          tab === 'users' ? (
            <button
              onClick={() => { setEditingUser(null); setShowUserForm(true) }}
              className="btn-primary btn-sm gap-1.5"
            >
              <Plus size={14} /> Add User
            </button>
          ) : isGlobalUser ? (
            // Only Company Admin can create roles
            <button
              onClick={() => { setEditingRole(null); setShowRoleForm(true) }}
              className="btn-primary btn-sm gap-1.5"
            >
              <Plus size={14} /> Add Role
            </button>
          ) : null
        }
      />

      <div
        className="flex items-center justify-between gap-3 px-6 pt-4 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <div className="flex gap-2">
          <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={Users} label="Users" />
          {/* Role-Based Access tab — visible to all but edit-locked for non-global */}
          <TabButton
            active={tab === 'roles'}
            onClick={() => setTab('roles')}
            icon={isGlobalUser ? ShieldCheck : Lock}
            label={isGlobalUser ? 'Role-Based Access' : 'Roles (View Only)'}
          />
        </div>
        {tab === 'users' && (
          <div className="relative w-72 mb-2">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-8"
              placeholder="Search users..."
            />
          </div>
        )}
      </div>

      {tab === 'users' ? (
        <UsersTable
          users={filteredUsers}
          currentUserId={currentUser?.id as string | undefined}
          isGlobalUser={isGlobalUser}
          onEdit={u => { setEditingUser(u); setShowUserForm(true) }}
          onDelete={deleteUser}
          onHardDelete={isGlobalUser ? u => setHardDeleteUser(u) : undefined}
          onToggleActive={toggleActive}
          onManage={u => setActionUser(u)}
        />
      ) : (
        <RolesSection
          roles={roles}
          roleUsage={roleUsage}
          isGlobalUser={isGlobalUser}
          onEdit={r => {
            if (!isGlobalUser) { toast.error('Only Company Admin can edit roles'); return }
            setEditingRole(r); setShowRoleForm(true)
          }}
          onDelete={deleteRole}
        />
      )}

      {actionUser && (
        <UserActionsModal
          user={actionUser}
          isGlobalUser={isGlobalUser}
          onClose={() => setActionUser(null)}
          onDone={() => { setActionUser(null); load() }}
        />
      )}

      {hardDeleteUser && (
        <HardDeleteUserModal
          user={hardDeleteUser}
          onClose={() => setHardDeleteUser(null)}
          onDone={() => { setHardDeleteUser(null); load() }}
        />
      )}

      {showUserForm && (
        <UserForm
          user={editingUser}
          roles={roles}
          branches={branches}
          currentUser={currentUser as Record<string,unknown> | null}
          isGlobalUser={isGlobalUser}
          callerBranchId={callerBranchId}
          onClose={() => setShowUserForm(false)}
          onSave={() => { setShowUserForm(false); load() }}
        />
      )}

      {showRoleForm && isGlobalUser && (
        <RoleForm
          role={editingRole}
          onClose={() => setShowRoleForm(false)}
          onSave={() => { setShowRoleForm(false); load() }}
        />
      )}
    </div>
  )
}

// ── Tab Button ────────────────────────────────────────────────────────────────
function TabButton({
  active, onClick, icon: Icon, label,
}: {
  active: boolean; onClick: () => void; icon: typeof Users; label: string
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 rounded-t-lg text-sm font-semibold border border-b-0 transition-colors ${
        active ? 'bg-[var(--bg-card)] text-blue-500' : 'hover:bg-[var(--bg-soft)]'
      }`}
      style={{
        borderColor: active ? 'var(--border)' : 'transparent',
        color: active ? undefined : 'var(--text-3)',
      }}
    >
      <Icon size={15} />
      {label}
    </button>
  )
}

// ── Users Table ───────────────────────────────────────────────────────────────
function UsersTable({
  users, currentUserId, isGlobalUser, onEdit, onDelete, onHardDelete, onToggleActive, onManage,
}: {
  users: Record<string, unknown>[]
  currentUserId?: string
  isGlobalUser: boolean
  onEdit: (u: Record<string, unknown>) => void
  onDelete: (u: Record<string, unknown>) => void
  onHardDelete?: (u: Record<string, unknown>) => void
  onToggleActive: (u: Record<string, unknown>, active: boolean) => void
  onManage: (u: Record<string, unknown>) => void
}) {
  const roleColor: Record<string, string> = {
    'Company Admin':   'badge-purple',
    'Branch Manager':  'badge-blue',
    'Cashier':         'badge-green',
    'Warehouse Staff': 'badge-yellow',
    'Delivery Staff':  'badge-gray',
  }

  return (
    <div className="flex-1 overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-surface-900 z-10">
          <tr>
            {['Name', 'Email', 'Role', 'Branch', 'PIN', 'Status', 'Last Login', 'Actions'].map(h =>
              <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
            )}
          </tr>
        </thead>
        <tbody>
          {users.map(u => {
            const isSuperAdmin = u.id === SUPER_ADMIN_ID
            const isSelf       = u.id === currentUserId
            const isPrivileged = PRIVILEGED_ROLE_NAMES.includes(u.role_name as string)
            const canModify    = isGlobalUser || !isPrivileged
            const isActive     = Boolean(u.is_active)

            return (
              <tr key={u.id as string} className={`table-row ${!isActive ? 'opacity-60' : ''}`}>
                <td className="table-cell">
                  <div className="flex items-center gap-2">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold ${isActive ? 'bg-brand-600/30 text-brand-400' : 'bg-slate-700 text-slate-500'}`}>
                      {String(u.name || 'U')[0]?.toUpperCase()}
                    </div>
                    <div>
                      <span className="font-medium">{u.name as string}</span>
                      {isSuperAdmin && <span className="ml-1 text-xs text-brand-400 font-mono">[admin]</span>}
                      {(u.force_password_change as number) === 1 && (
                        <span className="ml-1 text-xs text-amber-400" title="Must change password on next login">⚠ pw change</span>
                      )}
                    </div>
                  </div>
                </td>
                <td className="table-cell text-slate-400 text-xs">{u.email as string}</td>
                <td className="table-cell">
                  <span className={`${roleColor[u.role_name as string] || 'badge-gray'}`}>
                    {u.role_name as string}
                  </span>
                </td>
                <td className="table-cell text-slate-400">{(u.branch_name as string) || 'All Branches'}</td>
                <td className="table-cell font-mono text-slate-400">{u.pin ? '****' : '-'}</td>
                <td className="table-cell">
                  <span className={isActive ? 'badge-green' : 'badge-red'}>
                    {isActive ? 'Active' : 'Inactive'}
                  </span>
                  {(u.locked_until as string) && new Date(u.locked_until as string) > new Date() && (
                    <span className="ml-1 text-xs text-red-400" title="Account locked due to failed logins">🔒 locked</span>
                  )}
                </td>
                <td className="table-cell text-xs text-slate-500">
                  {u.last_login_at ? new Date(u.last_login_at as string).toLocaleDateString() : 'Never'}
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    {canModify && (
                      <button onClick={() => onEdit(u)} className="btn-ghost btn-sm p-1.5" title="Edit user">
                        <Edit2 size={13} />
                      </button>
                    )}
                    {canModify && !isSuperAdmin && isGlobalUser && (
                      <button
                        onClick={() => onManage(u)}
                        className="btn-ghost btn-sm p-1.5 text-brand-400 hover:text-brand-300"
                        title="Password & Access Management"
                      >
                        <KeyRound size={13} />
                      </button>
                    )}
                    {canModify && !isSuperAdmin && !isSelf && (
                      isActive ? (
                        <button
                          onClick={() => onToggleActive(u, false)}
                          className="btn-ghost btn-sm p-1.5 text-orange-400 hover:text-orange-300"
                          title="Disable user"
                        >
                          <UserX size={13} />
                        </button>
                      ) : (
                        <button
                          onClick={() => onToggleActive(u, true)}
                          className="btn-ghost btn-sm p-1.5 text-green-400 hover:text-green-300"
                          title="Enable user"
                        >
                          <UserCheck size={13} />
                        </button>
                      )
                    )}
                    {!isSuperAdmin && !isSelf && canModify && (
                      <button
                        onClick={() => onDelete(u)}
                        className="btn-ghost btn-sm p-1.5 text-red-400 hover:text-red-300"
                        title="Deactivate user"
                      >
                        <Trash2 size={13} />
                      </button>
                    )}
                    {!isSuperAdmin && !isSelf && onHardDelete && (
                      <button
                        onClick={() => onHardDelete(u)}
                        className="btn-ghost btn-sm p-1.5 text-red-600 hover:text-red-400"
                        title="Permanently delete user"
                      >
                        <AlertTriangle size={13} />
                      </button>
                    )}
                    {!canModify && (
                      <span className="text-xs px-2" style={{ color: 'var(--text-3)' }} title="No access">
                        <Lock size={12} />
                      </span>
                    )}
                  </div>
                </td>
              </tr>
            )
          })}
          {users.length === 0 && (
            <tr><td colSpan={8} className="text-center py-16 text-slate-500">No users found</td></tr>
          )}
        </tbody>
      </table>
    </div>
  )
}

// ── Roles Section ─────────────────────────────────────────────────────────────
function RolesSection({
  roles, roleUsage, isGlobalUser, onEdit, onDelete,
}: {
  roles: Role[]
  roleUsage: Record<string, number>
  isGlobalUser: boolean
  onEdit: (r: Role) => void
  onDelete: (r: Role) => void
}) {
  return (
    <div className="flex-1 overflow-y-auto p-6 space-y-6">
      {!isGlobalUser && (
        <div className="flex items-center gap-2 px-4 py-3 rounded-lg text-sm"
          style={{ background: 'rgba(250,204,21,0.08)', border: '1px solid rgba(250,204,21,0.2)', color: '#fbbf24' }}>
          <Lock size={14} />
          Role management is restricted to Company Admin. You can view roles but cannot edit them.
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        {roles.map(role => {
          const permissions = parsePermissions(role.permissions)
          const isAll = Boolean(permissions.all)
          return (
            <div key={role.id} className="card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{role.name}</h3>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    {roleUsage[role.id] || 0} assigned user(s)
                  </p>
                </div>
                <span className={isAll ? 'badge-purple' : 'badge-blue'}>
                  {isAll ? 'Full Access' : `${Object.values(permissions).filter(Boolean).length} rules`}
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mt-4 min-h-16">
                {PERMISSION_GROUPS.filter(p => Boolean(permissions[p.key]) || isAll).map(p => (
                  <span key={p.key} className="badge-gray">{p.label}</span>
                ))}
              </div>
              {/* Edit/Delete buttons — only Company Admin */}
              {isGlobalUser && (
                <div
                  className="flex justify-end gap-1 mt-4 pt-3 border-t"
                  style={{ borderColor: 'var(--border)' }}
                >
                  <button onClick={() => onEdit(role)} className="btn-secondary btn-sm gap-1.5">
                    <Edit2 size={13} /> Edit
                  </button>
                  {role.name !== 'Company Admin' && (
                    <button
                      onClick={() => onDelete(role)}
                      disabled={(roleUsage[role.id] || 0) > 0}
                      className="btn-ghost btn-sm gap-1.5 text-red-400 disabled:opacity-40"
                    >
                      <Trash2 size={13} /> Delete
                    </button>
                  )}
                </div>
              )}
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

// ── User Form ─────────────────────────────────────────────────────────────────
function UserForm({
  user, roles, branches, currentUser, isGlobalUser, callerBranchId, onClose, onSave,
}: {
  user: Record<string,unknown>|null
  roles: Role[]
  branches: Record<string,unknown>[]
  currentUser: Record<string,unknown> | null
  isGlobalUser: boolean
  callerBranchId?: string
  onClose: () => void
  onSave: () => void
}) {
  // Branch Manager can only assign non-privileged roles
  const assignableRoles = isGlobalUser
    ? roles
    : roles.filter(r => !PRIVILEGED_ROLE_NAMES.includes(r.name))

  const [form, setForm] = useState({
    name:      String(user?.name     || ''),
    email:     String(user?.email    || ''),
    password:  '',
    role_id:   String(user?.role_id  || ''),
    branch_id: String(user?.branch_id || (!isGlobalUser && callerBranchId ? callerBranchId : '')),
    pin:       String(user?.pin      || ''),
    is_active: user?.is_active !== undefined ? user.is_active : 1,
  })
  const [saving, setSaving] = useState(false)
  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement|HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  // Detect if the selected role needs email+password (admin) or PIN only (staff)
  const selectedRole = roles.find(r => r.id === form.role_id)
  const rolePerms    = parsePermissions(selectedRole?.permissions)
  const isAdminRole  = Boolean(
    rolePerms.all || rolePerms.reports || rolePerms.employees ||
    rolePerms.settings || rolePerms.branches
  )
  // Staff roles (Cashier, Warehouse Staff, Delivery Staff) use PIN only
  const isPinOnly = !!selectedRole && !isAdminRole

  const save = async () => {
    if (!form.name || !form.role_id) {
      toast.error('Name and role are required'); return
    }
    if (isAdminRole) {
      if (!form.email) { toast.error('Email is required for admin accounts'); return }
      if (!user && !form.password) { toast.error('Password is required for admin accounts'); return }
    }
    if (isPinOnly && !form.pin) {
      toast.error('PIN is required for staff accounts'); return
    }

    setSaving(true)
    const payload: Record<string,unknown> = { ...form }
    if (!payload.password) delete payload.password

    // Staff roles: auto-generate placeholder email & password (DB requires NOT NULL)
    if (isPinOnly && !user) {
      const slug = form.name.toLowerCase().replace(/\s+/g, '.').replace(/[^a-z0-9.]/g, '')
      payload.email    = `${slug}.${Date.now()}@staff.local`
      payload.password = crypto.randomUUID()
    }

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
    <Modal
      title={user ? 'Edit User' : 'Add User'}
      onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">
          {saving ? 'Saving...' : 'Save'}
        </button>
      </>}
    >
      <div className="grid grid-cols-2 gap-4">

        {/* Name — always shown */}
        <div className="col-span-2">
          <label className="label">Full Name *</label>
          <input value={form.name} onChange={f('name')} className="input" autoFocus />
        </div>

        {/* Role first — drives which fields appear */}
        <div>
          <label className="label">Role *</label>
          <select value={form.role_id} onChange={f('role_id')} className="input">
            <option value="">Select role...</option>
            {assignableRoles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          {!isGlobalUser && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
              Admin roles can only be assigned by Company Admin
            </p>
          )}
        </div>

        {/* Branch */}
        <div>
          <label className="label">
            Branch {!isGlobalUser && <span className="text-xs text-amber-400 ml-1">(your branch)</span>}
          </label>
          {isGlobalUser ? (
            <select value={form.branch_id} onChange={f('branch_id')} className="input">
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={b.id as string} value={b.id as string}>{b.name as string}</option>
              ))}
            </select>
          ) : (
            <input
              value={branches.find(b => b.id === form.branch_id)?.name as string || form.branch_id}
              readOnly
              className="input opacity-60 cursor-not-allowed"
              title="Branch is locked to your branch"
            />
          )}
        </div>

        {/* ── PIN-only staff (Cashier / Warehouse / Delivery) ── */}
        {isPinOnly && (
          <>
            <div className="col-span-2 rounded-lg px-3 py-2.5 flex items-center gap-2 text-sm"
              style={{ background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>
              <Lock size={13} />
              Staff role — login via PIN only. Email &amp; password not required.
            </div>
            <div className="col-span-2">
              <label className="label">PIN * (4-6 digits)</label>
              <input
                value={form.pin}
                onChange={f('pin')}
                className="input font-mono text-xl tracking-widest"
                placeholder="e.g. 1234"
                maxLength={6}
                inputMode="numeric"
                pattern="[0-9]*"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Staff will use this PIN to login from the POS terminal.
              </p>
            </div>
          </>
        )}

        {/* ── Admin roles (Company Admin / Branch Manager) ── */}
        {isAdminRole && (
          <>
            <div>
              <label className="label">Email *</label>
              <input value={form.email} onChange={f('email')} type="email" className="input" />
            </div>
            <div>
              <label className="label">Password {user ? '(leave blank to keep)' : '*'}</label>
              <input type="password" value={form.password} onChange={f('password')} className="input" />
            </div>
            <div>
              <label className="label">PIN (optional)</label>
              <input
                value={form.pin}
                onChange={f('pin')}
                className="input font-mono"
                placeholder="1234"
                maxLength={6}
                inputMode="numeric"
              />
              <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                Optional — lets admin login via PIN at POS terminal too.
              </p>
            </div>
          </>
        )}

        {/* No role selected yet */}
        {!selectedRole && (
          <div className="col-span-2 text-sm text-center py-3" style={{ color: 'var(--text-3)' }}>
            Select a role to see the required fields.
          </div>
        )}

        {/* Active toggle — always shown once role is selected */}
        {selectedRole && (
          <div className={`flex items-end pb-1 ${isPinOnly ? '' : ''}`}>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={Boolean(form.is_active)}
                onChange={e => setForm(p => ({ ...p, is_active: e.target.checked ? 1 : 0 }))}
                className="w-4 h-4 accent-brand-500"
              />
              <span className="text-sm" style={{ color: 'var(--text-2)' }}>Active</span>
            </label>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Role Form ─────────────────────────────────────────────────────────────────
function RoleForm({ role, onClose, onSave }: { role: Role | null; onClose: () => void; onSave: () => void }) {
  const initialPermissions = parsePermissions(role?.permissions)
  const [name,        setName]        = useState(role?.name || '')
  const [permissions, setPermissions] = useState<Record<string, boolean>>(initialPermissions)
  const [saving,      setSaving]      = useState(false)
  const isSuperAdminRole = role?.name === 'Company Admin'

  const setPermission = (key: string, value: boolean) => {
    if (key === 'all') { setPermissions(value ? { all: true } : {}); return }
    setPermissions(p => ({ ...p, all: false, [key]: value }))
  }

  const save = async () => {
    if (!name.trim()) { toast.error('Role name is required'); return }
    const cleanPermissions = Object.fromEntries(Object.entries(permissions).filter(([, v]) => v))
    setSaving(true)
    const payload = { name: name.trim(), permissions: cleanPermissions }
    const res = role
      ? await window.api.admin.roles.update(role.id, payload)
      : await window.api.admin.roles.create(payload)
    setSaving(false)
    if (res.success) { toast.success(role ? 'Role updated' : 'Role created'); onSave() }
    else toast.error(String(res.error || 'Save failed'))
  }

  return (
    <Modal
      title={role ? 'Edit Role Access' : 'Create Role Access'}
      onClose={onClose}
      size="lg"
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving || isSuperAdminRole} className="btn-primary">
          {saving ? 'Saving...' : 'Save Role'}
        </button>
      </>}
    >
      <div className="space-y-5">
        {isSuperAdminRole && (
          <div className="rounded-lg border px-3 py-2 text-sm text-amber-300 bg-amber-900/20 border-amber-700/40">
            Company Admin role is protected. Create a new admin role if you need a different permission set.
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
              const checked  = Boolean(permissions.all || permissions[p.key])
              const disabled = isSuperAdminRole || (permissions.all && p.key !== 'all')
              return (
                <label
                  key={p.key}
                  className="flex items-start gap-3 rounded-lg border p-3 cursor-pointer"
                  style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}
                >
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

// ── User Actions Modal (password reset / force change) ────────────────────────
function UserActionsModal({
  user, isGlobalUser, onClose, onDone,
}: {
  user: Record<string, unknown>
  isGlobalUser: boolean
  onClose: () => void
  onDone: () => void
}) {
  const [newPassword,        setNewPassword]        = useState('')
  const [confirmPassword,    setConfirmPassword]    = useState('')
  const [forceChange,        setForceChange]        = useState(true)
  const [saving,             setSaving]             = useState(false)
  const [tab,                setTab]                = useState<'password' | 'access'>('password')

  const passwordStrength = (pw: string): { score: number; label: string; color: string } => {
    let score = 0
    if (pw.length >= 8)  score++
    if (pw.length >= 12) score++
    if (/[A-Z]/.test(pw)) score++
    if (/[0-9]/.test(pw)) score++
    if (/[^A-Za-z0-9]/.test(pw)) score++
    if (score <= 1) return { score, label: 'Weak',   color: 'bg-red-500' }
    if (score <= 2) return { score, label: 'Fair',   color: 'bg-yellow-500' }
    if (score <= 3) return { score, label: 'Good',   color: 'bg-blue-500' }
    return { score, label: 'Strong', color: 'bg-green-500' }
  }

  const strength = passwordStrength(newPassword)

  const resetPassword = async () => {
    if (!newPassword) { toast.error('Enter a new password'); return }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return }
    setSaving(true)
    const res = await window.api.admin.users.resetPassword(user.id as string, newPassword)
    if (res?.success) {
      if (forceChange) {
        await window.api.admin.users.forcePasswordChange(user.id as string, true)
      }
      toast.success(`Password reset for ${user.name}${forceChange ? ' — they must change it on next login' : ''}`)
      onDone()
    } else {
      toast.error(res?.error || 'Failed to reset password')
      setSaving(false)
    }
  }

  const toggleForceChange = async (force: boolean) => {
    setSaving(true)
    const res = await window.api.admin.users.forcePasswordChange(user.id as string, force)
    if (res?.success) {
      toast.success(force ? 'User must change password on next login' : 'Force password change removed')
      onDone()
    } else {
      toast.error(res?.error || 'Failed')
      setSaving(false)
    }
  }

  return (
    <Modal
      title={`Manage: ${user.name}`}
      onClose={onClose}
      footer={
        tab === 'password' ? (
          <>
            <button onClick={onClose} className="btn-secondary">Cancel</button>
            <button onClick={resetPassword} disabled={saving} className="btn-primary">
              {saving ? 'Resetting…' : 'Reset Password'}
            </button>
          </>
        ) : (
          <button onClick={onClose} className="btn-secondary">Close</button>
        )
      }
    >
      <div className="space-y-4">
        {/* Tab switcher */}
        <div className="flex gap-1 p-1 bg-surface-700 rounded-lg">
          {(['password', 'access'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`flex-1 py-1.5 text-sm rounded-md capitalize transition-colors ${tab === t ? 'bg-surface-500 text-slate-100 font-medium' : 'text-slate-400 hover:text-slate-200'}`}>
              {t === 'password' ? 'Reset Password' : 'Access Control'}
            </button>
          ))}
        </div>

        {tab === 'password' && (
          <>
            <div className="rounded-lg border border-amber-700/30 bg-amber-900/10 px-3 py-2 flex items-start gap-2 text-sm text-amber-300">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              Setting a new password will immediately override the user's current password.
            </div>

            <div>
              <label className="label">New Password *</label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                className="input"
                placeholder="Min 8 characters"
                autoFocus
              />
              {newPassword && (
                <div className="mt-1.5 flex items-center gap-2">
                  <div className="flex-1 h-1.5 bg-surface-600 rounded-full overflow-hidden">
                    <div className={`h-full transition-all ${strength.color}`} style={{ width: `${(strength.score / 5) * 100}%` }} />
                  </div>
                  <span className="text-xs text-slate-400">{strength.label}</span>
                </div>
              )}
            </div>

            <div>
              <label className="label">Confirm Password *</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                className="input"
                placeholder="Repeat new password"
              />
              {confirmPassword && newPassword !== confirmPassword && (
                <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
              )}
            </div>

            <label className="flex items-start gap-3 p-3 rounded-lg border border-surface-600 bg-surface-700/40 cursor-pointer">
              <input
                type="checkbox"
                checked={forceChange}
                onChange={e => setForceChange(e.target.checked)}
                className="w-4 h-4 accent-brand-500 mt-0.5"
              />
              <span>
                <span className="block text-sm text-slate-200 font-medium">Require password change on next login</span>
                <span className="block text-xs text-slate-400 mt-0.5">User will be prompted to set a new password before accessing the system.</span>
              </span>
            </label>
          </>
        )}

        {tab === 'access' && (
          <div className="space-y-3">
            <div className="rounded-lg border border-surface-600 p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-slate-200">Force Password Change</p>
                  <p className="text-xs text-slate-400 mt-0.5">
                    User must change password on next login.
                    {(user.force_password_change as number) === 1 ? ' Currently required.' : ' Not required.'}
                  </p>
                </div>
                <button
                  onClick={() => toggleForceChange(!((user.force_password_change as number) === 1))}
                  disabled={saving}
                  className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${(user.force_password_change as number) === 1 ? 'bg-amber-600/20 border border-amber-600/30 text-amber-300 hover:bg-amber-600/30' : 'bg-surface-600 border border-surface-500 text-slate-300 hover:border-brand-500'}`}
                >
                  {(user.force_password_change as number) === 1 ? 'Remove Requirement' : 'Set Requirement'}
                </button>
              </div>
            </div>

            {isGlobalUser && (
              <div className="rounded-lg border border-surface-600 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-slate-200">Account Status</p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Currently: <span className={(user.is_active as number) ? 'text-green-400' : 'text-red-400'}>
                        {(user.is_active as number) ? 'Active' : 'Disabled'}
                      </span>
                    </p>
                  </div>
                  <button
                    onClick={async () => {
                      setSaving(true)
                      const active = !Boolean(user.is_active)
                      const res = await window.api.admin.users.toggleActive(user.id as string, active)
                      if (res?.success) { toast.success(active ? 'Account enabled' : 'Account disabled'); onDone() }
                      else { toast.error(res?.error || 'Failed'); setSaving(false) }
                    }}
                    disabled={saving}
                    className={`px-3 py-1.5 rounded text-xs font-medium ${(user.is_active as number) ? 'bg-red-600/20 border border-red-600/30 text-red-300 hover:bg-red-600/30' : 'bg-green-600/20 border border-green-600/30 text-green-300 hover:bg-green-600/30'}`}
                  >
                    {(user.is_active as number) ? 'Disable Account' : 'Enable Account'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}

// ── Hard Delete User Modal ─────────────────────────────────────────────────────
function HardDeleteUserModal({ user, onClose, onDone }: {
  user: Record<string, unknown>
  onClose: () => void
  onDone: () => void
}) {
  const [confirm, setConfirm] = useState('')
  const [loading, setLoading] = useState(false)

  const canConfirm = confirm === String(user.name)

  const submit = async () => {
    if (!canConfirm) return
    setLoading(true)
    const res = await window.api.admin.users.hardDelete(user.id as string)
    setLoading(false)
    if (res.success) {
      toast.success(`User "${user.name}" permanently deleted`)
      onDone()
    } else {
      toast.error(res.error || 'Failed')
    }
  }

  return (
    <Modal title="Permanently Delete User" onClose={onClose}>
      <div className="space-y-4">
        <div className="rounded-lg p-4 border" style={{ background: 'rgba(239,68,68,0.08)', borderColor: 'rgba(239,68,68,0.3)' }}>
          <div className="flex gap-3">
            <AlertTriangle size={18} className="text-red-500 shrink-0 mt-0.5" />
            <div className="text-sm space-y-1">
              <p className="font-semibold text-red-500">This cannot be undone</p>
              <p style={{ color: 'var(--text-2)' }}>
                User <strong>{String(user.name)}</strong> will be permanently removed from the database.
                All references (audit logs, movements) will be cleared.
              </p>
            </div>
          </div>
        </div>

        <div>
          <label className="label">Type <strong>{String(user.name)}</strong> to confirm</label>
          <input
            className="input"
            placeholder={String(user.name)}
            value={confirm}
            onChange={e => setConfirm(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canConfirm && submit()}
          />
        </div>

        <div className="flex justify-end gap-3 pt-1">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button
            className="btn-sm px-4 py-2 rounded-lg text-sm font-medium text-white"
            style={{ background: canConfirm && !loading ? '#dc2626' : '#9ca3af', cursor: canConfirm && !loading ? 'pointer' : 'not-allowed' }}
            onClick={submit}
            disabled={!canConfirm || loading}
          >
            {loading ? 'Deleting...' : 'Permanently Delete'}
          </button>
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
