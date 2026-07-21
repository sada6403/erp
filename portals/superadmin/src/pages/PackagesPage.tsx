import { useEffect, useMemo, useState, FormEvent, type Dispatch, type SetStateAction } from 'react'
import { packages as api, features as featuresApi } from '../lib/api'
import { Plus, CheckCircle, Edit2, PowerOff, Power, SlidersHorizontal } from 'lucide-react'

type Pkg = {
  id: string
  name: string
  description: string
  monthly_price: number
  annual_price: number
  max_branches: number
  max_users: number
  max_products: number
  trial_days: number
  features: Record<string, boolean | string>
  modules: Record<string, boolean>
  is_active: boolean
  sort_order: number
}

// Mirrors MODULE_DEFINITIONS in backend/lib/catalog.ts — no plain module
// catalog endpoint exists yet (only the company-scoped one), and this list
// is small/stable, so it's kept in sync by hand like MODULE_GROUPS already
// is in CompaniesPage.tsx.
const MODULE_CATALOG: { key: string; name: string }[] = [
  { key: 'pos',             name: 'POS / Billing' },
  { key: 'inventory',       name: 'Inventory Management' },
  { key: 'customers',       name: 'Customer Management' },
  { key: 'reports_basic',   name: 'Basic Reports' },
  { key: 'installments',    name: 'Installments & Credit' },
  { key: 'multi_branch',    name: 'Multi-Branch Management' },
  { key: 'purchase_orders', name: 'Purchase Orders' },
  { key: 'deliveries',      name: 'Delivery Management' },
  { key: 'expenses',        name: 'Expense Tracking' },
  { key: 'reports_full',    name: 'Advanced Reports & Analytics' },
  { key: 'stock_transfers', name: 'Inter-Branch Stock Transfers' },
  { key: 'api_access',      name: 'API Access' },
  { key: 'white_label',     name: 'White Label' },
]

function moduleEnabled(pkg: Pkg, key: string) {
  const value = pkg.modules?.[key]
  return value === undefined ? true : Boolean(value)
}

type FeatureDef = {
  feature_key: string
  feature_name: string
  module_key: string
  group: string
  description: string
  sort_order: number
  is_active: number
}

const DEFAULT_FEATURES: Record<string, boolean> = {
  'pos.billing.create': true,
  'products.create': true,
  'products.edit': true,
  'products.barcode.print': true,
  'stock.quantity.add': true,
  'stock.transfer.create': true,
  'stock.transfer.approve': true,
  'printer.thermal': true,
  'printer.direct_print': true,
  'reports.sales.view': true,
  'reports.sales.export': true,
  'sync.cloud': true,
  'sync.offline': true,
}

function groupFeatures(features: FeatureDef[]) {
  const map = new Map<string, FeatureDef[]>()
  for (const feature of features) {
    const list = map.get(feature.group) ?? []
    list.push(feature)
    map.set(feature.group, list)
  }
  return [...map.entries()]
    .map(([group, items]) => ({ group, items: items.sort((a, b) => a.sort_order - b.sort_order) }))
    .sort((a, b) => a.group.localeCompare(b.group))
}

function featureEnabled(pkg: Pkg, key: string) {
  const value = pkg.features?.[key]
  if (value === undefined) return DEFAULT_FEATURES[key] ?? false
  return Boolean(value)
}

export default function PackagesPage() {
  const [pkgs, setPkgs] = useState<Pkg[]>([])
  const [catalog, setCatalog] = useState<FeatureDef[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<Pkg | null>(null)

  const groupedCatalog = useMemo(() => groupFeatures(catalog), [catalog])

  const load = () => api.list().then(r => setPkgs(r as Pkg[]))
  useEffect(() => {
    load()
    featuresApi.catalog().then(r => setCatalog(r as FeatureDef[])).catch(() => {})
  }, [])

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
          <p className="text-sm text-gray-400">Manage SaaS subscription tiers, limits, and feature access</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Package
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {pkgs.map(pkg => (
          <div key={pkg.id} className={`card space-y-4 relative ${!pkg.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <h3 className="font-semibold text-white">{pkg.name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{pkg.description}</p>
              </div>
              <div className="flex items-center gap-1.5 flex-shrink-0">
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
              <p className="text-2xl font-bold text-white">
                ${pkg.monthly_price}<span className="text-sm font-normal text-gray-400">/mo</span>
              </p>
              <p className="text-xs text-gray-500">
                ${pkg.annual_price}/yr · {pkg.trial_days}d trial
              </p>
            </div>

            <div className="text-xs text-gray-400 space-y-1.5">
              <div className="flex justify-between"><span>Branches</span><span className="text-white">{pkg.max_branches}</span></div>
              <div className="flex justify-between"><span>Users</span><span className="text-white">{pkg.max_users}</span></div>
              <div className="flex justify-between"><span>Products</span><span className="text-white">{pkg.max_products.toLocaleString()}</span></div>
            </div>

            <div className="border-t border-gray-800 pt-3 space-y-3">
              {groupedCatalog.slice(0, 3).map(group => (
                <div key={group.group}>
                  <p className="text-[11px] uppercase tracking-wider text-gray-500 mb-1">{group.group}</p>
                  <div className="space-y-1">
                    {group.items.slice(0, 3).map(feature => {
                      const enabled = featureEnabled(pkg, feature.feature_key)
                      return (
                        <div key={feature.feature_key} className="flex items-center gap-2 text-xs">
                          <CheckCircle className={`w-3 h-3 flex-shrink-0 ${enabled ? 'text-green-400' : 'text-gray-600'}`} />
                          <span className={enabled ? 'text-gray-300' : 'text-gray-600'}>{feature.feature_name}</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {showCreate && <CreatePackageModal catalog={catalog} onClose={() => setShowCreate(false)} onCreated={load} />}
      {showEdit && <EditPackageModal catalog={catalog} pkg={showEdit} onClose={() => setShowEdit(null)} onSaved={load} />}
    </div>
  )
}

function FeatureMatrix({
  catalog,
  features,
  setFeatures,
}: {
  catalog: FeatureDef[]
  features: Record<string, boolean>
  setFeatures: Dispatch<SetStateAction<Record<string, boolean>>>
}) {
  const grouped = groupFeatures(catalog)

  return (
    <div className="space-y-3">
      {grouped.map(group => (
        <div key={group.group}>
          <p className="text-xs font-semibold text-gray-400 mb-2">{group.group}</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {group.items.map(feature => (
              <label key={feature.feature_key} className="flex items-start gap-3 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={features[feature.feature_key] ?? true}
                  onChange={e => setFeatures(prev => ({ ...prev, [feature.feature_key]: e.target.checked }))}
                />
                <span className="min-w-0">
                  <span className="block text-sm text-white">{feature.feature_name}</span>
                  <span className="block text-xs text-gray-500">{feature.description}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function ModuleMatrix({
  modules,
  setModules,
}: {
  modules: Record<string, boolean>
  setModules: Dispatch<SetStateAction<Record<string, boolean>>>
}) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {MODULE_CATALOG.map(mod => (
        <label key={mod.key} className="flex items-center gap-3 rounded-lg border border-gray-800 bg-gray-800/30 px-3 py-2">
          <input
            type="checkbox"
            checked={modules[mod.key] ?? true}
            onChange={e => setModules(prev => ({ ...prev, [mod.key]: e.target.checked }))}
          />
          <span className="text-sm text-white">{mod.name}</span>
        </label>
      ))}
    </div>
  )
}

function CreatePackageModal({ catalog, onClose, onCreated }: { catalog: FeatureDef[]; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [description, setDesc] = useState('')
  const [monthly, setMonthly] = useState('29.99')
  const [annual, setAnnual] = useState('299.00')
  const [maxBranches, setMaxBranches] = useState('1')
  const [maxUsers, setMaxUsers] = useState('5')
  const [maxProducts, setMaxProducts] = useState('500')
  const [trialDays, setTrialDays] = useState('14')
  const [features, setFeatures] = useState<Record<string, boolean>>(DEFAULT_FEATURES)
  const [modules, setModules] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULE_CATALOG.map(m => [m.key, true])))
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!catalog.length) return
    setFeatures(prev => {
      const next = { ...prev }
      for (const feature of catalog) {
        if (next[feature.feature_key] === undefined) next[feature.feature_key] = DEFAULT_FEATURES[feature.feature_key] ?? true
      }
      return next
    })
  }, [catalog])

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await api.create({
        name,
        description,
        monthly_price: Number(monthly),
        annual_price: Number(annual),
        max_branches: Number(maxBranches),
        max_users: Number(maxUsers),
        max_products: Number(maxProducts),
        trial_days: Number(trialDays),
        features,
        modules,
      })
      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">New Package</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label">Name</label><input className="input" required value={name} onChange={e => setName(e.target.value)} /></div>
            <div><label className="label">Description</label><input className="input" value={description} onChange={e => setDesc(e.target.value)} /></div>
            <div><label className="label">Monthly Price ($)</label><input className="input" type="number" step="0.01" value={monthly} onChange={e => setMonthly(e.target.value)} /></div>
            <div><label className="label">Annual Price ($)</label><input className="input" type="number" step="0.01" value={annual} onChange={e => setAnnual(e.target.value)} /></div>
            <div><label className="label">Max Branches</label><input className="input" type="number" value={maxBranches} onChange={e => setMaxBranches(e.target.value)} /></div>
            <div><label className="label">Max Users</label><input className="input" type="number" value={maxUsers} onChange={e => setMaxUsers(e.target.value)} /></div>
            <div><label className="label">Max Products</label><input className="input" type="number" value={maxProducts} onChange={e => setMaxProducts(e.target.value)} /></div>
            <div><label className="label">Trial Days</label><input className="input" type="number" value={trialDays} onChange={e => setTrialDays(e.target.value)} /></div>
          </div>
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Feature Access
            </div>
            <FeatureMatrix catalog={catalog} features={features} setFeatures={setFeatures} />
          </div>
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Module Access
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              What this package tier actually restricts — sync/API access is blocked for a disabled
              module, not just the toggle in Feature Management.
            </p>
            <ModuleMatrix modules={modules} setModules={setModules} />
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

function EditPackageModal({ catalog, pkg, onClose, onSaved }: {
  catalog: FeatureDef[]
  pkg: Pkg
  onClose: () => void
  onSaved: () => void
}) {
  const [form, setForm] = useState({
    name: pkg.name,
    description: pkg.description || '',
    monthly_price: String(pkg.monthly_price),
    annual_price: String(pkg.annual_price),
    trial_days: String(pkg.trial_days),
    max_branches: String(pkg.max_branches),
    max_users: String(pkg.max_users),
    max_products: String(pkg.max_products),
    sort_order: String(pkg.sort_order ?? 99),
  })
  const [features, setFeatures] = useState<Record<string, boolean>>(() => {
    const next: Record<string, boolean> = { ...DEFAULT_FEATURES }
    for (const feature of catalog) {
      const current = pkg.features?.[feature.feature_key]
      next[feature.feature_key] = current === undefined ? (DEFAULT_FEATURES[feature.feature_key] ?? true) : Boolean(current)
    }
    return next
  })
  const [modules, setModules] = useState<Record<string, boolean>>(() =>
    Object.fromEntries(MODULE_CATALOG.map(m => [m.key, moduleEnabled(pkg, m.key)])))
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  const f = (k: string) => (v: string) => setForm(p => ({ ...p, [k]: v }))

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError('')
    setSaving(true)
    try {
      await api.update(pkg.id, {
        name: form.name,
        description: form.description,
        monthly_price: Number(form.monthly_price),
        annual_price: Number(form.annual_price),
        trial_days: Number(form.trial_days),
        max_branches: Number(form.max_branches),
        max_users: Number(form.max_users),
        max_products: Number(form.max_products),
        sort_order: Number(form.sort_order),
        features,
        modules,
      })
      setSaved(true)
      onSaved()
      setTimeout(() => {
        setSaved(false)
        onClose()
      }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-4xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-white">Edit Package — {pkg.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">×</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4 overflow-y-auto">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label className="label">Name</label><input className="input" required value={form.name} onChange={e => f('name')(e.target.value)} /></div>
            <div><label className="label">Description</label><input className="input" value={form.description} onChange={e => f('description')(e.target.value)} /></div>
            <div><label className="label">Monthly Price ($)</label><input className="input" type="number" step="0.01" value={form.monthly_price} onChange={e => f('monthly_price')(e.target.value)} /></div>
            <div><label className="label">Annual Price ($)</label><input className="input" type="number" step="0.01" value={form.annual_price} onChange={e => f('annual_price')(e.target.value)} /></div>
            <div><label className="label">Max Branches</label><input className="input" type="number" min="1" value={form.max_branches} onChange={e => f('max_branches')(e.target.value)} /></div>
            <div><label className="label">Max Users</label><input className="input" type="number" min="1" value={form.max_users} onChange={e => f('max_users')(e.target.value)} /></div>
            <div><label className="label">Max Products</label><input className="input" type="number" min="1" value={form.max_products} onChange={e => f('max_products')(e.target.value)} /></div>
            <div><label className="label">Trial Days</label><input className="input" type="number" min="0" value={form.trial_days} onChange={e => f('trial_days')(e.target.value)} /></div>
            <div><label className="label">Sort Order</label><input className="input" type="number" min="0" value={form.sort_order} onChange={e => f('sort_order')(e.target.value)} /></div>
          </div>
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Feature Matrix
            </div>
            <FeatureMatrix catalog={catalog} features={features} setFeatures={setFeatures} />
          </div>
          <div className="border-t border-gray-800 pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs uppercase tracking-wider text-gray-500">
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Module Access
            </div>
            <p className="text-xs text-gray-500 -mt-2">
              What this package tier actually restricts — sync/API access is blocked for a disabled
              module, not just the toggle in Feature Management.
            </p>
            <ModuleMatrix modules={modules} setModules={setModules} />
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
