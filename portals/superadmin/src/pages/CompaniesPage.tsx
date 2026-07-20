import React, { useEffect, useState, FormEvent } from 'react'
import { companies as api, packages as pkgApi, modules as modulesApi, features as featuresApi, companyLimits as limitsApi, devices as devicesApi, backups as backupsApi, type BackupRow, type BackupSchedule, impersonate as impersonateApi, settings as settingsApi, audit as auditApi } from '../lib/api'
import { Plus, Search, RefreshCw, Ban, CheckCircle, Trash2, Key, Copy, GitBranch, Users, Monitor, LayoutGrid, Smartphone, Palette, ShieldCheck, Edit2, CalendarClock, Sliders, LogIn, Eye, EyeOff, AlertTriangle, KeyRound, Settings2, FileText, BadgeInfo, Database, Download, RotateCcw } from 'lucide-react'

type Company = Record<string, string>
type Pkg = { id: string; name: string }

const STATUS_BADGE: Record<string, string> = {
  active: 'badge-green', trial: 'badge-yellow',
  suspended: 'badge-red', cancelled: 'bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-xs',
}

export default function CompaniesPage() {
  const [rows, setRows]         = useState<Company[]>([])
  const [total, setTotal]       = useState(0)
  const [page, setPage]         = useState(1)
  const [search, setSearch]     = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [loading, setLoading]   = useState(false)
  const [pkgs, setPkgs]         = useState<Pkg[]>([])
  const [showCreate, setShowCreate] = useState(false)
  const [showEdit, setShowEdit] = useState<Company | null>(null)
  const [showDelete, setShowDelete] = useState<Company | null>(null)
  const [showResetPw, setShowResetPw] = useState<Company | null>(null)
  const [showImpersonate, setShowImpersonate] = useState<Company | null>(null)
  const [showApiKey, setShowApiKey] = useState<Company | null>(null)
  const [showCapabilities, setShowCapabilities] = useState<Company | null>(null)
  const [showDevices, setShowDevices] = useState<Company | null>(null)
  const [showBackups, setShowBackups] = useState<Company | null>(null)
  const [showBranding, setShowBranding] = useState<Company | null>(null)
  const [showCompanyKey, setShowCompanyKey] = useState<Company | null>(null)
  const [error, setError] = useState('')

  const limit = 20

  async function load() {
    setLoading(true)
    setError('')
    try {
      const q: Record<string,string> = { page: String(page), limit: String(limit) }
      if (search)       q.search = search
      if (statusFilter) q.status = statusFilter
      const d = await api.list(q) as { rows: Company[]; total: number }
      setRows(d.rows); setTotal(d.total)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load companies')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [page, statusFilter])
  useEffect(() => { pkgApi.list().then(r => setPkgs(r as Pkg[])) }, [])

  async function changeStatus(id: string, status: string) {
    if (status === 'suspended') {
      const reason = window.prompt('Reason for suspending this company (required — shown in audit log & on their POS lock screen):')
      if (reason === null) return // cancelled
      if (!reason.trim()) { alert('A reason is required to suspend a company.'); return }
      if (!confirm(`Suspend this company now?\n\nReason: ${reason.trim()}`)) return
      await api.update(id, { status, suspensionReason: reason.trim() })
    } else {
      if (!confirm(`Set company to ${status}?`)) return
      await api.update(id, { status })
    }
    load()
  }


  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-white">Companies</h1>
          <p className="text-sm text-gray-400">{total} total tenants</p>
        </div>
        <button className="btn-primary flex items-center gap-2" onClick={() => setShowCreate(true)}>
          <Plus className="w-4 h-4" /> New Company
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input className="input pl-9" placeholder="Search name, email, slug…" value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && (setPage(1), load())} />
        </div>
        <select className="input w-40" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}>
          <option value="">All statuses</option>
          <option value="trial">Trial</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <button className="btn-ghost flex items-center gap-2" onClick={load}>
          <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* Table */}
      <div className="card p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="border-b border-gray-800">
            <tr>
              {['Company','Slug','Email','Package','Limits','Status','Trial / Sub ends','Actions'].map(h => (
                <th key={h} className="text-left text-gray-400 font-medium px-4 py-3">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(c => (
              <tr key={c.id} className="border-b border-gray-800/50 hover:bg-gray-800/20">
                <td className="px-4 py-3 font-medium text-white">{c.name}</td>
                <td className="px-4 py-3 text-gray-400 font-mono text-xs">{c.slug}</td>
                <td className="px-4 py-3 text-gray-400">{c.email}</td>
                <td className="px-4 py-3 text-gray-400">{c.package_name ?? '—'}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 text-xs text-gray-400">
                    <span className="flex items-center gap-0.5" title="Max Branches">
                      <GitBranch className="w-3 h-3" />{c.max_branches ?? 1}
                    </span>
                    <span className="flex items-center gap-0.5" title="Max Users">
                      <Users className="w-3 h-3" />{c.max_users ?? 5}
                    </span>
                    <span className="flex items-center gap-0.5" title="Max POS Devices">
                      <Monitor className="w-3 h-3" />{c.max_pos_devices ?? 2}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3">
                  <span className={STATUS_BADGE[c.status] ?? ''}
                    title={c.status === 'suspended' && c.suspension_reason ? `Reason: ${c.suspension_reason}` : undefined}>
                    {c.status}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs">
                  {c.sub_ends_at ? new Date(c.sub_ends_at).toLocaleDateString() : '—'}
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-1.5">
                    <button title="Login as Company Admin (Impersonate)" className="p-1.5 rounded hover:bg-orange-900/40 text-orange-400"
                      onClick={() => setShowImpersonate(c)}>
                      <LogIn className="w-3.5 h-3.5" />
                    </button>
                    <button title="Edit Company (Info / Limits / Subscription)" className="p-1.5 rounded hover:bg-gray-700/60 text-gray-300"
                      onClick={() => setShowEdit(c)}>
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button title="Company Activation Key" className="p-1.5 rounded hover:bg-emerald-900/40 text-emerald-400"
                      onClick={() => setShowCompanyKey(c)}>
                      <ShieldCheck className="w-3.5 h-3.5" />
                    </button>
                    <button title="POS Devices" className="p-1.5 rounded hover:bg-cyan-900/40 text-cyan-400"
                      onClick={() => setShowDevices(c)}>
                      <Smartphone className="w-3.5 h-3.5" />
                    </button>
                    <button title="Backups" className="p-1.5 rounded hover:bg-teal-900/40 text-teal-400"
                      onClick={() => setShowBackups(c)}>
                      <Database className="w-3.5 h-3.5" />
                    </button>
                    <button title="Branding (logo & color)" className="p-1.5 rounded hover:bg-pink-900/40 text-pink-400"
                      onClick={() => setShowBranding(c)}>
                      <Palette className="w-3.5 h-3.5" />
                    </button>
                    <button title="Feature Management & Capabilities" className="p-1.5 rounded hover:bg-slate-900/40 text-slate-300"
                      onClick={() => setShowCapabilities(c)}>
                      <Settings2 className="w-3.5 h-3.5" />
                    </button>
                    <button title="POS API Key (for Electron app)" className="p-1.5 rounded hover:bg-purple-900/40 text-purple-400"
                      onClick={() => setShowApiKey(c)}>
                      <Key className="w-3.5 h-3.5" />
                    </button>

                    {c.status !== 'active' && (
                      <button title="Activate" className="p-1.5 rounded hover:bg-green-900/40 text-green-400"
                        onClick={() => changeStatus(c.id, 'active')}>
                        <CheckCircle className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {c.status === 'active' && (
                      <button title="Suspend" className="p-1.5 rounded hover:bg-yellow-900/40 text-yellow-400"
                        onClick={() => changeStatus(c.id, 'suspended')}>
                        <Ban className="w-3.5 h-3.5" />
                      </button>
                    )}
                    <button title="Reset Company Admin Password" className="p-1.5 rounded hover:bg-amber-900/40 text-amber-400"
                      onClick={() => setShowResetPw(c)}>
                      <KeyRound className="w-3.5 h-3.5" />
                    </button>
                    <button title="Permanently Delete Company + All Data" className="p-1.5 rounded hover:bg-red-900/60 text-red-500"
                      onClick={() => setShowDelete(c)}>
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && !loading && !error && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-500">No companies found</td></tr>
            )}
            {error && (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-red-400">{error}</td></tr>
            )}
          </tbody>
        </table>

        {/* Pagination */}
        {total > limit && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-800">
            <span className="text-xs text-gray-500">
              {(page-1)*limit+1}–{Math.min(page*limit, total)} of {total}
            </span>
            <div className="flex gap-2">
              <button className="btn-ghost text-xs py-1 px-2" disabled={page===1}
                onClick={() => setPage(p => p-1)}>Prev</button>
              <button className="btn-ghost text-xs py-1 px-2" disabled={page*limit>=total}
                onClick={() => setPage(p => p+1)}>Next</button>
            </div>
          </div>
        )}
      </div>

      {showCreate && <CreateCompanyModal pkgs={pkgs} onClose={() => setShowCreate(false)} onCreated={load} />}
      {showEdit && <EditCompanyModal company={showEdit} pkgs={pkgs} onClose={() => setShowEdit(null)} onSaved={load} />}
      {showDelete && <DeleteCompanyModal company={showDelete} onClose={() => setShowDelete(null)} onDeleted={load} />}
      {showResetPw && <ResetAdminPasswordModal company={showResetPw} onClose={() => setShowResetPw(null)} />}
      {showImpersonate && <ImpersonateModal company={showImpersonate} onClose={() => setShowImpersonate(null)} />}

      {showApiKey && <ApiKeyModal company={showApiKey} onClose={() => setShowApiKey(null)} onRegenerated={load} />}
      {showCapabilities && <CompanyCapabilitiesModal company={showCapabilities} onClose={() => setShowCapabilities(null)} onSaved={load} />}
      {showDevices && <DevicesModal company={showDevices} onClose={() => setShowDevices(null)} />}
      {showBackups && <BackupsModal company={showBackups} onClose={() => setShowBackups(null)} />}
      {showBranding && <BrandingModal company={showBranding} onClose={() => setShowBranding(null)} onSaved={load} />}
      {showCompanyKey && <CompanyKeyModal company={showCompanyKey} onClose={() => setShowCompanyKey(null)} onUpdated={load} />}
    </div>
  )
}

// ─── Create Company Modal ─────────────────────────────────────────────────────
function CreateCompanyModal({ pkgs, onClose, onCreated }: {
  pkgs: Pkg[]; onClose: () => void; onCreated: () => void
}) {
  const [form, setForm] = useState({
    name: '', email: '', phone: '', address: '',
    adminName: '', adminEmail: '', adminPhone: '',
    adminPassword: '', confirmPassword: '',
    packageId: '', trialDays: '14', timezone: 'Asia/Colombo', currency: 'LKR', country: 'LK',
    maxBranches: '1', maxUsers: '5', maxPosDevices: '2', maxStorageGb: '5',
  })
  const [showAdminPw, setShowAdminPw] = useState(false)
  const [createdInfo, setCreatedInfo] = useState<{ adminEmail: string; adminPassword: string; apiKey: string; companyKey: string; companyName: string } | null>(null)
  const [copied, setCopied] = useState<string | null>(null)

  useEffect(() => {
    settingsApi.get().then(s => {
      const d = (s.defaults ?? {}) as Record<string, string>
      if (d.trial_days || d.default_timezone || d.default_currency || d.default_country) {
        setForm(f => ({
          ...f,
          trialDays: d.trial_days        || f.trialDays,
          timezone:  d.default_timezone  || f.timezone,
          currency:  d.default_currency  || f.currency,
          country:   d.default_country   || f.country,
        }))
      }
    }).catch(() => {})
  }, [])
  const [error, setError]   = useState('')
  const [loading, setLoading] = useState(false)

  const set = (k: string, v: string) => setForm(f => ({ ...f, [k]: v }))

  function copyField(label: string, value: string) {
    navigator.clipboard.writeText(value)
    setCopied(label)
    setTimeout(() => setCopied(null), 2000)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (form.adminPassword !== form.confirmPassword) { setError('Passwords do not match'); return }
    if (form.adminPassword.length < 8) { setError('Admin password must be at least 8 characters'); return }
    setError(''); setLoading(true)
    try {
      const res = await api.create({
        ...form,
        trialDays:     Number(form.trialDays),
        packageId:     form.packageId || undefined,
        maxBranches:   Number(form.maxBranches),
        maxUsers:      Number(form.maxUsers),
        maxPosDevices: Number(form.maxPosDevices),
        maxStorageGb:  Number(form.maxStorageGb),
      }) as { apiKey: string; companyKey?: string; company_key?: string; adminEmail: string }
      onCreated()
      setCreatedInfo({
        adminEmail: res.adminEmail || form.adminEmail,
        adminPassword: form.adminPassword,
        apiKey: res.apiKey || '',
        companyKey: res.companyKey || res.company_key || '',
        companyName: form.name,
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setLoading(false)
  }

  if (createdInfo) {
    return (
      <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
        <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
            <h2 className="font-semibold text-white flex items-center gap-2">
              <CheckCircle className="w-5 h-5 text-green-400" /> Company Created
            </h2>
            <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
          </div>
          <div className="p-5 space-y-4">
            <div className="bg-green-900/20 border border-green-700/40 rounded-lg px-4 py-3 text-sm text-green-300">
              <p className="font-semibold text-green-200 mb-1">"{createdInfo.companyName}" is ready!</p>
              <p className="text-xs text-green-400/80">Share these credentials securely with the company admin. This is the only time the password is shown.</p>
            </div>

            {[
              { label: 'Admin Email', value: createdInfo.adminEmail },
              { label: 'Admin Password', value: createdInfo.adminPassword },
              { label: 'Company Activation Key', value: createdInfo.companyKey },
              { label: 'POS API Key', value: createdInfo.apiKey },
            ].map(({ label, value }) => (
              <div key={label}>
                <p className="text-xs text-gray-500 mb-1">{label}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm font-mono text-white break-all">
                    {value}
                  </code>
                  <button className="btn-ghost px-3 text-xs flex-shrink-0 flex items-center gap-1"
                    onClick={() => copyField(label, value)}>
                    <Copy className="w-3.5 h-3.5" />
                    {copied === label ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>
            ))}

            <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg px-4 py-3 text-xs text-blue-300 space-y-1">
              <p className="font-semibold text-blue-200">Next steps for the company:</p>
              <ol className="list-decimal list-inside space-y-0.5">
                <li>Download and install the POS desktop app</li>
                <li>Log in with the Admin Email + Password above</li>
                <li>Go to Settings → Cloud Sync → paste the API Key</li>
              </ol>
            </div>

            <button className="btn-primary w-full" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <h2 className="font-semibold text-white">Create New Company</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Company Name *</label><input className="input" required value={form.name} onChange={e => set('name', e.target.value)} /></div>
            <div><label className="label">Company Email *</label><input className="input" type="email" required value={form.email} onChange={e => set('email', e.target.value)} /></div>
            <div><label className="label">Phone</label><input className="input" value={form.phone} onChange={e => set('phone', e.target.value)} /></div>
            <div><label className="label">Package</label>
              <select className="input" value={form.packageId} onChange={e => set('packageId', e.target.value)}>
                <option value="">No package (trial)</option>
                {pkgs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div><label className="label">Trial Days</label><input className="input" type="number" min="1" value={form.trialDays} onChange={e => set('trialDays', e.target.value)} /></div>
            <div><label className="label">Timezone</label><input className="input" value={form.timezone} onChange={e => set('timezone', e.target.value)} /></div>
            <div><label className="label">Currency</label><input className="input" value={form.currency} onChange={e => set('currency', e.target.value)} /></div>
            <div><label className="label">Country</label><input className="input" value={form.country} onChange={e => set('country', e.target.value)} /></div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-3">Company Admin Account</p>
            <div className="grid grid-cols-2 gap-4">
              <div><label className="label">Admin Name *</label><input className="input" required value={form.adminName} onChange={e => set('adminName', e.target.value)} /></div>
              <div><label className="label">Admin Email *</label><input className="input" type="email" required value={form.adminEmail} onChange={e => set('adminEmail', e.target.value)} /></div>
              <div><label className="label">Admin Phone</label><input className="input" value={form.adminPhone} onChange={e => set('adminPhone', e.target.value)} /></div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="label">Admin Password *</label>
                <div className="relative">
                  <input className="input pr-9" type={showAdminPw ? 'text' : 'password'} required minLength={8}
                    placeholder="Min 8 characters"
                    value={form.adminPassword} onChange={e => set('adminPassword', e.target.value)} />
                  <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                    onClick={() => setShowAdminPw(p => !p)}>
                    {showAdminPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div>
                <label className="label">Confirm Password *</label>
                <input className="input" type="password" required minLength={8}
                  placeholder="Repeat password"
                  value={form.confirmPassword} onChange={e => set('confirmPassword', e.target.value)} />
                {form.confirmPassword && form.adminPassword !== form.confirmPassword && (
                  <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs font-semibold text-gray-400 uppercase mb-1">Resource Limits</p>
            <p className="text-xs text-gray-500 mb-3">Auto-filled from package. Override manually if needed.</p>
            <div className="grid grid-cols-4 gap-3">
              <div>
                <label className="label">Max Branches</label>
                <input className="input" type="number" min="1" value={form.maxBranches} onChange={e => set('maxBranches', e.target.value)} />
              </div>
              <div>
                <label className="label">Max Users</label>
                <input className="input" type="number" min="1" value={form.maxUsers} onChange={e => set('maxUsers', e.target.value)} />
              </div>
              <div>
                <label className="label">Max POS Devices</label>
                <input className="input" type="number" min="1" value={form.maxPosDevices} onChange={e => set('maxPosDevices', e.target.value)} />
              </div>
              <div>
                <label className="label">Storage (GB)</label>
                <input className="input" type="number" min="1" value={form.maxStorageGb} onChange={e => set('maxStorageGb', e.target.value)} />
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <button type="button" className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn-primary flex-1"
              disabled={loading || !form.adminPassword || form.adminPassword !== form.confirmPassword}>
              {loading ? 'Creating…' : 'Create Company'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}


function ApiKeyModal({ company, onClose, onRegenerated }: {
  company: Company
  onClose: () => void
  onRegenerated: () => void
}) {
  const [apiKey, setApiKey]     = useState(company.api_key ?? '')
  const [copied, setCopied]     = useState(false)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [confirmed, setConfirmed] = useState(false)

  async function handleCopy() {
    await navigator.clipboard.writeText(apiKey)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function handleRegenerate() {
    if (!confirmed) { setConfirmed(true); return }
    setLoading(true); setError('')
    try {
      const updated = await api.update(company.id, { regenerate_api_key: true }) as Company
      setApiKey(updated.api_key ?? '')
      setConfirmed(false)
      onRegenerated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to regenerate')
    }
    setLoading(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-indigo-400" />
            <h2 className="font-semibold text-white">POS API Key — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          <div className="bg-indigo-900/20 border border-indigo-700/40 rounded-lg px-4 py-3 text-sm text-indigo-300 space-y-1">
            <p className="font-medium text-indigo-200">How to connect the Electron POS app</p>
            <ol className="list-decimal list-inside space-y-0.5 text-indigo-300/90">
              <li>Open the POS desktop app on the branch computer</li>
              <li>Go to <span className="font-mono bg-indigo-900/40 px-1 rounded">Settings → Cloud Sync</span></li>
              <li>Paste this API Key into the <span className="font-mono bg-indigo-900/40 px-1 rounded">API Key</span> field</li>
              <li>Click Save — the app will connect to this company's data</li>
            </ol>
          </div>

          <div>
            <label className="label">API Key</label>
            <div className="flex gap-2">
              <input
                className="input flex-1 font-mono text-sm tracking-wide"
                value={apiKey}
                readOnly
              />
              <button
                className="btn-ghost px-3 flex items-center gap-1.5 text-sm"
                onClick={handleCopy}
                title="Copy to clipboard"
              >
                <Copy className="w-4 h-4" />
                {copied ? 'Copied!' : 'Copy'}
              </button>
            </div>
          </div>

          <div className="border-t border-gray-800 pt-4">
            <p className="text-xs text-gray-500 mb-3">
              Regenerating will invalidate the current key. All POS branches will lose sync until they update to the new key.
            </p>
            {confirmed ? (
              <div className="flex gap-2">
                <button className="btn-ghost flex-1 text-sm" onClick={() => setConfirmed(false)}>Cancel</button>
                <button
                  className="flex-1 text-sm px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white font-medium transition-colors disabled:opacity-50"
                  onClick={handleRegenerate}
                  disabled={loading}
                >
                  {loading ? 'Regenerating…' : 'Yes, Regenerate Key'}
                </button>
              </div>
            ) : (
              <button className="btn-ghost text-sm text-red-400 hover:text-red-300" onClick={handleRegenerate}>
                Regenerate API Key
              </button>
            )}
          </div>

          <div className="flex justify-end pt-1">
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        </div>
      </div>
    </div>
  )
}

// Grouping for the Feature Management tab inside CompanyCapabilitiesModal below.
const MODULE_GROUPS: Record<string, string[]> = {
  'Core':       ['pos', 'inventory', 'customers'],
  'Finance':    ['installments', 'expenses', 'purchase_orders'],
  'Operations': ['deliveries', 'stock_transfers', 'multi_branch'],
  'Reporting':  ['reports_basic', 'reports_full'],
  'Advanced':   ['api_access', 'white_label'],
}

// ─── Devices Modal ────────────────────────────────────────────────────────────
type DeviceRow = {
  id: string; device_name: string; device_id: string | null; license_key: string
  status: string; os_info: string | null; app_version: string | null
  last_seen_at: string | null; activated_at: string | null; created_at: string
}

const DEVICE_STATUS: Record<string, string> = {
  active:      'badge-green',
  pending:     'badge-yellow',
  deactivated: 'bg-gray-800 text-gray-400 px-2 py-0.5 rounded text-xs',
}

function DevicesModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [devList, setDevList]     = useState<DeviceRow[]>([])
  const [loading, setLoading]     = useState(true)
  const [newName, setNewName]     = useState('')
  const [creating, setCreating]   = useState(false)
  const [newDevice, setNewDevice] = useState<{ device_name: string; license_key: string } | null>(null)
  const [copied, setCopied]       = useState(false)
  const [error, setError]         = useState('')

  async function load() {
    setLoading(true)
    try {
      const d = await devicesApi.list(company.id)
      setDevList(d as DeviceRow[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [company.id])

  async function handleCreate() {
    if (!newName.trim()) return
    setCreating(true); setError('')
    try {
      const d = await devicesApi.create(company.id, { device_name: newName.trim() })
      setNewDevice(d)
      setNewName('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create')
    }
    setCreating(false)
  }

  async function handleDeactivate(dev: DeviceRow) {
    if (!confirm(`Deactivate "${dev.device_name}"? The POS on that machine will lose access.`)) return
    try { await devicesApi.deactivate(company.id, dev.id); load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed') }
  }

  async function handleReset(dev: DeviceRow) {
    if (!confirm(`Reset "${dev.device_name}"? The license key can then be used on a new machine.`)) return
    try { await devicesApi.reset(company.id, dev.id); load() }
    catch (err) { setError(err instanceof Error ? err.message : 'Failed') }
  }

  async function copyKey(key: string) {
    await navigator.clipboard.writeText(key)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  const maxDevices  = Number(company.max_pos_devices ?? 2)
  const activeCount = devList.filter(d => d.status !== 'deactivated').length

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Smartphone className="w-4 h-4 text-cyan-400" />
            <h2 className="font-semibold text-white">POS Devices — {company.name}</h2>
            <span className="text-xs text-gray-500 ml-1">{activeCount}/{maxDevices} slots used</span>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          {/* Newly created license key */}
          {newDevice && (
            <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-4 space-y-2">
              <p className="text-sm font-semibold text-green-300">License key created for "{newDevice.device_name}"</p>
              <p className="text-xs text-green-400/80">Share this key with the POS operator. Store it safely — it won't be shown again.</p>
              <div className="flex gap-2">
                <code className="flex-1 bg-black/30 rounded px-3 py-2 text-green-300 font-mono text-sm tracking-wide break-all">
                  {newDevice.license_key}
                </code>
                <button className="btn-ghost text-xs px-3 flex-shrink-0" onClick={() => copyKey(newDevice.license_key)}>
                  <Copy className="w-3.5 h-3.5 inline mr-1" />{copied ? 'Copied!' : 'Copy'}
                </button>
              </div>
            </div>
          )}

          {/* Add device form */}
          {activeCount < maxDevices ? (
            <div className="flex gap-2">
              <input className="input flex-1" placeholder="Device name (e.g. Branch 1 - Counter 2)"
                value={newName} onChange={e => setNewName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreate()} />
              <button className="btn-primary flex items-center gap-1.5 text-sm flex-shrink-0"
                onClick={handleCreate} disabled={creating || !newName.trim()}>
                <Plus className="w-4 h-4" />{creating ? 'Creating…' : 'Add Device'}
              </button>
            </div>
          ) : (
            <div className="text-xs text-yellow-400 bg-yellow-900/20 border border-yellow-700/30 rounded-lg px-4 py-2">
              Device limit reached ({maxDevices} max). Deactivate a device or upgrade the plan to add more.
            </div>
          )}

          {/* Device list */}
          {loading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-800/50 rounded-lg animate-pulse" />)}</div>
          ) : devList.length === 0 ? (
            <p className="text-center py-8 text-gray-500 text-sm">No devices yet. Add one above.</p>
          ) : (
            <div className="space-y-2">
              {devList.map(dev => (
                <div key={dev.id} className="flex items-center justify-between px-4 py-3 bg-gray-800/40 rounded-lg border border-gray-800">
                  <div className="flex items-center gap-3 min-w-0">
                    <Monitor className="w-4 h-4 text-gray-500 flex-shrink-0" />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-white truncate">{dev.device_name}</p>
                      <p className="text-xs text-gray-500">
                        {dev.device_id ? `Bound to: ${dev.device_id.slice(0, 18)}…` : 'Not yet activated'}
                        {dev.last_seen_at ? ` · Last seen ${new Date(dev.last_seen_at).toLocaleDateString()}` : ''}
                        {dev.app_version ? ` · v${dev.app_version}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                    <span className={DEVICE_STATUS[dev.status] ?? 'badge-yellow'}>{dev.status}</span>
                    {dev.status !== 'deactivated' && (
                      <button title="Deactivate" className="p-1.5 rounded hover:bg-yellow-900/40 text-yellow-400"
                        onClick={() => handleDeactivate(dev)}><Ban className="w-3.5 h-3.5" /></button>
                    )}
                    {(dev.status === 'deactivated' || dev.device_id) && (
                      <button title="Reset — allow re-activation on a new machine"
                        className="p-1.5 rounded hover:bg-blue-900/40 text-blue-400"
                        onClick={() => handleReset(dev)}><RefreshCw className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-end">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ─── Backups Modal ────────────────────────────────────────────────────────────
const BACKUP_STATUS_BADGE: Record<string, string> = {
  pending:   'badge-yellow',
  completed: 'badge-green',
  failed:    'badge-red',
}

function formatBytes(n: number | null): string {
  if (!n) return '—'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n, i = 0
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++ }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}

function BackupsModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [list, setList]         = useState<BackupRow[]>([])
  const [loading, setLoading]   = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError]       = useState('')
  const [schedule, setSchedule] = useState<BackupSchedule>({ enabled: false, frequency: 'daily', last_run_at: null })
  const [savingSchedule, setSavingSchedule] = useState(false)
  const [restoreTarget, setRestoreTarget]   = useState<BackupRow | null>(null)
  const [restoreConfirmText, setRestoreConfirmText] = useState('')
  const [restoring, setRestoring] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const [rows, sched] = await Promise.all([
        backupsApi.list(company.id),
        backupsApi.getSchedule(company.id),
      ])
      setList(rows)
      setSchedule(sched)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
    }
    setLoading(false)
  }

  useEffect(() => { load() }, [company.id])

  // A pending backup means work is happening server-side — poll until it settles.
  useEffect(() => {
    if (!list.some(b => b.status === 'pending')) return
    const t = setTimeout(load, 3000)
    return () => clearTimeout(t)
  }, [list])

  async function handleCreate() {
    setCreating(true); setError('')
    try {
      await backupsApi.create(company.id)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start backup')
    }
    setCreating(false)
  }

  async function handleDownload(b: BackupRow) {
    setError('')
    try {
      await backupsApi.download(company.id, b.id, b.file_name ?? `${company.name}-backup.sql.gz.enc`)
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed')
    }
  }

  async function handleScheduleToggle(enabled: boolean) {
    setSavingSchedule(true)
    try {
      const updated = await backupsApi.setSchedule(company.id, enabled, schedule.frequency)
      setSchedule(s => ({ ...s, enabled: updated.ok ? enabled : s.enabled }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule')
    }
    setSavingSchedule(false)
  }

  async function handleFrequencyChange(frequency: 'daily' | 'weekly') {
    setSavingSchedule(true)
    try {
      await backupsApi.setSchedule(company.id, schedule.enabled, frequency)
      setSchedule(s => ({ ...s, frequency }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update schedule')
    }
    setSavingSchedule(false)
  }

  async function handleRestoreConfirm() {
    if (!restoreTarget) return
    setRestoring(true); setError('')
    try {
      await backupsApi.restore(company.id, restoreTarget.id, restoreConfirmText.trim())
      setRestoreTarget(null)
      setRestoreConfirmText('')
      load()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed')
    }
    setRestoring(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Database className="w-4 h-4 text-teal-400" />
            <h2 className="font-semibold text-white">Backups — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          {/* Manual backup + schedule */}
          <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-800/40 rounded-lg border border-gray-800 px-4 py-3">
            <button className="btn-primary flex items-center gap-1.5 text-sm" onClick={handleCreate} disabled={creating}>
              <Database className="w-4 h-4" />{creating ? 'Starting…' : 'Create Manual Backup'}
            </button>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-2 text-gray-300">
                <input type="checkbox" checked={schedule.enabled} disabled={savingSchedule}
                  onChange={e => handleScheduleToggle(e.target.checked)} />
                Automatic backup
              </label>
              <select className="input text-sm py-1" value={schedule.frequency} disabled={savingSchedule || !schedule.enabled}
                onChange={e => handleFrequencyChange(e.target.value as 'daily' | 'weekly')}>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
              </select>
            </div>
          </div>
          {schedule.enabled && schedule.last_run_at && (
            <p className="text-xs text-gray-500 -mt-2">Last automatic run: {new Date(schedule.last_run_at).toLocaleString()}</p>
          )}

          {/* Restore confirmation panel */}
          {restoreTarget && (
            <div className="bg-red-900/20 border border-red-700/50 rounded-lg p-4 space-y-3">
              <p className="text-sm text-red-300 font-medium flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4" /> This will overwrite {company.name}'s current data
              </p>
              <p className="text-xs text-gray-400">
                A safety backup of the current state is taken automatically first, but this action still
                replaces live data immediately. Type <span className="font-mono text-white">{company.name}</span> to confirm.
              </p>
              <input className="input w-full" value={restoreConfirmText} onChange={e => setRestoreConfirmText(e.target.value)}
                placeholder={company.name} />
              <div className="flex gap-2">
                <button className="btn-primary bg-red-600 hover:bg-red-500 text-sm" disabled={restoring || restoreConfirmText.trim() !== company.name}
                  onClick={handleRestoreConfirm}>
                  {restoring ? 'Restoring…' : 'Confirm Restore'}
                </button>
                <button className="btn-ghost text-sm" onClick={() => { setRestoreTarget(null); setRestoreConfirmText('') }}>Cancel</button>
              </div>
            </div>
          )}

          {/* History */}
          {loading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-800/50 rounded-lg animate-pulse" />)}</div>
          ) : list.length === 0 ? (
            <p className="text-center py-8 text-gray-500 text-sm">No backups yet. Create one above.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-500 uppercase tracking-wide">
                    <th className="pb-2 pr-3">Date</th>
                    <th className="pb-2 pr-3">Type</th>
                    <th className="pb-2 pr-3">Status</th>
                    <th className="pb-2 pr-3">Size</th>
                    <th className="pb-2 pr-3">Downloads</th>
                    <th className="pb-2 pr-3">Restore Status</th>
                    <th className="pb-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {list.map(b => (
                    <tr key={b.id} className="border-t border-gray-800">
                      <td className="py-2 pr-3 text-gray-300 whitespace-nowrap">{new Date(b.created_at).toLocaleString()}</td>
                      <td className="py-2 pr-3 text-gray-400">{b.backup_type}</td>
                      <td className="py-2 pr-3"><span className={BACKUP_STATUS_BADGE[b.status] ?? ''}>{b.status}</span></td>
                      <td className="py-2 pr-3 text-gray-400">{formatBytes(b.file_size_bytes)}</td>
                      <td className="py-2 pr-3 text-gray-400">{b.download_count}</td>
                      <td className="py-2 pr-3 text-gray-400">
                        {b.restored_at ? `Restored ${new Date(b.restored_at).toLocaleDateString()}` : '—'}
                      </td>
                      <td className="py-2 flex items-center gap-1.5 justify-end">
                        {b.status === 'completed' && (
                          <>
                            <button title="Download" className="p-1.5 rounded hover:bg-teal-900/40 text-teal-400"
                              onClick={() => handleDownload(b)}>
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button title="Restore" className="p-1.5 rounded hover:bg-red-900/40 text-red-400"
                              onClick={() => { setRestoreTarget(b); setRestoreConfirmText('') }}>
                              <RotateCcw className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        {b.status === 'failed' && b.error_message && (
                          <span className="text-xs text-red-400" title={b.error_message}>failed</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-end">
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ─── Company Key Modal ────────────────────────────────────────────────────────
function CompanyKeyModal({ company, onClose, onUpdated }: {
  company: Company; onClose: () => void; onUpdated: () => void
}) {
  const [key, setKey]       = useState<string>(company.company_key || '')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied]   = useState(false)
  const [error, setError]     = useState('')

  async function generate() {
    if (!confirm('Generate a new Company Activation Key? The old key will stop working immediately.')) return
    setLoading(true); setError('')
    try {
      const updated = await api.update(company.id, { regenerate_company_key: true }) as Company
      setKey(updated.company_key || '')
      onUpdated()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setLoading(false)
  }

  function copy() {
    navigator.clipboard.writeText(key)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
            <h2 className="font-semibold text-white">Company Activation Key</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <p className="text-sm text-gray-400">
            Share this key with <span className="font-semibold text-white">{company.name}</span>.
            They enter it once during POS setup to activate all their devices.
          </p>

          {key ? (
            <div className="space-y-2">
              <label className="text-xs text-gray-500 uppercase tracking-wider">Activation Key</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-4 py-3 font-mono text-sm text-emerald-400 tracking-wider select-all">
                  {key}
                </code>
                <button onClick={copy} className="p-2.5 rounded-lg bg-gray-800 border border-gray-700 text-gray-400 hover:text-white transition-colors" title="Copy">
                  {copied ? <CheckCircle className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
              </div>
              <p className="text-xs text-gray-500">
                Devices: <span className="text-white">{company.max_pos_devices ?? 2} max</span> ·
                Status: <span className={company.status === 'active' ? 'text-green-400' : 'text-yellow-400'}>{company.status}</span>
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center">
              <ShieldCheck className="w-8 h-8 text-gray-600 mx-auto mb-2" />
              <p className="text-sm text-gray-500">No activation key generated yet.</p>
              <p className="text-xs text-gray-600 mt-1">Click "Generate Key" to create one.</p>
            </div>
          )}

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div className="rounded-lg bg-yellow-500/10 border border-yellow-500/20 p-3">
            <p className="text-xs text-yellow-400">
              ⚠️ Regenerating the key will immediately invalidate the old key.
              All new activations must use the new key. Existing active devices are unaffected.
            </p>
          </div>
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-between">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary flex items-center gap-2" onClick={generate} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            {key ? 'Regenerate Key' : 'Generate Key'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Impersonate Modal ────────────────────────────────────────────────────────
function ImpersonateModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [reason,  setReason]  = useState('')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')
  const [result,  setResult]  = useState<{ accessToken: string; refreshToken: string } | null>(null)
  const [copied,  setCopied]  = useState(false)

  async function handleImpersonate() {
    if (!reason.trim()) { setError('Please enter a reason for auditing purposes.'); return }
    setLoading(true); setError('')
    try {
      const d = await impersonateApi.start(company.id, reason)
      setResult(d)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed')
    }
    setLoading(false)
  }

  async function copyToken() {
    if (!result) return
    await navigator.clipboard.writeText(result.accessToken)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <LogIn className="w-4 h-4 text-orange-400" />
            <h2 className="font-semibold text-white">Impersonate — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-orange-900/20 border border-orange-700/40 rounded-lg px-4 py-3 text-sm text-orange-300">
            <p className="font-medium text-orange-200 mb-1">⚠️ Support Access — Fully Audited</p>
            <p className="text-orange-300/80 text-xs">
              You will receive a temporary admin token for <strong>{company.name}</strong>.
              This action is logged with your name, reason, and timestamp.
            </p>
          </div>

          {!result ? (
            <>
              <div>
                <label className="label">Reason for access <span className="text-red-400">*</span></label>
                <input className="input" placeholder="e.g. Customer support request #1234"
                  value={reason} onChange={e => setReason(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleImpersonate()} />
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <div className="flex gap-3 pt-1">
                <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
                <button className="flex-1 px-4 py-2 rounded-lg bg-orange-600 hover:bg-orange-500 text-white font-medium text-sm transition-colors disabled:opacity-50"
                  onClick={handleImpersonate} disabled={loading}>
                  {loading ? 'Getting access…' : 'Get Admin Token'}
                </button>
              </div>
            </>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-green-400 font-medium">✓ Access token generated</p>
              <div>
                <label className="label">Access Token (expires in 15 min)</label>
                <div className="flex gap-2">
                  <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-green-300 font-mono break-all">
                    {result.accessToken}
                  </code>
                  <button className="btn-ghost px-3 text-sm flex-shrink-0" onClick={copyToken}>
                    <Copy className="w-4 h-4" />
                    {copied ? ' ✓' : ''}
                  </button>
                </div>
              </div>
              <div className="text-xs text-gray-500 bg-gray-800/60 rounded-lg px-4 py-3 space-y-1">
                <p className="font-medium text-gray-400">How to use:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Open the Admin Portal (company portal URL)</li>
                  <li>Open browser DevTools → Application → Local Storage</li>
                  <li>Set <code className="bg-gray-700 px-1 rounded">sa_access</code> = copied token</li>
                  <li>Refresh the page — you're logged in as their admin</li>
                </ol>
              </div>
              <button className="btn-primary w-full" onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Company Capabilities Modal ───────────────────────────────────────────────
type FeatureRow = {
  feature_key: string
  feature_name: string
  module_key: string
  group: string
  description: string
  sort_order: number
  is_active: number
  from_package?: boolean
  has_override?: boolean
  is_enabled?: boolean
}

function CompanyCapabilitiesModal({ company, onClose, onSaved }: {
  company: Company; onClose: () => void; onSaved: () => void
}) {
  type Tab = 'overview' | 'modules' | 'features' | 'limits' | 'devices' | 'branding' | 'license' | 'audit'
  const [tab, setTab] = useState<Tab>('overview')
  const [modules, setModules] = useState<Record<string, unknown>[]>([])
  const [features, setFeatures] = useState<FeatureRow[]>([])
  const [limits, setLimits] = useState<Record<string, unknown> | null>(null)
  const [audit, setAudit] = useState<Record<string, unknown>[]>([])
  const [devices, setDevices] = useState<Record<string, unknown>[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [brandColor, setBrandColor] = useState(String(company.brand_color || '#2563eb'))
  const [brandLogoUrl, setBrandLogoUrl] = useState(String(company.brand_logo_url || ''))

  useEffect(() => {
    setLoading(true)
    Promise.all([
      modulesApi.list(company.id).catch(() => []),
      featuresApi.list(company.id).catch(() => []),
      limitsApi.get(company.id).catch(() => null),
      devicesApi.list(company.id).catch(() => []),
      auditApi.list({ company_id: company.id, limit: '20', page: '1' }).then(r => (r as { rows: Record<string, unknown>[] }).rows).catch(() => []),
    ]).then(([moduleRows, featureRows, limitRows, deviceRows, auditRows]) => {
      setModules(moduleRows as Record<string, unknown>[])
      setFeatures(featureRows as FeatureRow[])
      setLimits(limitRows as Record<string, unknown> | null)
      setDevices(deviceRows as Record<string, unknown>[])
      setAudit(auditRows as Record<string, unknown>[])
      setError('')
    }).catch(err => setError(err instanceof Error ? err.message : 'Failed to load capability data'))
      .finally(() => setLoading(false))
  }, [company.id])

  async function toggleFeature(row: FeatureRow) {
    const current = Boolean(row.is_enabled)
    setSaving(row.feature_key)
    try {
      await featuresApi.toggle(company.id, row.feature_key, !current)
      setFeatures(prev => prev.map(item => item.feature_key === row.feature_key ? { ...item, is_enabled: !current, has_override: true } : item))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update feature')
    }
    setSaving(null)
  }

  async function toggleModule(row: Record<string, unknown>) {
    const key = String(row.module_key || '')
    const current = Boolean(row.is_enabled)
    setSaving(key)
    try {
      await modulesApi.toggle(company.id, key, !current)
      setModules(prev => prev.map(item => String(item.module_key) === key ? { ...item, is_enabled: !current, has_override: true } : item))
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update module')
    }
    setSaving(null)
  }

  async function saveBranding() {
    setSaving('branding')
    try {
      await api.update(company.id, { brandColor, brandLogoUrl })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save branding')
    }
    setSaving(null)
  }

  async function saveLimits() {
    if (!limits) return
    setSaving('limits')
    try {
      await limitsApi.update(company.id, {
        max_users: Number(limits.max_users ?? limits.maxUsers ?? company.max_users ?? 5),
        max_branches: Number(limits.max_branches ?? limits.maxBranches ?? company.max_branches ?? 1),
        max_pos_devices: Number(limits.max_pos_devices ?? limits.maxPosDevices ?? company.max_pos_devices ?? 2),
        max_storage_gb: Number(limits.max_storage_gb ?? limits.maxStorageGb ?? company.max_storage_gb ?? 5),
      })
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save limits')
    }
    setSaving(null)
  }

  const tabs: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'overview', label: 'Overview', icon: <BadgeInfo className="w-3.5 h-3.5" /> },
    { key: 'modules', label: 'Feature Management', icon: <LayoutGrid className="w-3.5 h-3.5" /> },
    { key: 'features', label: 'Features', icon: <FileText className="w-3.5 h-3.5" /> },
    { key: 'limits', label: 'Limits', icon: <Sliders className="w-3.5 h-3.5" /> },
    { key: 'devices', label: 'Devices', icon: <Monitor className="w-3.5 h-3.5" /> },
    { key: 'branding', label: 'Branding', icon: <Palette className="w-3.5 h-3.5" /> },
    { key: 'license', label: 'License', icon: <Key className="w-3.5 h-3.5" /> },
    { key: 'audit', label: 'Audit', icon: <ShieldCheck className="w-3.5 h-3.5" /> },
  ]

  const moduleRows = modules as Array<Record<string, unknown>>
  const groupedFeatures = features.reduce<Record<string, FeatureRow[]>>((acc, row) => {
    acc[row.group] = acc[row.group] ?? []
    acc[row.group].push(row)
    return acc
  }, {})
  const limitsSummary = limits ?? {
    max_users: company.max_users,
    max_branches: company.max_branches,
    max_pos_devices: company.max_pos_devices,
    max_storage_gb: company.max_storage_gb,
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-5xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Settings2 className="w-4 h-4 text-slate-300" />
            <h2 className="font-semibold text-white">Capabilities — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">×</button>
        </div>

        <div className="flex flex-wrap gap-1 px-5 pt-4 border-b border-gray-800">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setError('') }}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm rounded-t-lg border-b-2 -mb-px transition-colors ${
                tab === t.key ? 'border-indigo-500 text-indigo-400' : 'border-transparent text-gray-500 hover:text-white'
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}
          {loading && <div className="text-sm text-gray-500">Loading company data…</div>}

          {tab === 'overview' && (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
              {[
                { label: 'Modules', value: moduleRows.filter(row => Boolean(row.is_enabled)).length },
                { label: 'Features', value: features.filter(row => Boolean(row.is_enabled)).length },
                { label: 'Devices', value: devices.length },
                { label: 'Audit Events', value: audit.length },
                { label: 'Max Branches', value: String(limitsSummary.max_branches ?? company.max_branches ?? 1) },
                { label: 'Max Users', value: String(limitsSummary.max_users ?? company.max_users ?? 5) },
              ].map(item => (
                <div key={item.label} className="card">
                  <p className="text-xs text-gray-500">{item.label}</p>
                  <p className="text-2xl font-bold text-white mt-1">{String(item.value)}</p>
                </div>
              ))}
              <div className="card xl:col-span-3 space-y-2">
                <p className="text-sm font-semibold text-white">Branch / User / Sync / Printer / Notifications</p>
                <p className="text-sm text-gray-400">
                  These operational records are managed inside the tenant app. Use this screen to control the company-wide
                  module set, per-feature permissions, limits, branding, devices, and license state.
                </p>
              </div>
            </div>
          )}

          {tab === 'modules' && (
            <div className="space-y-5">
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> Included in package
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" /> Manually overridden
                </span>
              </div>
              {Object.entries(MODULE_GROUPS).map(([group, keys]) => {
                const rowsInGroup = keys
                  .map(key => moduleRows.find(row => String(row.module_key) === key))
                  .filter((row): row is Record<string, unknown> => Boolean(row))
                if (!rowsInGroup.length) return null
                return (
                  <div key={group}>
                    <p className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-2">{group}</p>
                    <div className="space-y-2">
                      {rowsInGroup.map(row => {
                        const hasOverride = Boolean(row.has_override)
                        const fromPackage = Boolean(row.from_package)
                        const badgeLabel = hasOverride ? 'override' : fromPackage ? 'package' : ''
                        const badgeColor = hasOverride
                          ? 'bg-purple-900/40 text-purple-300 border-purple-700/40'
                          : 'bg-blue-900/40 text-blue-300 border-blue-700/40'
                        return (
                          <div key={String(row.module_key)} className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-800 bg-gray-800/30">
                            <div>
                              <p className="text-sm font-medium text-white">{String(row.module_name ?? row.module_key)}</p>
                              {badgeLabel && (
                                <span className={`text-xs px-1.5 py-0.5 rounded border ${badgeColor}`}>{badgeLabel}</span>
                              )}
                            </div>
                            <button
                              onClick={() => toggleModule(row)}
                              disabled={saving === String(row.module_key)}
                              className={`relative inline-flex h-6 w-11 flex-shrink-0 rounded-full border-2 border-transparent transition-colors ${Boolean(row.is_enabled) ? 'bg-indigo-600' : 'bg-gray-700'}`}>
                              <span className={`inline-block h-5 w-5 transform rounded-full bg-white transition ${Boolean(row.is_enabled) ? 'translate-x-5' : 'translate-x-0'}`} />
                            </button>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              <p className="text-xs text-gray-500">Changes take effect immediately on next POS sync.</p>
            </div>
          )}

          {tab === 'features' && (
            <div className="space-y-4">
              {Object.entries(groupedFeatures).sort(([a], [b]) => a.localeCompare(b)).map(([group, items]) => (
                <div key={group}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500 mb-2">{group}</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {items.map(row => (
                      <button
                        key={row.feature_key}
                        onClick={() => toggleFeature(row)}
                        className="text-left rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3 hover:border-gray-700 transition-colors">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium text-white">{row.feature_name}</p>
                            <p className="text-xs text-gray-500">{row.description}</p>
                          </div>
                          <span className={`text-xs px-2 py-0.5 rounded-full ${row.is_enabled ? 'bg-green-900/30 text-green-300' : 'bg-gray-800 text-gray-500'}`}>
                            {row.is_enabled ? 'On' : 'Off'}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === 'limits' && (
            <div className="space-y-4 max-w-2xl">
              <div className="grid grid-cols-2 gap-3">
                {[
                  { key: 'max_branches', label: 'Max Branches' },
                  { key: 'max_users', label: 'Max Users' },
                  { key: 'max_pos_devices', label: 'Max POS Devices' },
                  { key: 'max_storage_gb', label: 'Storage (GB)' },
                ].map(field => (
                  <div key={field.key}>
                    <label className="label">{field.label}</label>
                    <input
                      className="input"
                      type="number"
                      min="0"
                      value={String((limitsSummary as Record<string, unknown>)[field.key] ?? 0)}
                      onChange={e => setLimits(prev => ({ ...(prev ?? {}), [field.key]: e.target.value }))}
                    />
                  </div>
                ))}
              </div>
              <button className="btn-primary" onClick={saveLimits} disabled={saving === 'limits'}>
                {saving === 'limits' ? 'Saving…' : 'Save Limits'}
              </button>
            </div>
          )}

          {tab === 'devices' && (
            <div className="space-y-2">
              {devices.map((dev, idx) => (
                <div key={String(dev.id ?? idx)} className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-800 bg-gray-800/30">
                  <div>
                    <p className="text-sm font-medium text-white">{String(dev.device_name ?? 'Device')}</p>
                    <p className="text-xs text-gray-500">{String(dev.status ?? 'pending')} · {String(dev.license_key ?? '')}</p>
                  </div>
                  <span className="badge-yellow">{String(dev.status ?? 'pending')}</span>
                </div>
              ))}
              {devices.length === 0 && <p className="text-sm text-gray-500">No device records found for this company.</p>}
            </div>
          )}

          {tab === 'branding' && (
            <div className="space-y-4 max-w-2xl">
              <div>
                <label className="label">Brand Color</label>
                <div className="flex items-center gap-3">
                  <input type="color" className="w-10 h-10 rounded border border-gray-700 bg-transparent" value={brandColor} onChange={e => setBrandColor(e.target.value)} />
                  <input className="input flex-1" value={brandColor} onChange={e => setBrandColor(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Logo URL</label>
                <input className="input" value={brandLogoUrl} onChange={e => setBrandLogoUrl(e.target.value)} />
              </div>
              <button className="btn-primary" onClick={saveBranding} disabled={saving === 'branding'}>
                {saving === 'branding' ? 'Saving…' : 'Save Branding'}
              </button>
            </div>
          )}

          {tab === 'license' && (
            <div className="space-y-3 max-w-2xl">
              <div className="card space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Company Key</span>
                  <span className="text-white font-mono">{String(company.company_key || '—')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Current Package</span>
                  <span className="text-white">{String(company.package_name || '—')}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">Subscription</span>
                  <span className="text-white">{company.sub_ends_at ? new Date(String(company.sub_ends_at)).toLocaleDateString() : '—'}</span>
                </div>
              </div>
              <p className="text-sm text-gray-500">
                License keys and device activation are handled in the Devices view and the company activation key modal.
              </p>
            </div>
          )}

          {tab === 'audit' && (
            <div className="space-y-2">
              {audit.map((row, idx) => (
                <div key={String(row.id ?? idx)} className="rounded-lg border border-gray-800 bg-gray-800/30 px-4 py-3">
                  <p className="text-sm text-white">{String(row.action ?? 'event')}</p>
                  <p className="text-xs text-gray-500">{String(row.actor_name ?? 'system')} · {String(row.created_at ?? '')}</p>
                </div>
              ))}
              {audit.length === 0 && <p className="text-sm text-gray-500">No audit records available.</p>}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex justify-between items-center">
          <p className="text-xs text-gray-500">Changes apply immediately to new logins and sync sessions.</p>
          <button className="btn-primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}

// ─── Edit Company Modal ───────────────────────────────────────────────────────
function EditCompanyModal({ company, pkgs, onClose, onSaved }: {
  company: Company; pkgs: Pkg[]; onClose: () => void; onSaved: () => void
}) {
  type Tab = 'info' | 'limits' | 'subscription'
  const [tab, setTab] = useState<Tab>('info')

  const [info, setInfo] = useState({
    name:    company.name    || '',
    email:   company.email   || '',
    phone:   company.phone   || '',
    address: company.address || '',
    notes:   company.notes   || '',
  })
  const [limits, setLimits] = useState({
    maxBranches:   String(company.max_branches   ?? 1),
    maxUsers:      String(company.max_users      ?? 5),
    maxPosDevices: String(company.max_pos_devices ?? 2),
    maxStorageGb:  String(company.max_storage_gb  ?? 5),
  })
  const [sub, setSub] = useState({
    subscriptionEndsAt: company.sub_ends_at
      ? new Date(company.sub_ends_at).toISOString().slice(0, 10)
      : '',
    newPackageId:  company.package_id || '',
    extendDays:    '',
  })

  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')
  const [saved,  setSaved]  = useState(false)

  const si = (k: string) => (v: string) => setInfo(f => ({ ...f, [k]: v }))
  const sl = (k: string) => (v: string) => setLimits(f => ({ ...f, [k]: v }))
  const ss = (k: string) => (v: string) => setSub(f => ({ ...f, [k]: v }))

  async function save() {
    setSaving(true); setError('')
    try {
      const body: Record<string, unknown> = {}

      if (tab === 'info') {
        if (info.name)    body.name    = info.name
        if (info.email)   body.email   = info.email
        body.phone   = info.phone
        body.address = info.address
        body.notes   = info.notes
      }

      if (tab === 'limits') {
        body.maxBranches   = Number(limits.maxBranches)
        body.maxUsers      = Number(limits.maxUsers)
        body.maxPosDevices = Number(limits.maxPosDevices)
        body.maxStorageGb  = Number(limits.maxStorageGb)
      }

      if (tab === 'subscription') {
        if (sub.subscriptionEndsAt) body.subscriptionEndsAt = sub.subscriptionEndsAt
        if (sub.newPackageId)        body.newPackageId        = sub.newPackageId
        if (sub.extendDays && Number(sub.extendDays) > 0) body.extendTrialDays = Number(sub.extendDays)
      }

      await api.update(company.id, body)
      if (tab === 'limits') {
        await limitsApi.update(company.id, {
          max_users: Number(limits.maxUsers),
          max_branches: Number(limits.maxBranches),
          max_pos_devices: Number(limits.maxPosDevices),
          max_storage_gb: Number(limits.maxStorageGb),
        })
      }
      setSaved(true)
      onSaved()
      setTimeout(() => setSaved(false), 1500)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
    setSaving(false)
  }

  const TAB_LABELS: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'info',         label: 'Info',         icon: <Edit2 className="w-3.5 h-3.5" /> },
    { key: 'limits',       label: 'Limits',       icon: <Sliders className="w-3.5 h-3.5" /> },
    { key: 'subscription', label: 'Subscription', icon: <CalendarClock className="w-3.5 h-3.5" /> },
  ]

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-xl">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Edit2 className="w-4 h-4 text-gray-300" />
            <h2 className="font-semibold text-white">Edit — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-800 px-5">
          {TAB_LABELS.map(t => (
            <button key={t.key} onClick={() => { setTab(t.key); setError(''); setSaved(false) }}
              className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? 'border-indigo-500 text-indigo-400'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}>
              {t.icon}{t.label}
            </button>
          ))}
        </div>

        <div className="p-5 space-y-4">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          {tab === 'info' && (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Company Name</label>
                  <input className="input" value={info.name} onChange={e => si('name')(e.target.value)} />
                </div>
                <div>
                  <label className="label">Email</label>
                  <input className="input" type="email" value={info.email} onChange={e => si('email')(e.target.value)} />
                </div>
                <div>
                  <label className="label">Phone</label>
                  <input className="input" value={info.phone} onChange={e => si('phone')(e.target.value)} />
                </div>
                <div>
                  <label className="label">Address</label>
                  <input className="input" value={info.address} onChange={e => si('address')(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="label">Notes (internal)</label>
                <textarea className="input w-full h-20 resize-none" value={info.notes}
                  onChange={e => si('notes')(e.target.value)} />
              </div>
            </div>
          )}

          {tab === 'limits' && (
            <div className="space-y-4">
              <p className="text-xs text-gray-500">These limits are enforced in real-time by the POS app.</p>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="label flex items-center gap-1.5"><GitBranch className="w-3 h-3" />Max Branches</label>
                  <input className="input" type="number" min="1" value={limits.maxBranches} onChange={e => sl('maxBranches')(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5"><Users className="w-3 h-3" />Max Users</label>
                  <input className="input" type="number" min="1" value={limits.maxUsers} onChange={e => sl('maxUsers')(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5"><Monitor className="w-3 h-3" />Max POS Devices</label>
                  <input className="input" type="number" min="1" value={limits.maxPosDevices} onChange={e => sl('maxPosDevices')(e.target.value)} />
                </div>
                <div>
                  <label className="label flex items-center gap-1.5"><Sliders className="w-3 h-3" />Storage (GB)</label>
                  <input className="input" type="number" min="1" value={limits.maxStorageGb} onChange={e => sl('maxStorageGb')(e.target.value)} />
                </div>
              </div>
            </div>
          )}

          {tab === 'subscription' && (
            <div className="space-y-4">
              <div className="bg-gray-800/50 rounded-lg px-4 py-3 text-sm space-y-1">
                <div className="flex justify-between">
                  <span className="text-gray-400">Current package</span>
                  <span className="text-white">{company.package_name || '— none —'}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Current status</span>
                  <span className={company.status === 'active' ? 'text-green-400' : company.status === 'trial' ? 'text-yellow-400' : 'text-red-400'}>
                    {company.status}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Subscription ends</span>
                  <span className="text-white">{company.sub_ends_at ? new Date(company.sub_ends_at).toLocaleDateString() : '—'}</span>
                </div>
              </div>

              {company.status === 'suspended' && company.suspension_reason && (
                <div className="bg-red-900/20 border border-red-900/40 rounded-lg px-4 py-3 text-sm space-y-1">
                  <div className="text-red-400 font-medium flex items-center gap-1.5">
                    <Ban className="w-3.5 h-3.5" /> Suspension reason
                  </div>
                  <p className="text-gray-300">{company.suspension_reason}</p>
                  {company.suspended_at && (
                    <p className="text-xs text-gray-500">Since {new Date(company.suspended_at).toLocaleString()}</p>
                  )}
                </div>
              )}

              <div>
                <label className="label">Change Package</label>
                <select className="input" value={sub.newPackageId} onChange={e => ss('newPackageId')(e.target.value)}>
                  <option value="">— keep current —</option>
                  {pkgs.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Set Subscription End Date</label>
                <input className="input" type="date" value={sub.subscriptionEndsAt}
                  onChange={e => ss('subscriptionEndsAt')(e.target.value)} />
              </div>

              <div>
                <label className="label">Extend Trial (days)</label>
                <div className="flex gap-2">
                  {['7','14','30'].map(d => (
                    <button key={d} onClick={() => ss('extendDays')(d)}
                      className={`px-3 py-1.5 rounded text-sm border transition-colors ${
                        sub.extendDays === d ? 'bg-indigo-600 border-indigo-500 text-white' : 'border-gray-700 text-gray-400 hover:text-white'
                      }`}>+{d}d</button>
                  ))}
                  <input className="input flex-1 text-sm" type="number" min="1" placeholder="Custom days"
                    value={sub.extendDays} onChange={e => ss('extendDays')(e.target.value)} />
                </div>
                <p className="text-xs text-gray-500 mt-1">Adds days to current end date (or from today if expired).</p>
              </div>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex items-center gap-2" onClick={save} disabled={saving}>
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Delete Company Modal ─────────────────────────────────────────────────────
function DeleteCompanyModal({ company, onClose, onDeleted }: {
  company: Company; onClose: () => void; onDeleted: () => void
}) {
  const [confirmText, setConfirmText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleDelete() {
    if (confirmText !== company.name) return
    setLoading(true); setError('')
    try {
      await api.hardDelete(company.id)
      onDeleted(); onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed')
      setLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-red-800/60 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-400" />
            <h2 className="font-semibold text-white">Permanently Delete Company</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="bg-red-900/20 border border-red-700/40 rounded-lg px-4 py-3 text-sm text-red-300 space-y-1">
            <p className="font-semibold text-red-200">⚠️ This action is irreversible</p>
            <p className="text-red-300/80 text-xs">
              This will permanently delete <strong className="text-red-200">{company.name}</strong> and ALL its data:
              invoices, customers, products, users, branches, stock, installments, and the entire company database.
            </p>
          </div>

          {error && <p className="text-sm text-red-400">{error}</p>}

          <div>
            <label className="label text-gray-400">
              Type the company name to confirm: <span className="text-white font-mono">{company.name}</span>
            </label>
            <input
              className="input mt-1 w-full font-mono"
              placeholder={company.name}
              value={confirmText}
              onChange={e => setConfirmText(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-3 pt-1">
            <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
            <button
              className="flex-1 px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white font-semibold text-sm transition-colors disabled:opacity-40"
              onClick={handleDelete}
              disabled={loading || confirmText !== company.name}
            >
              {loading ? 'Deleting…' : 'Permanently Delete'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Reset Admin Password Modal ───────────────────────────────────────────────
function ResetAdminPasswordModal({ company, onClose }: { company: Company; onClose: () => void }) {
  const [confirmed, setConfirmed] = useState(false)
  const [loading, setLoading]     = useState(false)
  const [error, setError]         = useState('')
  const [result, setResult]       = useState<{ tempPassword: string; adminEmail: string; adminName: string } | null>(null)
  const [copied, setCopied]       = useState(false)

  async function handleReset() {
    if (!confirmed) { setConfirmed(true); return }
    setLoading(true); setError('')
    try {
      const r = await api.resetAdminPassword(company.id)
      setResult(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password')
    }
    setLoading(false)
  }

  function copyPassword() {
    if (!result) return
    navigator.clipboard.writeText(result.tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-amber-400" />
            <h2 className="font-semibold text-white">Reset Admin Password — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-4">
          {!result ? (
            <>
              <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg px-4 py-3 text-sm text-amber-300 space-y-1">
                <p className="font-semibold text-amber-200">Reset Company Admin Password</p>
                <p className="text-xs text-amber-300/80">
                  This generates a new temporary password for the Company Admin of <strong className="text-amber-200">{company.name}</strong>.
                  The admin will be forced to change it on their next login.
                </p>
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              {confirmed ? (
                <div className="space-y-3">
                  <p className="text-sm text-gray-300">Are you sure? A new temporary password will be generated and the old one will stop working immediately.</p>
                  <div className="flex gap-3">
                    <button className="btn-ghost flex-1" onClick={() => setConfirmed(false)} disabled={loading}>
                      Cancel
                    </button>
                    <button
                      className="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-colors disabled:opacity-50"
                      onClick={handleReset} disabled={loading}>
                      {loading ? 'Resetting…' : 'Yes, Reset Password'}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex gap-3 pt-1">
                  <button className="btn-ghost flex-1" onClick={onClose}>Cancel</button>
                  <button
                    className="flex-1 px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-sm transition-colors"
                    onClick={handleReset}>
                    Generate Temp Password
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <div className="bg-green-900/20 border border-green-700/40 rounded-lg px-4 py-3 text-sm text-green-300">
                <p className="font-semibold text-green-200 mb-1">✓ Password Reset Successfully</p>
                <p className="text-xs text-green-300/80">Share these credentials securely. The admin will be forced to change their password on first login.</p>
              </div>

              <div>
                <p className="text-xs text-gray-500 mb-1">Admin Name</p>
                <p className="text-sm text-white font-medium">{result.adminName}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-1">Admin Email</p>
                <p className="text-sm text-white font-mono">{result.adminEmail}</p>
              </div>
              <div>
                <p className="text-xs text-gray-500 mb-2">Temporary Password</p>
                <div className="flex gap-2">
                  <code className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2.5 text-lg font-mono font-bold text-amber-300 tracking-wider text-center">
                    {result.tempPassword}
                  </code>
                  <button className="btn-ghost px-3 text-sm flex-shrink-0 flex items-center gap-1.5"
                    onClick={copyPassword}>
                    <Copy className="w-4 h-4" />
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
              </div>

              <div className="bg-blue-900/20 border border-blue-700/30 rounded-lg px-4 py-3 text-xs text-blue-300 space-y-1">
                <p className="font-semibold text-blue-200">Next steps:</p>
                <ol className="list-decimal list-inside space-y-0.5">
                  <li>Share the email and password with the company admin securely</li>
                  <li>They log in to the admin portal with these credentials</li>
                  <li>They will be prompted to set a new permanent password immediately</li>
                </ol>
              </div>

              <button className="btn-primary w-full" onClick={onClose}>Done</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Branding Modal ───────────────────────────────────────────────────────────
function BrandingModal({ company, onClose, onSaved }: {
  company: Company; onClose: () => void; onSaved: () => void
}) {
  const [color, setColor]     = useState(company.brand_color || '#2563eb')
  const [logoUrl, setLogoUrl] = useState(company.brand_logo_url || '')
  const [saving, setSaving]   = useState(false)
  const [error, setError]     = useState('')
  const [saved, setSaved]     = useState(false)

  const PRESET_COLORS = [
    '#2563eb', // Blue (default)
    '#16a34a', // Green
    '#dc2626', // Red
    '#9333ea', // Purple
    '#ea580c', // Orange
    '#0891b2', // Cyan
    '#be185d', // Pink
    '#854d0e', // Brown
    '#1e293b', // Dark slate
    '#065f46', // Emerald dark
  ]

  async function handleSave() {
    setSaving(true); setError('')
    try {
      await api.update(company.id, { brandColor: color || null, brandLogoUrl: logoUrl || null })
      setSaved(true)
      onSaved()
      setTimeout(() => { setSaved(false); onClose() }, 1200)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save')
    }
    setSaving(false)
  }

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-900 border border-gray-800 rounded-xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-800">
          <div className="flex items-center gap-2">
            <Palette className="w-4 h-4 text-pink-400" />
            <h2 className="font-semibold text-white">Branding — {company.name}</h2>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <div className="p-5 space-y-5">
          {error && <div className="bg-red-900/30 border border-red-700/50 rounded px-4 py-2 text-red-400 text-sm">{error}</div>}

          {/* Preview bar */}
          <div className="rounded-xl overflow-hidden border border-gray-700">
            <div className="flex items-center gap-3 px-4 py-3" style={{ background: color }}>
              {logoUrl ? (
                <img src={logoUrl} alt="logo" className="h-7 w-7 rounded object-contain bg-white/10" />
              ) : (
                <div className="h-7 w-7 rounded bg-white/20 flex items-center justify-center text-white text-xs font-bold">
                  {company.name[0]}
                </div>
              )}
              <span className="text-white font-bold text-sm">{company.name}</span>
              <span className="ml-auto text-white/70 text-xs">Preview</span>
            </div>
          </div>

          {/* Brand Color */}
          <div>
            <label className="label mb-2 block">Brand Color</label>
            <div className="flex items-center gap-3 mb-3">
              <input
                type="color"
                value={color}
                onChange={e => setColor(e.target.value)}
                className="w-10 h-10 rounded cursor-pointer border border-gray-700 bg-transparent"
              />
              <input
                className="input flex-1 font-mono text-sm"
                value={color}
                onChange={e => setColor(e.target.value)}
                placeholder="#2563eb"
                maxLength={7}
              />
            </div>
            <div className="flex gap-2 flex-wrap">
              {PRESET_COLORS.map(c => (
                <button
                  key={c}
                  onClick={() => setColor(c)}
                  className={`w-7 h-7 rounded-full border-2 transition-transform hover:scale-110 ${color === c ? 'border-white scale-110' : 'border-transparent'}`}
                  style={{ background: c }}
                  title={c}
                />
              ))}
            </div>
          </div>

          {/* Logo URL */}
          <div>
            <label className="label mb-1 block">Company Logo URL</label>
            <p className="text-xs text-gray-500 mb-2">Paste a public image URL (PNG/SVG recommended). Shown in POS header after activation.</p>
            <input
              className="input w-full text-sm"
              placeholder="https://example.com/logo.png"
              value={logoUrl}
              onChange={e => setLogoUrl(e.target.value)}
            />
            {logoUrl && (
              <div className="mt-2 flex items-center gap-2 text-xs text-gray-400">
                <img src={logoUrl} alt="" className="h-8 rounded border border-gray-700 bg-gray-800 object-contain" onError={e => { (e.target as HTMLImageElement).style.display = 'none' }} />
                <span>Logo preview</span>
              </div>
            )}
          </div>

          <p className="text-xs text-gray-500">
            Changes take effect on the next POS device activation or re-sync.
          </p>
        </div>

        <div className="px-5 py-4 border-t border-gray-800 flex gap-3 justify-end">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary flex items-center gap-2" onClick={handleSave} disabled={saving}>
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Branding'}
          </button>
        </div>
      </div>
    </div>
  )
}
