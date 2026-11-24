import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'

export default function StoreSettingsTab() {
  const [s, setS] = useState<Record<string, string> | null>(null)
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    window.api.onlineStore.settingsGet()
      .then((r: any) => { if (r.success) setS(r.data); else toast.error(r.error || 'Failed to load settings') })
      .catch((err: unknown) => toast.error('Failed to load settings: ' + String(err)))
  }, [])
  if (!s) return <p className="p-6 text-slate-500 text-sm">Loading…</p>
  const set = (k: string, v: string) => setS({ ...s, [k]: v })
  const save = async () => {
    setSaving(true)
    try {
      const res = await window.api.onlineStore.settingsSave(s)
      if (res.success) toast.success('Saved. Changes reach the app after the next sync.'); else toast.error(res.error)
    } catch (err) {
      toast.error('Failed to save: ' + String(err))
    } finally { setSaving(false) }
  }
  const ordering = s.ordering_enabled === '1'
  return <div className="p-6 max-w-2xl space-y-5">
    <div className="flex items-center justify-between rounded-lg bg-surface-800 p-4">
      <div><p className="font-medium">Accept orders from the app</p><p className="text-xs text-slate-500">Turn off to stop new app orders (browsing still works).</p></div>
      <button className={ordering ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'} onClick={() => set('ordering_enabled', ordering ? '0' : '1')}>{ordering ? 'Ordering ON' : 'Ordering OFF'}</button>
    </div>
    <div><label className="text-xs text-slate-400">Maintenance message (shown in the app when ordering is off)</label>
      <textarea className="input mt-1" rows={2} maxLength={500} value={s.maintenance_message} onChange={e => set('maintenance_message', e.target.value)} /></div>
    <div className="grid grid-cols-2 gap-3">
      <div><label className="text-xs text-slate-400">Delivery fee (Rs.)</label>
        <input className="input mt-1" type="number" min={0} value={s.delivery_flat_fee} onChange={e => set('delivery_flat_fee', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Free delivery over (Rs., blank = never)</label>
        <input className="input mt-1" type="number" min={0} value={s.delivery_free_over} onChange={e => set('delivery_free_over', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Minimum app version</label>
        <input className="input mt-1" placeholder="1.0.0" value={s.min_app_version} onChange={e => set('min_app_version', e.target.value)} />
        <p className="text-xs text-slate-500 mt-1">Older versions are asked to update before they can continue.</p></div>
      <div><label className="text-xs text-slate-400">App download link (used in invites)</label>
        <input className="input mt-1" placeholder="https://" value={s.download_link} onChange={e => set('download_link', e.target.value)} /></div>
    </div>
    <button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save settings'}</button>
    <DeliveryTimeSection />
  </div>
}

interface EtaBranch { id: string; name: string; min_days: string; max_days: string; text: string }

function DeliveryTimeSection() {
  const [rows, setRows] = useState<EtaBranch[]>([])
  const [busy, setBusy] = useState('')
  const load = useCallback(async () => {
    try {
      const r = await window.api.onlineStore.deliveryList()
      if (r.success) setRows(r.data.map((b: any) => ({ id: b.id, name: b.name, min_days: b.delivery_eta_min_days ?? '', max_days: b.delivery_eta_max_days ?? '', text: b.delivery_eta_text ?? '' })))
      else toast.error(r.error || 'Failed to load delivery times')
    } catch (err) { toast.error('Failed to load delivery times: ' + String(err)) }
  }, [])
  useEffect(() => { void load() }, [load])
  const edit = (id: string, k: 'min_days' | 'max_days' | 'text', v: string) => setRows(rows.map(r => r.id === id ? { ...r, [k]: v } : r))
  const save = async (r: EtaBranch) => {
    setBusy(r.id)
    try {
      const res = await window.api.onlineStore.deliverySave(r.id, { min_days: r.min_days, max_days: r.max_days, text: r.text })
      if (res.success) { toast.success(`Delivery time saved for ${r.name}`); void load() } else toast.error(res.error)
    } catch (err) { toast.error('Failed to save: ' + String(err)) } finally { setBusy('') }
  }
  return <div className="rounded-lg bg-surface-800 p-4 space-y-3">
    <div><p className="font-medium">Delivery time</p>
      <p className="text-xs text-slate-500">Shown on the product page in the app. Leave a branch empty to show nothing. The text, when set, is shown instead of the days.</p></div>
    {rows.map(r => <div key={r.id} className="grid grid-cols-[1fr_5rem_5rem_1.5fr_auto] gap-2 items-end">
      <p className="text-sm truncate" title={r.name}>{r.name}</p>
      <div><label className="text-xs text-slate-400">Min days</label>
        <input className="input mt-1" type="number" min={0} max={90} value={r.min_days} onChange={e => edit(r.id, 'min_days', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Max days</label>
        <input className="input mt-1" type="number" min={0} max={90} value={r.max_days} onChange={e => edit(r.id, 'max_days', e.target.value)} /></div>
      <div><label className="text-xs text-slate-400">Text (optional)</label>
        <input className="input mt-1" maxLength={120} placeholder="e.g. Colombo 1-2 days" value={r.text} onChange={e => edit(r.id, 'text', e.target.value)} /></div>
      <button className="btn-primary btn-sm" disabled={busy === r.id} onClick={() => save(r)}>{busy === r.id ? 'Saving…' : 'Save'}</button>
    </div>)}
    {!rows.length && <p className="text-xs text-slate-500">No active branches.</p>}
  </div>
}
