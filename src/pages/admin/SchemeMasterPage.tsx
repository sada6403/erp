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
  const isSupermarket = user?.business_type === 'supermarket'

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

  const columns = isSupermarket
    ? ['Scheme', 'Frequency', 'Payment Amount', 'Duration', 'Slots (Capacity)', 'Product Value', 'Winner Option', 'Status', 'Created', '']
    : ['Scheme', 'Frequency', 'Monthly Contribution', 'Duration', 'Min. Members', 'Product Value', 'Status', 'Created', '']

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
                {columns.map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {templates.map(t => {
                const isWeekly = t.frequency === 'weekly'
                return (
                  <tr key={t.id as string} className="table-row">
                    <td className="table-cell font-medium flex items-center gap-2"><Layers size={14} className="text-slate-500" />{t.scheme_name as string}</td>
                    <td className="table-cell">
                      <span className={isWeekly ? 'badge-blue' : 'badge-gray'}>
                        {isWeekly ? 'Weekly' : 'Monthly'}
                      </span>
                    </td>
                    <td className="table-cell font-semibold text-brand-400">Rs.{money(t.monthly_contribution_amount)}</td>
                    <td className="table-cell">{Number(t.duration_months || 0)} {isWeekly ? 'week(s)' : 'month(s)'}</td>
                    <td className="table-cell">{Number(t.max_customers || t.minimum_members || 0)}</td>
                    <td className="table-cell font-semibold">Rs.{money(t.product_value)}</td>
                    {isSupermarket && (
                      <td className="table-cell text-xs">
                        {t.add_winner_paid_amount ? (
                          <span className="text-emerald-400 font-medium">Scheme + Paid</span>
                        ) : (
                          <span className="text-slate-400 font-medium">Scheme Only</span>
                        )}
                      </td>
                    )}
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
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {showForm && (
        <TemplateFormModal template={editing} isSupermarket={isSupermarket} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
    </div>
  )
}

function TemplateFormModal({ template, isSupermarket, onClose, onSave }: { template: Row | null; isSupermarket: boolean; onClose: () => void; onSave: () => void }) {
  const initialFrequency = String(template?.frequency || (isSupermarket ? 'weekly' : 'monthly'))
  const [form, setForm] = useState({
    scheme_name: String(template?.scheme_name || ''),
    frequency: initialFrequency,
    monthly_contribution_amount: Number(template?.monthly_contribution_amount || 0),
    duration_months: Number(template?.duration_months || (initialFrequency === 'weekly' ? 50 : 12)),
    minimum_members: Number(template?.minimum_members || 10),
    max_customers: Number(template?.max_customers || template?.minimum_members || 100),
    add_winner_paid_amount: template?.add_winner_paid_amount !== undefined ? Number(template.add_winner_paid_amount) : 1,
    product_value: Number(template?.product_value || 0),
  })
  const [saving, setSaving] = useState(false)
  const submittingRef = useRef(false)

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm(p => ({ ...p, [k]: e.target.type === 'number' ? parseFloat(e.target.value) || 0 : e.target.value }))

  const isWeekly = form.frequency === 'weekly'

  const save = async () => {
    if (submittingRef.current) return
    if (!form.scheme_name.trim()) { toast.error('Scheme name is required'); return }
    if (form.monthly_contribution_amount <= 0) {
      toast.error(`${isWeekly ? 'Weekly payment' : 'Monthly contribution'} amount must be greater than 0`)
      return
    }
    if (form.duration_months <= 0) {
      toast.error(`Duration (${isWeekly ? 'weeks' : 'months'}) must be greater than 0`)
      return
    }
    if (form.product_value <= 0) { toast.error('Product value must be greater than 0'); return }
    submittingRef.current = true
    setSaving(true)
    try {
      const payload = {
        ...form,
        minimum_members: Math.max(1, form.minimum_members || 1),
        max_customers: Math.max(1, form.max_customers || 100),
      }
      const res = template
        ? await window.api.chits.templates.update(template.id as string, payload)
        : await window.api.chits.templates.create(payload)
      if (res.success) { toast.success(template ? 'Scheme updated' : 'Scheme created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  const calculatedTotal = form.monthly_contribution_amount * form.duration_months
  const isMatch = calculatedTotal === form.product_value && calculatedTotal > 0

  return (
    <Modal title={template ? 'Edit SmartBuy Scheme' : 'New SmartBuy Scheme'} size="lg" onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        {/* Frequency & Scheme Name */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Payment Frequency *</label>
            <select
              value={form.frequency}
              onChange={e => {
                const freq = e.target.value
                setForm(p => ({
                  ...p,
                  frequency: freq,
                  duration_months: freq === 'weekly' ? (p.duration_months <= 12 ? 50 : p.duration_months) : (p.duration_months > 24 ? 12 : p.duration_months)
                }))
              }}
              className="input font-medium"
            >
              <option value="weekly">Weekly (Weekly Payments)</option>
              <option value="monthly">Monthly (Monthly Payments)</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Scheme Name *</label>
            <input value={form.scheme_name} onChange={f('scheme_name')} className="input" placeholder={isWeekly ? "e.g. Weekly 500 Scheme" : "e.g. SmartBuy 500"} />
          </div>
        </div>

        {/* Payment Amount & Duration */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              {isWeekly ? 'Weekly Payment (Rs.) *' : 'Monthly Contribution (Rs.) *'}
            </label>
            <NumberInput
              value={form.monthly_contribution_amount}
              onChange={e => {
                const amt = parseFloat(e.target.value) || 0
                setForm(p => {
                  const autoDur = p.product_value > 0 && amt > 0 ? Math.round(p.product_value / amt) : p.duration_months
                  return { ...p, monthly_contribution_amount: amt, duration_months: autoDur || p.duration_months }
                })
              }}
              className="input font-semibold"
              min={0}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {isWeekly ? 'Paid by each customer per week' : 'Paid by each customer per month'}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">
              {isWeekly ? 'Duration (weeks) *' : 'Duration (months) *'}
            </label>
            <NumberInput
              value={form.duration_months}
              onChange={e => {
                const dur = parseInt(e.target.value, 10) || 0
                setForm(p => {
                  const autoVal = dur > 0 && p.monthly_contribution_amount > 0 ? dur * p.monthly_contribution_amount : p.product_value
                  return { ...p, duration_months: dur, product_value: autoVal || p.product_value }
                })
              }}
              className="input font-semibold"
              min={1}
            />
            <p className="text-[11px] text-slate-500 mt-1">
              {isWeekly ? 'Total number of weekly draw cycles' : 'Total number of monthly draw cycles'}
            </p>
          </div>
        </div>

        {/* Product Value & Max Capacity */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Product Entitlement / Value (Rs.) *</label>
            <NumberInput
              value={form.product_value}
              onChange={e => {
                const val = parseFloat(e.target.value) || 0
                setForm(p => {
                  const autoDur = val > 0 && p.monthly_contribution_amount > 0 ? Math.round(val / p.monthly_contribution_amount) : p.duration_months
                  return { ...p, product_value: val, duration_months: autoDur || p.duration_months }
                })
              }}
              className="input font-semibold text-brand-400"
              min={0}
            />
            <p className="text-[11px] text-slate-500 mt-1">Total scheme value (e.g. Rs. 50,000)</p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Maximum Customers (Slots / Capacity) *</label>
            <NumberInput
              value={form.max_customers}
              onChange={e => {
                const count = parseInt(e.target.value, 10) || 0
                setForm(p => ({ ...p, max_customers: count, minimum_members: Math.min(p.minimum_members, count) || 1 }))
              }}
              className="input"
              min={1}
            />
            <p className="text-[11px] text-slate-500 mt-1">Total customer enrollment capacity limit</p>
          </div>
        </div>

        {/* Winner calculation mode */}
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Winner Calculation Method</label>
          <select
            value={form.add_winner_paid_amount}
            onChange={e => setForm(p => ({ ...p, add_winner_paid_amount: Number(e.target.value) }))}
            className="input"
          >
            <option value={1}>Scheme Value + Total Amount Paid by Winner (Recommended for Supermarket)</option>
            <option value={0}>Scheme Value Only (Standard Scheme Amount)</option>
          </select>
          <p className="text-[11px] text-slate-500 mt-1">
            {form.add_winner_paid_amount === 1
              ? 'Winning customer receives full scheme amount PLUS total installments they paid before winning'
              : 'Winning customer receives original scheme amount only'}
          </p>
        </div>

        {/* Math verification box */}
        {form.monthly_contribution_amount > 0 && form.duration_months > 0 && (
          isMatch ? (
            <div className="rounded-lg p-3 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-300">
              ✓ Verified: {isWeekly ? 'Weekly' : 'Monthly'} Rs.{form.monthly_contribution_amount.toLocaleString()} × {form.duration_months} {isWeekly ? 'weeks' : 'months'} = Rs.{form.product_value.toLocaleString()}
            </div>
          ) : (
            <div className="rounded-lg p-3 flex items-start gap-2 text-xs" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid #f59e0b' }}>
              <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
              <span style={{ color: 'var(--text-1)' }}>
                ⚠ VALUE NOTE: {isWeekly ? 'Weekly' : 'Monthly'} Payment × Duration = Rs.{calculatedTotal.toLocaleString()}, but Scheme Value = Rs.{form.product_value.toLocaleString()}. Please review before saving.
              </span>
            </div>
          )
        )}

        <p className="text-xs text-slate-500">
          These are the master template details. Smart Buy Managers will select this scheme by name when launching a new batch for their branch.
        </p>
      </div>
    </Modal>
  )
}
