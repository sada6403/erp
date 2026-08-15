import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Edit2, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

// Zone Management — the broader geographic grouping an agent's Region sits
// under (e.g. Region "Vaddukoddai" belongs to Zone "Jaffna"). Deliberately
// simple, mirroring BranchesPage's shape: list + add/edit + active toggle,
// no delete — an existing agent's region.zone_id must never dangle.
export default function ZonesPage() {
  const [zones, setZones] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<Row | null>(null)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.zones.list({ includeInactive: true })
      if (res.success) setZones(res.data as Row[])
      else toast.error(String(res.error || 'Failed to load zones'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load zones')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const toggleActive = async (z: Row) => {
    try {
      const res = await window.api.zones.update(z.id as string, { is_active: z.is_active ? 0 : 1 })
      if (res.success) { toast.success(z.is_active ? 'Zone deactivated' : 'Zone activated'); load() }
      else toast.error(String(res.error || 'Failed to update zone'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to update zone')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Zone Management" subtitle={`${zones.length} zone(s)`}
        actions={
          <button onClick={() => { setEditing(null); setShowForm(true) }} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Add Zone
          </button>
        }
      />
      <div className="flex-1 overflow-auto px-6 pb-6 pt-4">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Zone', 'Code', 'Status', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={4} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : zones.length === 0 ? (
              <tr><td colSpan={4} className="text-center py-16 text-slate-500"><MapPin size={28} className="mx-auto mb-2 opacity-40" />No zones yet — add one so Regions can be grouped under it.</td></tr>
            ) : zones.map(z => (
              <tr key={z.id as string} className="table-row">
                <td className="table-cell font-medium">{z.name as string}</td>
                <td className="table-cell font-mono text-xs text-slate-400">{(z.code as string) || '—'}</td>
                <td className="table-cell">
                  <button onClick={() => toggleActive(z)} className={z.is_active ? 'badge-green' : 'badge-gray'} title="Click to toggle active/inactive">
                    {z.is_active ? 'Active' : 'Inactive'}
                  </button>
                </td>
                <td className="table-cell">
                  <button onClick={() => { setEditing(z); setShowForm(true) }} className="btn-ghost btn-sm p-1.5" title="Edit"><Edit2 size={13} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {showForm && (
        <ZoneForm zone={editing} onClose={() => setShowForm(false)} onSave={() => { setShowForm(false); load() }} />
      )}
    </div>
  )
}

function ZoneForm({ zone, onClose, onSave }: { zone: Row | null; onClose: () => void; onSave: () => void }) {
  const [form, setForm] = useState({ name: String(zone?.name || ''), code: String(zone?.code || '') })
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (!form.name.trim()) { toast.error('Zone name is required'); return }
    setSaving(true)
    try {
      const res = zone
        ? await window.api.zones.update(zone.id as string, form)
        : await window.api.zones.create(form)
      if (res.success) { toast.success(zone ? 'Zone updated' : 'Zone created'); onSave() }
      else toast.error(String(res.error || 'Save failed'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal title={zone ? 'Edit Zone' : 'Add Zone'} onClose={onClose}
      footer={<><button onClick={onClose} className="btn-secondary">Cancel</button><button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Saving...' : 'Save'}</button></>}>
      <div className="space-y-4">
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Zone Name *</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} className="input" placeholder="e.g. Jaffna" autoFocus /></div>
        <div><label className="block text-xs font-medium text-slate-400 mb-1">Code</label>
          <input value={form.code} onChange={e => setForm(p => ({ ...p, code: e.target.value }))} className="input" placeholder="Optional" /></div>
      </div>
    </Modal>
  )
}
