import { useEffect, useRef, useState } from 'react'
import NumberInput from '@/components/shared/NumberInput'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Pencil, Power, PowerOff, Layers, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Row = Record<string, unknown>

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// The SmartBuy Scheme Master — the reusable named catalog ("SmartBuy 500",
// "SmartBuy Premium", ...) that a Smart Buy Manager picks from by dropdown
// wherever they start a new scheme, instead of typing the contribution
// amount / duration / member count by hand.
// Route is gated by RequireSmartBuyAccess (chits∨all) in App.tsx — any
// chits user may view this catalog, matching what the backend already
// allowed (chits:templates:list -> canManage = chits∨all). Only
// create/update require Super Admin (chits:templates:create/update ->
// isGlobalChitAccess = all-only), enforced server-side regardless of what
// the UI shows, and mirrored here client-side (isSuperAdmin) so a chits-only
// viewer sees a real read-only catalog instead of buttons that would just
// fail on click.
export default function SchemeMasterPage() {
  const { user } = useAuthStore()
  const permissions = ((user?.role as unknown as Row)?.permissions as Row) || {}
  const isSuperAdmin = Boolean(permissions.all)

  const [templates, setTemplates] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.chits.templates.list({ status: 'all' })
      if (res.success) setTemplates(res.data as Row[])
      else toast.error(String(res.error || 'Failed to load SmartBuy schemes'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load SmartBuy schemes')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleStatus = async (t: Row) => {
    const nextStatus = t.status === 'active' ? 'inactive' : 'active'
    try {
      const res = await window.api.chits.templates.update(t.id as string, { status: nextStatus })
      if (res.success) { toast.success(`"${t.scheme_name}" marked ${nextStatus}`); load() }
      else toast.error(String(res.error || 'Failed to update status'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update status')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="SmartBuy Scheme Master" subtitle={`${templates.length} scheme(s) — the catalog Smart Buy Managers select from, they never type these details`}
        actions={isSuperAdmin ? (
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New Scheme
          </button>
        ) : null}
      />

      <div className="flex-1 overflow-auto px-6 pb-6">
        {loading ? (
          <p className="text-center py-16 text-slate-500">Loading...</p>
        ) : templates.length === 0 ? (
          <p className="text-center py-16 text-slate-500">No SmartBuy schemes yet — create one so Smart Buy Managers have something to select.</p>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Scheme', 'Monthly Contribution', 'Duration', 'Min. Members', 'Product Value', 'Status', 'Created', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map(t => (
                <tr key={t.id as string} className="table-row">
                  <td className="table-cell font-medium flex items-center gap-2"><Layers size={14} className="text-slate-500" />{t.scheme_name as string}</td>
                  <td className="table-cell">Rs.{money(t.monthly_contribution_amount)}</td>
                  <td className="table-cell">{Number(t.duration_months || 0)} month(s)</td>
                  <td className="table-cell">{Number(t.minimum_members || 0)}</td>
                  <td className="table-cell">Rs.{money(t.product_value)}</td>
                  <td className="table-cell">
                    <span className={t.status === 'active' ? 'badge-green' : 'badge-gray'}>{t.status as string}</span>
                  </td>
                  <td className="table-cell text-slate-400 text-xs">{t.created_at ? new Date(String(t.created_at)).toLocaleDateString() : '—'}</td>
                  <td className="table-cell">
                    {isSuperAdmin ? (
                      <div className="flex gap-1">
                        <button onClick={() => { setEditing(t); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Pencil size={13} /></button>
                        <button
                          onClick={() => toggleStatus(t)}
                          className="btn-ghost btn-sm p-1.5"
                          title={t.status === 'active' ? 'Mark Inactive' : 'Mark Active'}
                        >
                          {t.status === 'active' ? <PowerOff size={13} /> : <Power size={13} />}
                        </button>
                      </div>
                    ) : (
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>View only</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <TemplateFormModal template={editing} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
    </div>
  )
}

function TemplateFormModal({ template, onClose, onSave }: { template: Row | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    scheme_name: String(template?.scheme_name || ''),
    monthly_contribution_amount: Number(template?.monthly_contribution_amount || 0),
    duration_months: Number(template?.duration_months || 12),
    minimum_members: Number(template?.minimum_members || 50),
    product_value: Number(template?.product_value || 0),
  })
  const [saving, setSaving] = useState(false)
  // A plain ref, not just the `saving` state, guards against a double-
  // click creating two duplicate templates in the catalog — React state
  // updates aren't guaranteed to reflect in the DOM (disabling the button)
  // before a second, near-simultaneous click event is dispatched.
  const submittingRef = useRef(false)

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const save = async () => {
    if (submittingRef.current) return
    if (!form.scheme_name.trim()) { toast.error('Scheme name is required'); return }
    if (form.monthly_contribution_amount <= 0) { toast.error('Monthly contribution amount must be greater than 0'); return }
    if (form.duration_months <= 0) { toast.error('Duration (months) must be greater than 0'); return }
    if (form.minimum_members <= 0) { toast.error('Minimum members must be greater than 0'); return }
    if (form.product_value <= 0) { toast.error('Product value must be greater than 0'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const res = template
        ? await window.api.chits.templates.update(template.id as string, form)
        : await window.api.chits.templates.create(form)
      if (res.success) { toast.success(template ? 'Scheme updated' : 'Scheme created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  return (
    <Modal title={template ? 'Edit SmartBuy Scheme' : 'New SmartBuy Scheme'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Scheme Name *</label>
          <input value={form.scheme_name} onChange={f('scheme_name')} className="input" placeholder="e.g. SmartBuy 500" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Monthly Contribution (Rs.) *</label><NumberInput value={form.monthly_contribution_amount} onChange={f('monthly_contribution_amount')} className="input" min={0} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Duration (months) *</label><NumberInput value={form.duration_months} onChange={f('duration_months')} className="input" min={1} /></div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Minimum Members *</label><NumberInput value={form.minimum_members} onChange={f('minimum_members')} className="input" min={1} /></div>
          <div><label className="block text-xs font-medium text-slate-400 mb-1">Product Value (Rs.) *</label><NumberInput value={form.product_value} onChange={f('product_value')} className="input" min={0} /></div>
        </div>
        {form.monthly_contribution_amount * form.duration_months !== form.product_value && form.monthly_contribution_amount > 0 && form.duration_months > 0 && form.product_value > 0 && (
          <div className="rounded-lg p-3 flex items-start gap-2 text-xs" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid #f59e0b' }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
            <span style={{ color: 'var(--text-1)' }}>
              ⚠ VALUE MISMATCH — Monthly Payment × Duration = Rs.{(form.monthly_contribution_amount * form.duration_months).toLocaleString()}, but Product Entitlement = Rs.{form.product_value.toLocaleString()}. Please review before saving.
            </span>
          </div>
        )}
        <p className="text-xs text-slate-500">
          These are the only details a Smart Buy Manager ever sees for this scheme — they select it by name and everything above comes along locked. Branch, product, agent, and start date are still chosen per batch when a Manager starts a new scheme.
        </p>
      </div>
    </Modal>
  )
}
