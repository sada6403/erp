import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, MapPinned } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

// Region Management — the narrower geography an Agent is assigned to (e.g.
// Region "Vaddukoddai" within Zone "Jaffna"). Same simple shape as
// ZonesPage/BranchesPage: list + add/edit + active toggle, no delete.
export default function RegionsPage() {
  const [regions, setRegions] = useState<Row[]>([])
  const [zones, setZones] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const [r, z] = await Promise.all([
        window.api.regions.list({ includeInactive: true }),
        window.api.zones.list({}),
      ])
      if (r.success) setRegions(r.data as Row[])
      if (z.success) setZones(z.data as Row[])
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load regions')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (r: Row) => {
    try {
      const res = await window.api.regions.update(r.id as string, { is_active: r.is_active ? 0 : 1 })
      if (res.success) { toast.success(r.is_active ? 'Region deactivated' : 'Region activated'); load() }
      else toast.error(String(res.error || 'Failed to update region'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update region')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Region Management" subtitle={`${regions.length} region(s)`}
        actions={
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Region
          </button>
        }
      />
      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Region', 'Zone', 'Code', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : regions.length === 0 ? (
              <tr><td colSpan={5} className="text-center py-16 text-slate-500"><MapPinned size={28} className="mx-auto mb-2 opacity-40" />No regions yet — add one so Agents can be assigned to it.</td></tr>
            ) : regions.map(r => (
              <tr key={r.id as string} className="table-row">
                <td className="table-cell font-medium">{r.name as string}</td>
                <td className="table-cell text-slate-400">{(r.zone_name as string) || '—'}</td>
                <td className="table-cell font-mono text-xs text-slate-400">{(r.code as string) || '—'}</td>
                <td className="table-cell">
                  <button onClick={() => toggleActive(r)} className={r.is_active ? 'badge-green' : 'badge-gray'} title="Click to toggle active/inactive">
                    {r.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="table-cell">
                  <button onClick={() => { setEditing(r); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && (
        <RegionForm region={editing} zones={zones} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
    </div>
  )
}

function RegionForm({ region, zones, onClose, onSave }: { region: Row | null; zones: Row[]; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({
    name: String(region?.name || ''),
    code: String(region?.code || ''),
    zone_id: String(region?.zone_id || ''),
  })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.name.trim()) { toast.error('Region name is required'); return }
    setSaving(true)
    try {
      const payload = { ...form, zone_id: form.zone_id || null }
      const res = region
        ? await window.api.regions.update(region.id as string, payload)
        : await window.api.regions.create(payload)
      if (res.success) { toast.success(region ? 'Region updated' : 'Region created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={region ? 'Edit Region' : 'Add Region'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Region Name *</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input" placeholder="e.g. Vaddukoddai" autoFocus /></div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Zone</label>
          <select value={form.zone_id} onChange={e => setForm(p => ({ ...p, zone_id: e.target.value }))} className="input">
            <option value="">— Select —</option>
            {zones.map(z => <option key={z.id as string} value={z.id as string}>{z.name as string}</option>)}
          </select>
        </div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Code</label>
          <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="input" placeholder="Optional" /></div>
      </div>
    </Modal>
  )
}
