import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Pencil, Trash2, Percent, Gift, Clock, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'
import ProductSearchSelect from '@/components/shared/ProductSearchSelect'

type Row = Record<string, unknown>

export default function CommissionRulesPage() {
  const { user } = useAuthStore()
  const permissions = ((user?.role as unknown as Row)?.permissions as Row) || {}
  const isSuperAdmin = Boolean(permissions.all)

  const [rules, setRules] = useState<Row[]>([])
  const [schemes, setSchemes] = useState<Row[]>([])
  const [products, setProducts] = useState<Row[]>([])
  const [categories, setCategories] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)
  const [historyRuleId, setHistoryRuleId] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [r, s, p, c] = await Promise.all([
        window.api.commissions.rules.list(),
        window.api.chits.list(),
        window.api.products.list(),
        window.api.admin.categories.list(),
      ])
      if (r.success) setRules(r.data as Row[])
      else toast.error(String(r.error || 'Failed to load commission rules'))
      if (s.success) setSchemes(s.data as Row[])
      if (p.success) setProducts((p.data as Row[]) || [])
      if (c.success) setCategories(c.data as Row[])
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load commission rules')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const deleteRule = async (r: Row) => {
    if (!confirm(`Deactivate commission rule "${r.name}"?`)) return
    try {
      const res = await window.api.commissions.rules.delete(r.id as string)
      if (res.success) { toast.success('Rule deactivated'); load() }
      else toast.error(String(res.error || 'Failed to deactivate rule'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to deactivate rule')
    }
  }

  const scopeLabel = (r: Row) => {
    switch (r.scope) {
      case 'product': return `Product: ${(r.product_name as string) || '—'}`
      case 'category': return `Category: ${(r.category_name as string) || '—'}`
      case 'brand': return `Brand: ${(r.brand as string) || '—'}`
      case 'scheme': return `Scheme: ${(r.scheme_name as string) || '—'}`
      default: return 'Global (all schemes)'
    }
  }

  const ownershipLabel = (r: Row) => {
    if (r.ownership_model === 'sales') return 'Sales Agent 100%'
    if (r.ownership_model === 'split') return `Split ${r.registration_share_pct}% / ${r.sales_share_pct}%`
    return 'Registration Agent 100%'
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Commission Rules" subtitle={`${rules.length} rule(s) — percentage/fixed, product/category/brand/scheme-wise, bonus & campaign`}
        actions={isSuperAdmin && (
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New Rule
          </button>
        )}
      />

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading...</p>
        ) : rules.length === 0 ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>No commission rules yet — schemes fall back to each agent's default commission % until you add one.</p>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {rules.map(r => (
              <div key={r.id as string} className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {r.is_bonus ? <Gift size={15} className="text-purple-500" /> : <Percent size={15} style={{ color: 'var(--brand-primary)' }} />}
                    <div>
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{r.name as string}</p>
                      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{scopeLabel(r)}</p>
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => setHistoryRuleId(r.id as string)} className="btn-ghost btn-sm p-1.5" title="Rate History"><Clock size={13} /></button>
                    {isSuperAdmin && (
                      <>
                        <button onClick={() => { setEditing(r); setShowForm(true) }} className="btn-ghost btn-sm p-1.5"><Pencil size={13} /></button>
                        {r.status === 'active' && (
                          <button onClick={() => deleteRule(r)} className="btn-ghost btn-sm p-1.5 hover:text-red-500"><Trash2 size={13} /></button>
                        )}
                      </>
                    )}
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 text-xs">
                  <span className="badge-blue">{r.calculation_type === 'fixed' ? `Rs.${r.rate} fixed` : `${r.rate}%`}</span>
                  <span className="badge-gray">{ownershipLabel(r)}</span>
                  {Boolean(r.is_bonus) && <span className="badge-purple">Bonus / Campaign (stacks on base)</span>}
                  <span className={r.status === 'active' ? 'badge-green' : 'badge-gray'}>{r.status as string}</span>
                  {Number(r.priority) > 0 && <span className="badge-gray">Priority {r.priority as number}</span>}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showForm && (
        <RuleFormModal rule={editing} schemes={schemes} products={products} categories={categories}
          onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
      {historyRuleId && (
        <RateHistoryModal ruleId={historyRuleId} onClose={() => setHistoryRuleId(null)} />
      )}
    </div>
  )
}

function RateHistoryModal({ ruleId, onClose }: { ruleId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    window.api.commissions.rules.history(ruleId).then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setRows(res.data as Row[])
      else toast.error(res.error || 'Failed to load rate history')
    }).finally(() => setLoading(false))
  }, [ruleId])

  return (
    <Modal title="Rate History" onClose={onClose} footer={<button onClick={onClose} className="btn-secondary">Close</button>}>
      {loading ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : rows.length === 0 ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>No prior versions — this rule hasn't been edited since it was created.</p>
      ) : (
        <div className="space-y-3">
          {rows.map(r => (
            <div key={r.id as string} className="border-l-2 pl-3" style={{ borderColor: 'var(--border)' }}>
              <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                {r.calculation_type === 'fixed' ? `Rs.${r.rate} fixed` : `${r.rate}%`}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                {r.effective_start_date ? new Date(String(r.effective_start_date)).toLocaleDateString() : '—'}
                {' → '}
                {r.effective_end_date ? new Date(String(r.effective_end_date)).toLocaleDateString() : '—'}
                {' · changed by '}{(r.created_by_name as string) || 'System'}
              </p>
            </div>
          ))}
        </div>
      )}
    </Modal>
  )
}

function RuleFormModal({ rule, schemes, products, categories, onClose, onSave }: {
  rule: Row | null; schemes: Row[]; products: Row[]; categories: Row[]; onClose: () => void; onSave: () => void
}) {
  const [form, setForm] = useState({
    name: String(rule?.name || ''),
    scope: String(rule?.scope || 'global'),
    scheme_id: String(rule?.scheme_id || ''),
    product_id: String(rule?.product_id || ''),
    category_id: String(rule?.category_id || ''),
    brand: String(rule?.brand || ''),
    calculation_type: String(rule?.calculation_type || 'percentage'),
    rate: Number(rule?.rate || 0),
    ownership_model: String(rule?.ownership_model || 'registration'),
    registration_share_pct: Number(rule?.registration_share_pct ?? 100),
    sales_share_pct: Number(rule?.sales_share_pct ?? 0),
    is_bonus: Boolean(rule?.is_bonus),
    priority: Number(rule?.priority || 0),
    status: String(rule?.status || 'active'),
    notes: String(rule?.notes || ''),
  })
  const [saving, setSaving] = useState(false)
  // Collapsed by default — who earns the commission, priority, and bonus
  // stacking are real policy decisions, but the defaults (100% to the
  // registration agent, priority 0, active, not a bonus) cover the common
  // "just add a straightforward commission rate" case without asking a
  // basic user to understand all of them up front.
  const [showAdvanced, setShowAdvanced] = useState(false)

  const save = async () => {
    if (!form.name.trim()) { toast.error('Rule name is required'); return }
    if (form.ownership_model === 'split' && Math.round(form.registration_share_pct + form.sales_share_pct) !== 100) {
      toast.error('Registration + Sales share must add up to 100%'); return
    }
    setSaving(true)
    try {
      const res = rule
        ? await window.api.commissions.rules.update(rule.id as string, form)
        : await window.api.commissions.rules.create(form)
      if (res.success) { toast.success(rule ? 'Rule updated' : 'Rule created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={rule ? 'Edit Commission Rule' : 'New Commission Rule'} size="lg" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Rule Name *</label><input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} className="input" placeholder="e.g. Electronics Category Commission" /></div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Applies To (Scope)</label>
            <select value={form.scope} onChange={e => setForm(f => ({ ...f, scope: e.target.value }))} className="input">
              <option value="global">Global — every scheme</option>
              <option value="scheme">Scheme-wise</option>
              <option value="product">Product-wise</option>
              <option value="category">Category-wise</option>
              <option value="brand">Brand-wise</option>
            </select>
          </div>
          {form.scope === 'scheme' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Scheme</label>
              <select value={form.scheme_id} onChange={e => setForm(f => ({ ...f, scheme_id: e.target.value }))} className="input">
                <option value="">— Select —</option>
                {schemes.map(s => <option key={s.id as string} value={s.id as string}>{s.scheme_number as string} — {s.name as string} ({s.branch_name as string})</option>)}
              </select>
            </div>
          )}
          {form.scope === 'product' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Product</label>
              <ProductSearchSelect
                products={products}
                value={form.product_id}
                onChange={id => setForm(f => ({ ...f, product_id: id }))}
              />
            </div>
          )}
          {form.scope === 'category' && (
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Category</label>
              <select value={form.category_id} onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))} className="input">
                <option value="">— Select —</option>
                {categories.map(c => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}
              </select>
            </div>
          )}
          {form.scope === 'brand' && (
            <div><label className="block text-xs font-medium text-slate-400 mb-1">Brand</label><input value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} className="input" placeholder="e.g. Samsung" /></div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Calculation</label>
            <select value={form.calculation_type} onChange={e => setForm(f => ({ ...f, calculation_type: e.target.value }))} className="input">
              <option value="percentage">Percentage of payment</option>
              <option value="fixed">Fixed amount</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">{form.calculation_type === 'fixed' ? 'Amount (Rs.)' : 'Rate (%)'}</label>
            <input type="number" value={form.rate} onChange={e => setForm(f => ({ ...f, rate: parseFloat(e.target.value) || 0 }))} className="input" min={0} step="0.01" />
          </div>
        </div>

        <button type="button" onClick={() => setShowAdvanced(v => !v)}
          className="flex items-center gap-1.5 text-xs font-semibold w-full pt-1" style={{ color: 'var(--brand-primary)' }}>
          {showAdvanced ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          Advanced Settings (optional — who earns it, priority, bonus stacking)
        </button>

        {showAdvanced && (
          <div className="space-y-4 rounded-lg border p-3" style={{ borderColor: 'var(--border)' }}>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Ownership Model — who earns this commission</label>
              <select value={form.ownership_model} onChange={e => setForm(f => ({ ...f, ownership_model: e.target.value }))} className="input">
                <option value="registration">Registration Agent (who enrolled the member)</option>
                <option value="sales">Sales Agent (who collected this payment)</option>
                <option value="split">Split between both</option>
              </select>
            </div>
            {form.ownership_model === 'split' && (
              <div className="grid grid-cols-2 gap-3">
                <div><label className="block text-xs font-medium text-slate-400 mb-1">Registration Share %</label><input type="number" value={form.registration_share_pct} onChange={e => setForm(f => ({ ...f, registration_share_pct: parseFloat(e.target.value) || 0 }))} className="input" min={0} max={100} /></div>
                <div><label className="block text-xs font-medium text-slate-400 mb-1">Sales Share %</label><input type="number" value={form.sales_share_pct} onChange={e => setForm(f => ({ ...f, sales_share_pct: parseFloat(e.target.value) || 0 }))} className="input" min={0} max={100} /></div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-medium text-slate-400 mb-1">Priority (higher wins if multiple base rules match)</label><input type="number" value={form.priority} onChange={e => setForm(f => ({ ...f, priority: parseInt(e.target.value) || 0 }))} className="input" min={0} /></div>
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Status</label>
                <select value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))} className="input">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>
            </div>

            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={form.is_bonus} onChange={e => setForm(f => ({ ...f, is_bonus: e.target.checked }))} className="w-4 h-4" />
              <span className="text-xs" style={{ color: 'var(--text-2)' }}>Bonus / Campaign — stacks additively on top of the one matching base rule, instead of replacing it</span>
            </label>

            <div><label className="block text-xs font-medium text-slate-400 mb-1">Notes</label><textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} className="input h-16 resize-none" /></div>
          </div>
        )}
      </div>
    </Modal>
  )
}
