import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, Trash2, Shield, ShieldCheck, Lock, ShoppingBag, Package, Users, Truck, Receipt, BarChart3, UserCog, GitBranch, ArrowLeftRight, Settings, Check, X, Ticket } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

const SUPER_ADMIN_ROLE_ID = '3a6b8c9d-1e2f-4a3b-8c9d-1e2f3a6b8c9d'

// Module definitions with granular actions
// `key` maps to the flat permission flag (e.g. permissions.pos = view access)
// Each action key maps to an additional flag (e.g. permissions.pos_void)
const MODULES = [
  {
    key: 'pos', label: 'POS / Billing', icon: ShoppingBag, group: 'Operations',
    actions: [
      { key: 'pos_hold',     label: 'Hold Invoice' },
      { key: 'pos_void',     label: 'Void/Cancel' },
      { key: 'pos_discount', label: 'Apply Discount' },
      { key: 'pos_credit',   label: 'Credit Sales' },
      { key: 'pos_print',    label: 'Print Receipt' },
    ]
  },
  {
    key: 'inventory', label: 'Inventory', icon: Package, group: 'Operations',
    actions: [
      { key: 'inventory_create', label: 'Add Products' },
      { key: 'inventory_edit',   label: 'Edit Products' },
      { key: 'inventory_delete', label: 'Delete' },
      { key: 'inventory_adjust', label: 'Stock Adjust' },
      { key: 'inventory_export', label: 'Export' },
    ]
  },
  {
    key: 'customers', label: 'Customers', icon: Users, group: 'Operations',
    actions: [
      { key: 'customers_create', label: 'Add Customer' },
      { key: 'customers_edit',   label: 'Edit' },
      { key: 'customers_delete', label: 'Delete' },
    ]
  },
  {
    key: 'deliveries', label: 'Deliveries', icon: Truck, group: 'Operations',
    actions: [
      { key: 'deliveries_update', label: 'Update Status' },
    ]
  },
  {
    key: 'expenses', label: 'Expenses', icon: Receipt, group: 'Operations',
    actions: [
      { key: 'expenses_create', label: 'Add Expense' },
      { key: 'expenses_edit',   label: 'Edit' },
      { key: 'expenses_delete', label: 'Delete' },
    ]
  },
  {
    key: 'transfers', label: 'Stock Transfers', icon: ArrowLeftRight, group: 'Management',
    actions: [
      { key: 'transfers_create',  label: 'Create Transfer' },
      { key: 'transfers_approve', label: 'Approve' },
    ]
  },
  {
    key: 'coupons', label: 'Coupons', icon: Ticket, group: 'Management',
    actions: [
      { key: 'coupons_create',  label: 'Issue Coupons' },
      { key: 'coupons_void',    label: 'Void Coupons' },
      { key: 'coupons_reports', label: 'Coupon Reports' },
    ]
  },
  {
    key: 'reports', label: 'Reports / Analytics', icon: BarChart3, group: 'Management',
    actions: [
      { key: 'reports_export', label: 'Export Reports' },
    ]
  },
  {
    key: 'employees', label: 'Employee Management', icon: UserCog, group: 'Management',
    actions: [
      { key: 'employees_create', label: 'Add User' },
      { key: 'employees_edit',   label: 'Edit User' },
      { key: 'employees_delete', label: 'Delete User' },
    ]
  },
  {
    key: 'branches', label: 'Branch Management', icon: GitBranch, group: 'Management',
    actions: [
      { key: 'branches_create', label: 'Add Branch' },
      { key: 'branches_edit',   label: 'Edit Branch' },
    ]
  },
  {
    key: 'settings', label: 'Settings', icon: Settings, group: 'Management',
    actions: [
      { key: 'settings_edit', label: 'Edit Settings' },
    ]
  },
] as const

type ModKey = typeof MODULES[number]['key']
type PermMap = Record<string, boolean>
type Role = { id: string; name: string; permissions: string }

function parsePerms(raw: string): PermMap {
  try { return JSON.parse(raw) } catch { return {} }
}

function permLabel(p: PermMap) {
  if (p.all) return 'Full Access'
  const active = MODULES.filter(m => p[m.key]).map(m => m.label)
  if (!active.length) return 'No permissions'
  if (active.length <= 3) return active.join(', ')
  return `${active.slice(0, 3).join(', ')} +${active.length - 3} more`
}

export default function RolesPage() {
  const { user } = useAuthStore()
  const [roles, setRoles]       = useState<Role[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing]   = useState<Role | null>(null)
  const [form, setForm]         = useState<{ name: string; permissions: PermMap }>({ name: '', permissions: {} })
  const [saving, setSaving]     = useState(false)

  const myPerms = ((user?.role as unknown as Record<string,unknown>)?.permissions as PermMap) || {}
  const isSuperAdmin = Boolean(myPerms.all)

  const load = async () => {
    try {
      const res = await window.api.admin.roles.list()
      if (res.success) setRoles(res.data as Role[])
      else toast.error(res.error || 'Failed to load roles')
    } catch (err) {
      toast.error('Failed to load roles: ' + String(err))
    }
  }

  useEffect(() => { load() }, [])

  const openCreate = () => {
    setEditing(null)
    setForm({ name: '', permissions: {} })
    setShowForm(true)
  }

  const openEdit = (r: Role) => {
    setEditing(r)
    setForm({ name: r.name, permissions: parsePerms(r.permissions) })
    setShowForm(true)
  }

  const toggleModule = (key: ModKey) => {
    setForm(f => {
      const next = { ...f.permissions }
      if (next[key]) {
        // Removing module access: also remove all its action perms
        delete next[key]
        const mod = MODULES.find(m => m.key === key)
        mod?.actions.forEach(a => { delete next[a.key] })
      } else {
        next[key] = true
      }
      return { ...f, permissions: next }
    })
  }

  const toggleAction = (modKey: ModKey, actionKey: string) => {
    setForm(f => {
      const next = { ...f.permissions, [actionKey]: !f.permissions[actionKey] }
      // Enabling an action implicitly grants module view
      if (next[actionKey]) next[modKey] = true
      return { ...f, permissions: next }
    })
  }

  const toggleAll = () => {
    const hasAll = Boolean(form.permissions.all)
    if (hasAll) {
      setForm({ ...form, permissions: {} })
    } else {
      const all: PermMap = { all: true }
      MODULES.forEach(m => {
        all[m.key] = true
        m.actions.forEach(a => { all[a.key] = true })
      })
      setForm({ ...form, permissions: all })
    }
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
    } catch (err) {
      toast.error('Failed to save role: ' + String(err))
    } finally { setSaving(false) }
  }

  const deleteRole = async (r: Role) => {
    if (r.id === SUPER_ADMIN_ROLE_ID) { toast.error('Cannot delete Company Admin role'); return }
    if (!confirm(`Delete role "${r.name}"? Users with this role must be reassigned first.`)) return
    try {
      const res = await window.api.admin.roles.delete(r.id)
      if (res.success) { toast.success('Role deleted'); load() }
      else toast.error(res.error || 'Delete failed')
    } catch (err) {
      toast.error('Failed to delete role: ' + String(err))
    }
  }

  const isLocked = (r: Role) => r.id === SUPER_ADMIN_ROLE_ID
  const formIsLocked = editing?.id === SUPER_ADMIN_ROLE_ID

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Roles & Permissions"
        subtitle={`${roles.length} roles · define what each role can see and do`}
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
            return (
              <div key={r.id} className="card">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                      style={{ background: isSuper ? 'color-mix(in srgb, #a855f7 15%, transparent)' : 'color-mix(in srgb, var(--brand-primary) 12%, transparent)' }}>
                      {isSuper ? <ShieldCheck size={18} className="text-purple-500" /> : <Shield size={18} style={{ color: 'var(--brand-primary)' }} />}
                    </div>
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{r.name}</p>
                      <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>{permLabel(perms)}</p>
                    </div>
                  </div>
                  {isSuperAdmin && (
                    <div className="flex gap-1 items-center">
                      <button onClick={() => openEdit(r)} className="btn-ghost btn-sm p-1.5">
                        <Edit2 size={13} />
                      </button>
                      {!isLocked(r) && (
                        <button onClick={() => deleteRole(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-500">
                          <Trash2 size={13} />
                        </button>
                      )}
                      {isLocked(r) && <Lock size={13} style={{ color: 'var(--text-3)' }} className="mt-0.5 mr-1" />}
                    </div>
                  )}
                </div>

                {/* Permission chips */}
                <div className="flex flex-wrap gap-1.5">
                  {MODULES.map(m => {
                    const active = isSuper || Boolean(perms[m.key])
                    const Icon = m.icon
                    return (
                      <span key={m.key}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border"
                        style={active
                          ? { background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', color: 'var(--brand-primary)', borderColor: 'color-mix(in srgb, var(--brand-primary) 30%, transparent)' }
                          : { background: 'var(--bg-page)', color: 'var(--text-3)', borderColor: 'var(--border)' }
                        }
                      >
                        <Icon size={10} />
                        {m.label}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Role Edit Modal — Permission Matrix */}
      {showForm && (
        <Modal
          title={editing ? `Edit Role — ${editing.name}` : 'Create New Role'}
          onClose={() => setShowForm(false)}
          size="lg"
          footer={
            <>
              <button onClick={() => setShowForm(false)} className="btn-secondary">Cancel</button>
              <button onClick={save} disabled={saving || formIsLocked} className="btn-primary">
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
                disabled={formIsLocked}
              />
            </div>

            {/* Full access toggle */}
            <label className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${form.permissions.all ? 'border-purple-400/50' : ''}`}
              style={{ background: form.permissions.all ? 'color-mix(in srgb, #a855f7 8%, transparent)' : 'var(--bg-soft)', borderColor: form.permissions.all ? undefined : 'var(--border)' }}>
              <input type="checkbox" checked={Boolean(form.permissions.all)} onChange={toggleAll} disabled={formIsLocked} className="w-4 h-4 accent-purple-500" />
              <ShieldCheck size={16} className="text-purple-500 flex-shrink-0" />
              <div>
                <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Company Admin (Full Access)</p>
                <p className="text-xs" style={{ color: 'var(--text-3)' }}>Grants all permissions below automatically</p>
              </div>
            </label>

            {/* Permission Matrix */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-widest mb-3" style={{ color: 'var(--text-3)' }}>Module Permissions</p>
              <div className="rounded-xl overflow-hidden border" style={{ borderColor: 'var(--border)' }}>
                {MODULES.map((mod, idx) => {
                  const Icon = mod.icon
                  const hasModule = Boolean(form.permissions.all) || Boolean(form.permissions[mod.key])
                  const isDisabled = formIsLocked || Boolean(form.permissions.all)
                  return (
                    <div key={mod.key} className={`${idx > 0 ? 'border-t' : ''}`} style={{ borderColor: 'var(--border)' }}>
                      {/* Module row */}
                      <div className="flex items-center gap-3 px-4 py-2.5" style={{ background: 'var(--bg-soft)' }}>
                        <label className="flex items-center gap-2 cursor-pointer flex-1">
                          <input
                            type="checkbox"
                            checked={hasModule}
                            onChange={() => toggleModule(mod.key)}
                            disabled={isDisabled}
                            className="w-4 h-4 flex-shrink-0"
                            style={{ accentColor: 'var(--brand-primary)' }}
                          />
                          <Icon size={13} style={{ color: hasModule ? 'var(--brand-primary)' : 'var(--text-3)' }} />
                          <span className="text-xs font-semibold" style={{ color: hasModule ? 'var(--text-1)' : 'var(--text-3)' }}>
                            {mod.label}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: 'var(--bg-page)', color: 'var(--text-3)' }}>View</span>
                        </label>
                        <span className="text-[10px]" style={{ color: 'var(--text-3)' }}>{mod.group}</span>
                      </div>

                      {/* Action checkboxes */}
                      {mod.actions.length > 0 && (
                        <div className="px-4 py-2 flex flex-wrap gap-x-4 gap-y-1.5">
                          {mod.actions.map(action => {
                            const checked = Boolean(form.permissions.all) || Boolean((form.permissions as Record<string, boolean>)[action.key])
                            const actionDisabled = isDisabled || !hasModule
                            return (
                              <label key={action.key} className={`flex items-center gap-1.5 cursor-pointer ${actionDisabled ? 'opacity-40' : ''}`}>
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => !actionDisabled && toggleAction(mod.key, action.key)}
                                  disabled={actionDisabled}
                                  className="w-3.5 h-3.5"
                                  style={{ accentColor: 'var(--brand-primary)' }}
                                />
                                <span className="text-xs" style={{ color: 'var(--text-2)' }}>{action.label}</span>
                              </label>
                            )
                          })}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Summary */}
            <div className="flex items-center gap-3 text-xs rounded-lg px-3 py-2" style={{ background: 'var(--bg-soft)', color: 'var(--text-3)' }}>
              <div className="flex items-center gap-1.5"><Check size={12} className="text-green-500" />{Object.values(form.permissions).filter(Boolean).length} permission flags active</div>
              <div className="flex items-center gap-1.5 ml-auto"><X size={12} className="text-red-400" />{Object.keys(form.permissions).length - Object.values(form.permissions).filter(Boolean).length} disabled</div>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
