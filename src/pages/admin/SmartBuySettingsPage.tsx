import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

// Admin Configuration Module — company-wide Smart Buy defaults. Every field
// here only pre-fills the "New Smart Buy Scheme" form; each scheme can
// still override its own minimum members, late fee, repayment duration,
// etc. at creation. Stored in the same app_settings key-value store as the
// rest of the app's Settings page (window.api.settings.get/update) — no
// parallel config system.
export default function SmartBuySettingsPage() {
  const [form, setForm] = useState({
    smartbuy_default_min_members: 50,
    smartbuy_default_late_payment_days: 5,
    smartbuy_default_late_fee_amount: 0,
    smartbuy_default_repayment_months: 12,
    smartbuy_enforce_registration_lock: true,
    smartbuy_allow_agent_scheme_requests: false,
  })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    window.api.settings.get().then((res: { success: boolean; data?: Row }) => {
      if (res.success && res.data) {
        setForm(f => ({
          smartbuy_default_min_members: Number(res.data!.smartbuy_default_min_members ?? f.smartbuy_default_min_members),
          smartbuy_default_late_payment_days: Number(res.data!.smartbuy_default_late_payment_days ?? f.smartbuy_default_late_payment_days),
          smartbuy_default_late_fee_amount: Number(res.data!.smartbuy_default_late_fee_amount ?? f.smartbuy_default_late_fee_amount),
          smartbuy_default_repayment_months: Number(res.data!.smartbuy_default_repayment_months ?? f.smartbuy_default_repayment_months),
          smartbuy_enforce_registration_lock: res.data!.smartbuy_enforce_registration_lock !== false,
          smartbuy_allow_agent_scheme_requests: Boolean(res.data!.smartbuy_allow_agent_scheme_requests),
        }))
      } else if (!res.success) {
        toast.error('Failed to load settings')
      }
    }).catch(() => toast.error('Failed to load settings')).finally(() => setLoading(false))
  }, [])

  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.settings.update(form)
      if (res.success) toast.success('Smart Buy defaults saved')
      else toast.error(String(res.error || 'Failed to save'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to save')
    } finally {
      setSaving(false)
    }
  }

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))

  if (loading) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>Loading...</div>
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy — Admin Configuration" subtitle="Company-wide defaults for new schemes. Nothing here is hardcoded — every value is overridable per scheme."
        actions={<button onClick={save} disabled={saving} className="btn-primary btn-sm">{saving ? 'Saving...' : 'Save Defaults'}</button>}
      />

      <div className="flex-1 overflow-auto p-6 max-w-2xl space-y-6">
        <div className="card space-y-4">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Minimum Members</h3>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Default Minimum Members to Activate</label>
            <input type="number" value={form.smartbuy_default_min_members} onChange={num('smartbuy_default_min_members')} className="input" min={1} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>A scheme stays "Pending" — no draws, no first-installment collection — until enrolled members reach this number, unless overridden at creation.</p>
          </div>
        </div>

        <div className="card space-y-4">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Late Payment Rules</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Grace Period (days into the month)</label>
              <input type="number" value={form.smartbuy_default_late_payment_days} onChange={num('smartbuy_default_late_payment_days')} className="input" min={0} />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Late Fee (Rs.)</label>
              <input type="number" value={form.smartbuy_default_late_fee_amount} onChange={num('smartbuy_default_late_fee_amount')} className="input" min={0} />
            </div>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>A cycle contribution recorded after this day of the month automatically adds the late fee on top. Set grace days to 0 to disable by default.</p>
        </div>

        <div className="card space-y-4">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Repayment</h3>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Default Repayment Duration (months)</label>
            <input type="number" value={form.smartbuy_default_repayment_months} onChange={num('smartbuy_default_repayment_months')} className="input" min={1} />
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>How long a winner has to repay the balance between their product's value and what they'd already contributed.</p>
          </div>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Registration Lock</h3>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.smartbuy_enforce_registration_lock}
              onChange={e => setForm(f => ({ ...f, smartbuy_enforce_registration_lock: e.target.checked }))} className="w-4 h-4" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Enforce each scheme's Registration Opens / Closes dates</span>
          </label>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>When on, new-member enrollment is rejected outside a scheme's registration window (set per scheme). Turn off to allow enrollment any time regardless of those dates.</p>
        </div>

        <div className="card space-y-3">
          <h3 className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>Agent Permissions</h3>
          <label className="flex items-center gap-2 cursor-not-allowed opacity-60">
            <input type="checkbox" checked={form.smartbuy_allow_agent_scheme_requests} disabled className="w-4 h-4" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Allow Agents to request new schemes for Super Admin approval</span>
          </label>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>Reserved for a future phase — Agents cannot create or request schemes yet; every scheme must be created by a Branch Manager or Super Admin.</p>
        </div>
      </div>
    </div>
  )
}
