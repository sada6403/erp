import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Percent, Search, Pencil, Trash2, Power } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const money = (n: unknown) => `Rs.${Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`

export default function DiscountsPage() {
  const [discounts, setDiscounts] = useState<Row[]>([])
  const [branches, setBranches]   = useState<Row[]>([])
  const [search, setSearch]       = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [activeOnly, setActiveOnly] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [showForm, setShowForm]   = useState<Row | null | 'new'>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.discounts.list({
        search: search.trim() || undefined,
        branchId: branchFilter || undefined,
        activeOnly: activeOnly || undefined,
      })
      if (res.success) setDiscounts(res.data as Row[])
      else toast.error(String(res.error || 'Failed to load discounts'))
    } finally { setLoading(false) }
  }, [search, branchFilter, activeOnly])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    window.api.admin.branches.list().then((r: { success: boolean; data?: Row[]; error?: string }) => {
      if (r.success) setBranches(r.data || [])
    }).catch(() => undefined)
  }, [])

  const toggleActive = async (row: Row) => {
    const res = await window.api.discounts.toggleActive(String(row.id), !row.is_active)
    if (res.success) { toast.success(row.is_active ? 'Discount deactivated' : 'Discount activated'); load() }
    else toast.error(String(res.error || 'Failed'))
  }

  const remove = async (row: Row) => {
    if (!confirm(`Delete discount "${row.name}"? This cannot be undone.`)) return
    const res = await window.api.discounts.delete(String(row.id))
    if (res.success) { toast.success('Discount deleted'); load() }
    else toast.error(String(res.error || 'Failed'))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Discount Management"
        subtitle={`${discounts.length} discount rule(s)`}
        actions={
          <button onClick={() => setShowForm('new')} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New Discount
          </button>
        }
      />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="relative w-64">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-8" placeholder="Search discount name…" />
        </div>
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)} className="input w-auto text-sm">
          <option value="">All Branches</option>
          {branches.map(b => <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}
        </select>
        <label className="flex items-center gap-1.5 text-sm" style={{ color: 'var(--text-3)' }}>
          <input type="checkbox" checked={activeOnly} onChange={e => setActiveOnly(e.target.checked)} />
          Active only
        </label>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Name', 'Type', 'Value', 'Max Cap', 'Applies To', 'Branch', 'Valid', 'Status', 'Actions'].map(h =>
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {discounts.map(d => (
              <tr key={String(d.id)} className="table-row">
                <td className="table-cell font-medium">{String(d.name)}</td>
                <td className="table-cell text-slate-400 text-sm capitalize">{String(d.type)}</td>
                <td className="table-cell font-semibold">
                  {d.type === 'percentage' ? `${Number(d.value)}%` : money(d.value)}
                </td>
                <td className="table-cell text-sm text-slate-400">{d.max_discount_amount != null ? money(d.max_discount_amount) : '—'}</td>
                <td className="table-cell text-sm">
                  {d.scope === 'all' ? <span className="badge-blue">All Products</span> : (String(d.product_name) || 'Unknown product')}
                </td>
                <td className="table-cell text-sm text-slate-400">{(d.branch_name as string) || 'All Branches'}</td>
                <td className="table-cell text-xs text-slate-500">
                  {d.valid_from ? String(d.valid_from).slice(0, 10) : '—'} → {d.valid_until ? String(d.valid_until).slice(0, 10) : 'No end'}
                </td>
                <td className="table-cell">
                  <span className={d.is_active ? 'badge-green' : 'badge-gray'}>{d.is_active ? 'Active' : 'Inactive'}</span>
                </td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button onClick={() => setShowForm(d)} className="btn-ghost btn-sm p-1.5" title="Edit"><Pencil size={13} /></button>
                    <button onClick={() => toggleActive(d)} className="btn-ghost btn-sm p-1.5" title={d.is_active ? 'Deactivate' : 'Activate'}>
                      <Power size={13} className={d.is_active ? 'text-green-400' : 'text-slate-500'} />
                    </button>
                    <button onClick={() => remove(d)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Delete"><Trash2 size={13} /></button>
                  </div>
                </td>
              </tr>
            ))}
            {discounts.length === 0 && !loading && (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">
                <Percent size={28} className="mx-auto mb-2 opacity-40" />
                No discount rules yet — create the first one
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      <MaxDiscountLimits />

      {showForm && (
        <DiscountFormModal
          discount={showForm === 'new' ? null : showForm}
          branches={branches}
          onClose={() => setShowForm(null)}
          onDone={() => { setShowForm(null); load() }}
        />
      )}
    </div>
  )
}

// ── Create / edit discount rule ────────────────────────────────────────────
function DiscountFormModal({ discount, branches, onClose, onDone }: {
  discount: Row | null
  branches: Row[]
  onClose: () => void
  onDone: () => void
}) {
  const [products, setProducts] = useState<Row[]>([])
  const [form, setForm] = useState({
    name: String(discount?.name || ''),
    type: (discount?.type as string) || 'percentage',
    value: discount?.value != null ? String(discount.value) : '',
    max_discount_amount: discount?.max_discount_amount != null ? String(discount.max_discount_amount) : '',
    scope: (discount?.scope as string) || 'all',
    product_id: (discount?.product_id as string) || '',
    branch_id: (discount?.branch_id as string) || '',
    valid_from: discount?.valid_from ? String(discount.valid_from).slice(0, 10) : '',
    valid_until: discount?.valid_until ? String(discount.valid_until).slice(0, 10) : '',
    is_active: discount ? Boolean(discount.is_active) : true,
  })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.products.list({ is_active: true }).then((r: { success: boolean; data?: Row[] }) => {
      if (r.success) setProducts(r.data || [])
    }).catch(() => undefined)
  }, [])

  const save = async () => {
    if (!form.name.trim()) { toast.error('Discount name is required'); return }
    if (!(Number(form.value) > 0)) { toast.error('Enter a discount value greater than 0'); return }
    if (form.scope === 'product' && !form.product_id) { toast.error('Select a product'); return }
    setSaving(true)
    try {
      const payload = {
        name: form.name.trim(),
        type: form.type,
        value: Number(form.value),
        max_discount_amount: form.max_discount_amount ? Number(form.max_discount_amount) : null,
        scope: form.scope,
        product_id: form.scope === 'product' ? form.product_id : null,
        branch_id: form.branch_id || null,
        valid_from: form.valid_from || null,
        valid_until: form.valid_until || null,
        is_active: form.is_active,
      }
      const res = discount
        ? await window.api.discounts.update(String(discount.id), payload)
        : await window.api.discounts.create(payload)
      if (!res.success) { toast.error(String(res.error || 'Failed to save discount')); return }
      toast.success(discount ? 'Discount updated' : 'Discount created')
      onDone()
    } finally { setSaving(false) }
  }

  return (
    <Modal title={discount ? 'Edit Discount' : 'New Discount'} onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving…' : 'Save'}</button>
      </>
    }>
      <div className="space-y-4">
        <div>
          <label className="label">Discount Name *</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            className="input" placeholder="e.g. New Year Sale" autoFocus />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type *</label>
            <select value={form.type} onChange={e => setForm(p => ({ ...p, type: e.target.value }))} className="input">
              <option value="percentage">Percentage (%)</option>
              <option value="flat">Flat Amount (Rs.)</option>
            </select>
          </div>
          <div>
            <label className="label">Value *</label>
            <input type="number" value={form.value} onChange={e => setForm(p => ({ ...p, value: e.target.value }))}
              className="input font-bold" placeholder={form.type === 'percentage' ? '10' : '500'} min={0} step="0.01" />
          </div>
        </div>

        <div>
          <label className="label">Max Discount Cap (Rs., optional)</label>
          <input type="number" value={form.max_discount_amount}
            onChange={e => setForm(p => ({ ...p, max_discount_amount: e.target.value }))}
            className="input" placeholder="No cap" min={0} step="0.01" />
        </div>

        <div>
          <label className="label">Applies To *</label>
          <div className="flex gap-2">
            <button type="button" onClick={() => setForm(p => ({ ...p, scope: 'all' }))}
              className={form.scope === 'all' ? 'btn-primary btn-sm flex-1' : 'btn-secondary btn-sm flex-1'}>
              All Products
            </button>
            <button type="button" onClick={() => setForm(p => ({ ...p, scope: 'product' }))}
              className={form.scope === 'product' ? 'btn-primary btn-sm flex-1' : 'btn-secondary btn-sm flex-1'}>
              Specific Product
            </button>
          </div>
        </div>

        {form.scope === 'product' && (
          <div>
            <label className="label">Product *</label>
            <select value={form.product_id} onChange={e => setForm(p => ({ ...p, product_id: e.target.value }))} className="input">
              <option value="">Select a product…</option>
              {products.map(p => (
                <option key={String(p.id)} value={String(p.id)}>{String(p.name)} ({String(p.sku)})</option>
              ))}
            </select>
          </div>
        )}

        <div>
          <label className="label">Branch</label>
          <select value={form.branch_id} onChange={e => setForm(p => ({ ...p, branch_id: e.target.value }))} className="input">
            <option value="">All Branches (Global)</option>
            {branches.map(b => <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Valid From</label>
            <input type="date" value={form.valid_from} onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Valid Until</label>
            <input type="date" value={form.valid_until} min={form.valid_from}
              onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} className="input" />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm" style={{ color: 'var(--text-2)' }}>
          <input type="checkbox" checked={form.is_active} onChange={e => setForm(p => ({ ...p, is_active: e.target.checked }))} />
          Active (auto-applies at POS immediately)
        </label>
      </div>
    </Modal>
  )
}

// ── Per-role max discount cap (replaces the old hardcoded Cart.tsx values) ──
function MaxDiscountLimits() {
  const [roles, setRoles] = useState<Row[]>([])
  const [edited, setEdited] = useState<Record<string, string>>({})
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(() => {
    window.api.admin.roles.list().then((r: { success: boolean; data?: Row[] }) => {
      if (r.success) setRoles(r.data || [])
    }).catch(() => undefined)
  }, [])

  useEffect(() => { load() }, [load])

  const permsOf = (role: Row): Record<string, unknown> => {
    const raw = role.permissions
    try { return typeof raw === 'string' ? JSON.parse(raw) : (raw as Record<string, unknown>) || {} }
    catch { return {} }
  }

  const legacyDefault = (roleName: string) => {
    const lower = roleName.toLowerCase()
    if (lower.includes('cashier')) return 5
    if (lower.includes('manager')) return 15
    return 100
  }

  const currentValue = (role: Row) => {
    if (edited[String(role.id)] !== undefined) return edited[String(role.id)]
    const perms = permsOf(role)
    return perms.max_discount_pct != null ? String(perms.max_discount_pct) : String(legacyDefault(String(role.name)))
  }

  const save = async (role: Row) => {
    const val = Math.max(0, Math.min(100, Number(currentValue(role)) || 0))
    setSaving(String(role.id))
    try {
      const perms = permsOf(role)
      const res = await window.api.admin.roles.update(String(role.id), {
        name: role.name,
        permissions: { ...perms, max_discount_pct: val },
      })
      if (res.success) { toast.success(`${role.name} max discount set to ${val}%`); load() }
      else toast.error(String(res.error || 'Failed to save'))
    } finally { setSaving(null) }
  }

  if (roles.length === 0) return null

  return (
    <div className="border-t px-6 py-4 flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
      <h3 className="font-semibold text-sm mb-1" style={{ color: 'var(--text-1)' }}>Max Discount Limits (per role)</h3>
      <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
        Caps how much discount a cashier/manager can manually apply at POS. Company Admin is unlimited. Enforced on the server, not just the screen.
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {roles.map(role => {
          const isAdmin = Boolean(permsOf(role).all)
          return (
            <div key={String(role.id)} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
              <p className="text-sm font-medium mb-1.5" style={{ color: 'var(--text-1)' }}>{String(role.name)}</p>
              {isAdmin ? (
                <span className="badge-blue">Unlimited</span>
              ) : (
                <div className="flex items-center gap-1.5">
                  <input
                    type="number" min={0} max={100}
                    value={currentValue(role)}
                    onChange={e => setEdited(p => ({ ...p, [String(role.id)]: e.target.value }))}
                    className="input py-1 text-sm w-20"
                  />
                  <span className="text-xs" style={{ color: 'var(--text-3)' }}>%</span>
                  <button onClick={() => save(role)} disabled={saving === String(role.id)}
                    className="btn-secondary btn-sm ml-auto">
                    {saving === String(role.id) ? '…' : 'Save'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
