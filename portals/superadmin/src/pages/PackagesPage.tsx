import { useEffect, useState, FormEvent } from 'react'
import { packages as api } from '../lib/api'
import { Plus, CheckCircle, Edit2, PowerOff, Power } from 'lucide-react'

type Pkg = {
  id: string; name: string; description: string; monthly_price: number; annual_price: number
  max_branches: number; max_users: number; max_products: number; trial_days: number
  features: Record<string, boolean | string>; is_active: boolean; sort_order: number
}

export default function PackagesPage() {
  const [pkgs, setPkgs]           = useState<Pkg[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit]   = useState<Pkg | null>(null)

  const load = () => api.list().then(r => setPkgs(r as Pkg[]))
  useEffect(() => { load() }, [])

  async function toggleActive(pkg: Pkg) {
    const action = pkg.is_active ? 'deactivate' : 'reactivate'
    if (!confirm(`${action.charAt(0).toUpperCase() + action.slice(1)} package "${pkg.name}"?`)) return
    await api.update(pkg.id, { is_active: !pkg.is_active })
    load()
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Packages</h1>
          <p className="text-sm text-gray-400">Manage SaaS subscription tiers</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Package
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {pkgs.map(pkg => (
          <div key={pkg.id} className={`card space-y-4 relative ${!pkg.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-white">{pkg.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{pkg.description}</p>
              </div>
              <div className="flex items-center gap-1.5">
                <span className={pkg.is_active ? 'badge-green' : 'badge-red'}>
                  {pkg.is_active ? 'Active' : 'Inactive'}
                </span>
                <button title="Edit package" onClick={() => setShowEdit(pkg)}
                  className="p-1 rounded hover:bg-gray-700 text-gray-400 hover:text-white transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button
                  title={pkg.is_active ? 'Deactivate package' : 'Reactivate package'}
                  onClick={() => toggleActive(pkg)}
                  className={`p-1 rounded transition-colors ${pkg.is_active ? 'hover:bg-red-900/40 text-red-400' : 'hover:bg-green-900/40 text-green-400'}`}>
                  {pkg.is_active ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>

            <div>
              <p className="text-2xl font-bold text-white">${pkg.monthly_price}<span className="text-sm font-normal text-gray-400">/mo</span></p>
              <p className="text-xs text-gray-500">${pkg.annual_price}/yr · {pkg.trial_days}d trial</p>
            </div>

            <div className="text-xs text-gray-400 space-y-1.5">
              <div className="flex justify-between"><span>Branches</span><span className="text-white">{pkg.max_branches}</span></div>
              <div className="flex justify-between"><span>Users</span><span className="text-white">{pkg.max_users}</span></div>
              <div className="flex justify-between"><span>Products</span><span className="text-white">{pkg.max_products.toLocaleString()}</span></div>
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-1.5">
              {Object.entries(pkg.features ?? {}).map(([k, v]) => (
                <div key={k} className="flex items-center gap-2 text-xs">
                  <CheckCircle className={`w-3 h-3 flex-shrink-0 ${v ? 'text-green-400' : 'text-gray-600'}`} />
                  <span className={v ? 'text-gray-300' : 'text-gray-600'}>{k.replace(/_/g,' ')}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showCreate && <CreatePackageModal onClose={() => setShowCreate(false)} onCreated={load} />}
      {showEdit   && <EditPackageModal pkg={showEdit} onClose={() => setShowEdit(null)} onSaved={load} />}
    </div>
  )
}

function CreatePackageModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName]             = useState('')
  const [description, setDesc]      = useState('')
  const [monthly, setMonthly]       = useState('29.99')
  const [annual, setAnnual]         = useState('299.00')
  const [maxBranches, setMaxBranches] = useState('1')
  const [maxUsers, setMaxUsers]     = useState('5')
  const [maxProducts, setMaxProducts] = useState('500')
  const [trialDays, setTrialDays]   = useState('14')
  const [error, setError]           = useState('')
  const [loading, setLoading]       = useState(false)

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setLoading(true)
    try {
      await api.create({
        name, description, monthly_price: Number(monthly), annual_price: Number(annual),
        max_branches: Number(maxBranches), max_users: Number(maxUsers),
        max_products: Number(maxProducts), trial_days: Number(trialDays),
        features: { pos: true, installments: Number(maxBranches) > 1, reports: Number(maxBranches) > 1 ? 'full' : 'basic' },
      })
      onCreated(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">New Package</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}
          <div><label className="label">Name</label><input className="input" required value={name} onChange={e => setName(e.target.value)} /></div>
          <div><label className="label">Description</label><input className="input" value={description} onChange={e => setDesc(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Monthly Price ($)</label><input className="input" type="number" step="0.01" value={monthly} onChange={e => setMonthly(e.target.value)} /></div>
            <div><label className="label">Annual Price ($)</label><input className="input" type="number" step="0.01" value={annual} onChange={e => setAnnual(e.target.value)} /></div>
            <div><label className="label">Max Branches</label><input className="input" type="number" value={maxBranches} onChange={e => setMaxBranches(e.target.value)} /></div>
            <div><label className="label">Max Users</label><input className="input" type="number" value={maxUsers} onChange={e => setMaxUsers(e.target.value)} /></div>
            <div><label className="label">Max Products</label><input className="input" type="number" value={maxProducts} onChange={e => setMaxProducts(e.target.value)} /></div>
            <div><label className="label">Trial Days</label><input className="input" type="number" value={trialDays} onChange={e => setTrialDays(e.target.value)} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={loading}>{loading ? 'Creating…' : 'Create'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

function EditPackageModal({ pkg, onClose, onSaved }: {
  pkg: Pkg; onClose: () => void; onSaved: () => void
}) {
  const [form, setForm] = useState({
    name:          pkg.name,
    description:   pkg.description || '',
    monthly_price: String(pkg.monthly_price),
    annual_price:  String(pkg.annual_price),
    trial_days:    String(pkg.trial_days),
    max_branches:  String(pkg.max_branches),
    max_users:     String(pkg.max_users),
    max_products:  String(pkg.max_products),
    sort_order:    String(pkg.sort_order ?? 99),
  })
  const [error,   setError]   = useState('')
  const [saving,  setSaving]  = useState(false)
  const [saved,   setSaved]   = useState(false)

  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault(); setError(''); setSaving(true)
    try {
      await api.update(pkg.id, {
        name:          form.name,
        description:   form.description,
        monthly_price: Number(form.monthly_price),
        annual_price:  Number(form.annual_price),
        trial_days:    Number(form.trial_days),
        max_branches:  Number(form.max_branches),
        max_users:     Number(form.max_users),
        max_products:  Number(form.max_products),
        sort_order:    Number(form.sort_order),
      })
      setSaved(true); onSaved()
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-white">Edit Package — {pkg.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}
          <div><label className="label">Name</label><input className="input" required value={form.name} onChange={e => f('name')(e.target.value)} /></div>
          <div><label className="label">Description</label><input className="input" value={form.description} onChange={e => f('description')(e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Monthly Price ($)</label><input className="input" type="number" step="0.01" value={form.monthly_price} onChange={e => f('monthly_price')(e.target.value)} /></div>
            <div><label className="label">Annual Price ($)</label><input className="input" type="number" step="0.01" value={form.annual_price} onChange={e => f('annual_price')(e.target.value)} /></div>
            <div><label className="label">Max Branches</label><input className="input" type="number" min="1" value={form.max_branches} onChange={e => f('max_branches')(e.target.value)} /></div>
            <div><label className="label">Max Users</label><input className="input" type="number" min="1" value={form.max_users} onChange={e => f('max_users')(e.target.value)} /></div>
            <div><label className="label">Max Products</label><input className="input" type="number" min="1" value={form.max_products} onChange={e => f('max_products')(e.target.value)} /></div>
            <div><label className="label">Trial Days</label><input className="input" type="number" min="0" value={form.trial_days} onChange={e => f('trial_days')(e.target.value)} /></div>
            <div><label className="label">Sort Order</label><input className="input" type="number" min="0" value={form.sort_order} onChange={e => f('sort_order')(e.target.value)} /></div>
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1" disabled={saving}>
              {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
