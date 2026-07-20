import { useEffect, useState, FormEvent } from 'react'
import { settings as api, email as emailApi, me as meApi, danger as dangerApi, dbInfo as dbApi } from '../lib/api'
import { Save, Send, Mail, RotateCcw, Shield, Eye, EyeOff, AlertTriangle, Trash2, Building2, Database, RefreshCw, CheckCircle, XCircle, Wifi } from 'lucide-react'

type Tab = 'branding' | 'smtp' | 'sms' | 'defaults' | 'security' | 'database' | 'danger'

const TABS: { id: Tab; label: string; danger?: boolean }[] = [
  { id: 'branding',  label: 'Branding' },
  { id: 'smtp',      label: 'Email / SMTP' },
  { id: 'sms',       label: 'SMS' },
  { id: 'defaults',  label: 'Defaults' },
  { id: 'security',  label: 'Security' },
  { id: 'database',  label: 'Database' },
  { id: 'danger',    label: 'Danger Zone', danger: true },
]

const DEFAULT_COLOR = '#2563eb'

export default function SettingsPage() {
  const [tab, setTab]         = useState<Tab>('branding')
  const [data, setData]       = useState<Record<string, unknown>>({})
  const [saved, setSaved]     = useState(false)
  const [saveError, setSaveError] = useState('')
  const [loading, setLoading] = useState(false)

  // SMTP test
  const [testTo,      setTestTo]      = useState('')
  const [testLoading, setTestLoading] = useState(false)
  const [testResult,  setTestResult]  = useState<{ ok: boolean; msg: string } | null>(null)

  // Trial cron
  const [cronLoading, setCronLoading] = useState(false)
  const [cronResult,  setCronResult]  = useState<{ processed: number } | null>(null)

  // Security: profile
  const [profile, setProfile] = useState({ name: '', email: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileMsg, setProfileMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // Security: password
  const [pw, setPw] = useState({ current: '', newPw: '', confirm: '' })
  const [showCurrent, setShowCurrent] = useState(false)
  const [showNew,     setShowNew]     = useState(false)
  const [pwSaving, setPwSaving] = useState(false)
  const [pwMsg,    setPwMsg]    = useState<{ ok: boolean; text: string } | null>(null)

  // Database tab
  type DbInfo = Awaited<ReturnType<typeof dbApi.get>>
  const [dbData,      setDbData]      = useState<DbInfo | null>(null)
  const [dbLoading,   setDbLoading]   = useState(false)
  const [dbSearch,    setDbSearch]    = useState('')

  async function loadDbInfo() {
    setDbLoading(true)
    try { setDbData(await dbApi.get()) } catch { /* ignore */ }
    setDbLoading(false)
  }

  // Danger zone
  const [purgeConfirm, setPurgeConfirm] = useState(false)
  const [purgeLoading, setPurgeLoading] = useState(false)
  const [purgeResult,  setPurgeResult]  = useState<string | null>(null)

  useEffect(() => {
    api.get().then(d => {
      const s = d as Record<string, unknown>
      const branding = (s.branding ?? {}) as Record<string, string>
      if (!branding.primary_color || branding.primary_color === '#f9fafa' || branding.primary_color === '#ffffff') {
        branding.primary_color = DEFAULT_COLOR
        s.branding = branding
      }
      setData(s)
    }).catch(console.error)

    meApi.get().then(d => {
      setProfile({ name: d.name || '', email: d.email || '' })
    }).catch(console.error)
  }, [])

  useEffect(() => { if (tab === 'database' && !dbData) loadDbInfo() }, [tab])

  const section = (data[tab] ?? {}) as Record<string, string>
  const set = (k: string, v: string) =>
    setData(d => ({ ...d, [tab]: { ...(d[tab] as object ?? {}), [k]: v } }))

  async function save(e: FormEvent) {
    e.preventDefault()
    setLoading(true); setSaved(false); setSaveError('')
    try {
      await api.update({ [tab]: data[tab] })
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save')
    }
    setLoading(false)
  }

  async function sendTestEmail() {
    if (!testTo) return
    setTestLoading(true); setTestResult(null)
    try {
      await emailApi.test(testTo)
      setTestResult({ ok: true, msg: `Test email sent to ${testTo}` })
    } catch (err) {
      setTestResult({ ok: false, msg: err instanceof Error ? err.message : 'Failed' })
    }
    setTestLoading(false)
  }

  async function runTrialCron() {
    setCronLoading(true); setCronResult(null)
    try {
      const r = await emailApi.runTrialCron()
      setCronResult({ processed: r.processed })
    } catch {
      setCronResult({ processed: -1 })
    }
    setCronLoading(false)
  }

  async function saveProfile() {
    setProfileSaving(true); setProfileMsg(null)
    try {
      await meApi.updateProfile({ name: profile.name, email: profile.email })
      setProfileMsg({ ok: true, text: 'Profile updated successfully' })
    } catch (err) {
      setProfileMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed' })
    }
    setProfileSaving(false)
  }

  async function changePassword() {
    if (!pw.current || !pw.newPw) { setPwMsg({ ok: false, text: 'All fields required' }); return }
    if (pw.newPw !== pw.confirm) { setPwMsg({ ok: false, text: 'New passwords do not match' }); return }
    if (pw.newPw.length < 8) { setPwMsg({ ok: false, text: 'New password must be at least 8 characters' }); return }
    setPwSaving(true); setPwMsg(null)
    try {
      await meApi.changePassword(pw.current, pw.newPw)
      setPwMsg({ ok: true, text: 'Password changed successfully' })
      setPw({ current: '', newPw: '', confirm: '' })
    } catch (err) {
      setPwMsg({ ok: false, text: err instanceof Error ? err.message : 'Failed' })
    }
    setPwSaving(false)
  }

  async function purgeCancelled() {
    if (!purgeConfirm) { setPurgeConfirm(true); return }
    setPurgeLoading(true); setPurgeResult(null); setPurgeConfirm(false)
    try {
      const r = await dangerApi.purgeCancelledCompanies()
      const msg = `✓ Permanently deleted ${r.purged} cancelled company/companies`
      setPurgeResult(r.errors?.length ? msg + ` (${r.errors.length} errors)` : msg)
    } catch (err) {
      setPurgeResult(`✗ ${err instanceof Error ? err.message : 'Failed'}`)
    }
    setPurgeLoading(false)
  }

  const Field = ({ label, k, type = 'text', placeholder = '' }: {
    label: string; k: string; type?: string; placeholder?: string
  }) => (
    <div>
      <label className="label">{label}</label>
      <input className="input" type={type} placeholder={placeholder}
        value={section[k] ?? ''} onChange={e => set(k, e.target.value)} />
    </div>
  )

  const currentColor = section['primary_color'] || DEFAULT_COLOR
  const isSettingsTab = (['branding','smtp','sms','defaults'] as Tab[]).includes(tab)

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-bold text-white">System Settings</h1>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-800 flex-wrap">
        {TABS.map(t => (
          <button key={t.id}
            className={`px-4 py-2 text-sm font-medium rounded-t-lg -mb-px border-b-2 transition-colors ${
              tab === t.id
                ? t.danger ? 'text-red-400 border-red-500' : 'text-blue-400 border-blue-500'
                : t.danger ? 'text-red-500/60 border-transparent hover:text-red-400' : 'text-gray-400 border-transparent hover:text-white'
            }`}
            onClick={() => { setTab(t.id); setSaveError(''); setPwMsg(null); setProfileMsg(null) }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Settings tabs (branding, smtp, sms, defaults) with shared Save button ── */}
      {isSettingsTab && (
        <form onSubmit={save} className="card max-w-2xl space-y-4">

          {/* ── Branding ─────────────────────────────────────────────────────── */}
          {tab === 'branding' && <>
            <Field label="App Name"      k="app_name"      placeholder="Enterprise POS ERP" />
            <Field label="Tagline"       k="tagline"       placeholder="The SaaS ERP for modern retail" />
            <Field label="Support Email" k="support_email" type="email" placeholder="support@yourdomain.com" />
            <Field label="Logo URL"      k="logo_url"      placeholder="https://yourdomain.com/logo.png" />

            <div>
              <label className="label">Primary Color</label>
              <div className="flex items-center gap-3">
                <input type="color" value={currentColor}
                  onChange={e => set('primary_color', e.target.value)}
                  className="w-10 h-10 rounded cursor-pointer border border-gray-700 bg-transparent flex-shrink-0" />
                <input className="input flex-1 font-mono text-sm" value={currentColor}
                  onChange={e => set('primary_color', e.target.value)}
                  placeholder={DEFAULT_COLOR} maxLength={7} />
                <div className="w-10 h-10 rounded-lg flex-shrink-0 border border-gray-700"
                  style={{ background: currentColor }} title="Preview" />
                <button type="button" title="Reset to default blue"
                  onClick={() => set('primary_color', DEFAULT_COLOR)}
                  className="p-2 rounded hover:bg-gray-700 text-gray-400 hover:text-white flex-shrink-0">
                  <RotateCcw className="w-3.5 h-3.5" />
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                Affects sidebar, active nav, and email templates. Click ↺ to reset to default blue.
              </p>
            </div>
          </>}

          {/* ── SMTP ─────────────────────────────────────────────────────────── */}
          {tab === 'smtp' && <>
            <Field label="SMTP Host"  k="host"       placeholder="smtp.gmail.com" />
            <Field label="Port"       k="port"       type="number" placeholder="587" />
            <Field label="Username"   k="user"       placeholder="you@gmail.com" />
            <Field label="Password"   k="pass"       type="password" placeholder="••••••" />
            <Field label="From Name"  k="from_name"  placeholder="Enterprise POS ERP" />
            <Field label="From Email" k="from_email" type="email" placeholder="noreply@yourdomain.com" />

            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-3 flex items-center gap-2">
                <Mail className="w-3.5 h-3.5" /> Test Connection
              </p>
              <div className="flex gap-2">
                <input className="input flex-1 text-sm" type="email" placeholder="Send test email to…"
                  value={testTo} onChange={e => setTestTo(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && sendTestEmail()} />
                <button type="button" onClick={sendTestEmail} disabled={testLoading || !testTo}
                  className="btn-ghost flex items-center gap-1.5 text-sm flex-shrink-0">
                  <Send className="w-3.5 h-3.5" />
                  {testLoading ? 'Sending…' : 'Send Test'}
                </button>
              </div>
              {testResult && (
                <p className={`text-xs mt-2 ${testResult.ok ? 'text-green-400' : 'text-red-400'}`}>
                  {testResult.ok ? '✓ ' : '✗ '}{testResult.msg}
                </p>
              )}
            </div>

            <div className="border-t border-gray-700 pt-4">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-widest mb-2">Trial Expiry Emails</p>
              <p className="text-xs text-gray-500 mb-3">
                Sends warning emails to companies expiring in 7, 3, or 1 day(s).
              </p>
              <button type="button" onClick={runTrialCron} disabled={cronLoading}
                className="btn-ghost text-sm flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5" />
                {cronLoading ? 'Running…' : 'Send Trial Expiry Emails Now'}
              </button>
              {cronResult && (
                <p className={`text-xs mt-2 ${cronResult.processed >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {cronResult.processed >= 0
                    ? `✓ Processed ${cronResult.processed} company/companies`
                    : '✗ Failed — check SMTP settings above and save first'}
                </p>
              )}
            </div>
          </>}

          {/* ── SMS ──────────────────────────────────────────────────────────── */}
          {tab === 'sms' && <>
            <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-lg px-4 py-3 text-sm text-yellow-300">
              <p className="font-medium text-yellow-200 mb-1">⚠️ Storage Only — SMS Sending Not Active</p>
              <p className="text-xs text-yellow-300/80">
                These credentials are saved securely. Actual SMS sending (OTP, reminders) is not yet implemented.
                Save the keys now — they will be used when SMS features are enabled in a future update.
              </p>
            </div>
            <div>
              <label className="label">Provider</label>
              <select className="input" value={section.provider ?? 'twilio'} onChange={e => set('provider', e.target.value)}>
                <option value="twilio">Twilio</option>
                <option value="nexmo">Nexmo / Vonage</option>
                <option value="none">Disabled</option>
              </select>
            </div>
            <Field label="Account SID / API Key" k="account_sid" />
            <Field label="Auth Token"             k="auth_token" type="password" placeholder="••••••" />
            <Field label="From Number"            k="from_number" placeholder="+1234567890" />
          </>}

          {/* ── Defaults ─────────────────────────────────────────────────────── */}
          {tab === 'defaults' && <>
            <p className="text-xs text-gray-500">
              These values auto-fill when creating a new company. Change them once and all future companies use the new defaults.
            </p>
            <Field label="Trial Days"       k="trial_days"       type="number" placeholder="14" />
            <Field label="Default Timezone" k="default_timezone" placeholder="Asia/Colombo" />
            <Field label="Default Currency" k="default_currency" placeholder="LKR" />
            <Field label="Default Country"  k="default_country"  placeholder="LK" />
          </>}

          {/* Save row */}
          <div className="flex items-center gap-3 pt-2 border-t border-gray-800">
            <button type="submit" className="btn-primary flex items-center gap-2" disabled={loading}>
              <Save className="w-4 h-4" /> {loading ? 'Saving…' : 'Save Changes'}
            </button>
            {saved && <span className="text-green-400 text-sm">✓ Saved!</span>}
            {saveError && <span className="text-red-400 text-sm">✗ {saveError}</span>}
          </div>
        </form>
      )}

      {/* ── Database Tab ──────────────────────────────────────────────────────── */}
      {tab === 'database' && (
        <div className="max-w-4xl space-y-5">

          {/* Connection Status Card */}
          <div className="card space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-blue-400" />
                <h2 className="font-semibold text-white text-sm">Database Connection</h2>
              </div>
              <button className="btn-ghost text-xs flex items-center gap-1.5" onClick={loadDbInfo} disabled={dbLoading}>
                <RefreshCw className={`w-3.5 h-3.5 ${dbLoading ? 'animate-spin' : ''}`} />
                {dbLoading ? 'Testing…' : 'Test Connection'}
              </button>
            </div>

            {dbData ? (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: 'Type',     value: dbData.connection.type },
                  { label: 'Host',     value: dbData.connection.host },
                  { label: 'Database', value: dbData.connection.database || '—' },
                  { label: 'Ping',     value: dbData.connection.ping_ms != null ? `${dbData.connection.ping_ms} ms` : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-lg p-3" style={{ background: '#0d1117', border: '1px solid #1e293b' }}>
                    <p className="text-xs text-gray-500 mb-1">{label}</p>
                    <p className="text-sm font-mono text-white truncate">{value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500">{dbLoading ? 'Connecting…' : 'Click "Test Connection" to check status'}</p>
            )}

            {dbData && (
              <div className={`flex items-center gap-2 text-sm ${dbData.connection.status === 'connected' ? 'text-green-400' : 'text-red-400'}`}>
                {dbData.connection.status === 'connected'
                  ? <><CheckCircle className="w-4 h-4" /> Connected successfully</>
                  : <><XCircle className="w-4 h-4" /> {dbData.error || 'Connection failed'}</>
                }
              </div>
            )}

            <div className="rounded-lg px-4 py-3 text-xs text-blue-300" style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)' }}>
              <p className="font-semibold mb-1 flex items-center gap-1.5"><Wifi className="w-3 h-3" /> Architecture Overview</p>
              <ul className="space-y-0.5 text-blue-300/80">
                <li>• <strong className="text-blue-200">SuperAdmin DB</strong> — Main MySQL: companies, packages, subscriptions, settings</li>
                <li>• <strong className="text-blue-200">Per-Company DB</strong> — Tenant MySQL (pos_company_*): users, products, invoices, stock</li>
                <li>• <strong className="text-blue-200">POS Electron</strong> — Local SQLite (offline-first) + syncs to tenant MySQL every 30s</li>
              </ul>
            </div>
          </div>

          {/* Stats */}
          {dbData && (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {[
                { label: 'Total',     value: dbData.stats.total_companies, color: 'text-white' },
                { label: 'Active',    value: dbData.stats.active,          color: 'text-green-400' },
                { label: 'Trial',     value: dbData.stats.trial,           color: 'text-yellow-400' },
                { label: 'Suspended', value: dbData.stats.suspended,       color: 'text-orange-400' },
                { label: 'Cancelled', value: dbData.stats.cancelled,       color: 'text-gray-500' },
              ].map(({ label, value, color }) => (
                <div key={label} className="card text-center py-3">
                  <p className={`text-2xl font-bold ${color}`}>{value}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
          )}

          {/* Tenant Database List */}
          {dbData && dbData.tenants.length > 0 && (
            <div className="card space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold text-white text-sm flex items-center gap-2">
                  <Database className="w-4 h-4 text-indigo-400" />
                  Tenant Databases ({dbData.tenants.length})
                </h2>
                <input
                  className="input text-sm w-48"
                  placeholder="Filter companies…"
                  value={dbSearch}
                  onChange={e => setDbSearch(e.target.value)}
                />
              </div>
              <div className="overflow-auto max-h-96">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-800">
                      {['Company','Slug','Database Schema','Status','Size'].map(h => (
                        <th key={h} className="text-left text-xs text-gray-500 font-medium px-3 py-2">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {dbData.tenants
                      .filter(t => !dbSearch || t.name.toLowerCase().includes(dbSearch.toLowerCase()) || t.slug.includes(dbSearch.toLowerCase()))
                      .map(t => (
                        <tr key={t.id} className="border-b border-gray-800/50 hover:bg-white/[0.02]">
                          <td className="px-3 py-2 text-white font-medium">{t.name}</td>
                          <td className="px-3 py-2 text-gray-400 font-mono text-xs">{t.slug}</td>
                          <td className="px-3 py-2 text-indigo-300 font-mono text-xs">{t.db_schema}</td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-0.5 rounded font-medium ${
                              t.status === 'active' ? 'bg-green-900/40 text-green-400' :
                              t.status === 'trial'  ? 'bg-yellow-900/40 text-yellow-400' :
                              t.status === 'suspended' ? 'bg-red-900/40 text-red-400' :
                              'bg-gray-800 text-gray-500'
                            }`}>{t.status}</span>
                          </td>
                          <td className="px-3 py-2 text-gray-400 text-xs">
                            {t.size_mb != null ? `${t.size_mb} MB` : '—'}
                          </td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Security Tab ──────────────────────────────────────────────────────── */}
      {tab === 'security' && (
        <div className="max-w-2xl space-y-6">

          {/* Profile */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
              <Shield className="w-4 h-4 text-blue-400" />
              <h2 className="font-semibold text-white text-sm">My Profile</h2>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name</label>
                <input className="input" value={profile.name}
                  onChange={e => setProfile(p => ({ ...p, name: e.target.value }))} />
              </div>
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" value={profile.email}
                  onChange={e => setProfile(p => ({ ...p, email: e.target.value }))} />
              </div>
            </div>
            {profileMsg && (
              <p className={`text-sm ${profileMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                {profileMsg.ok ? '✓ ' : '✗ '}{profileMsg.text}
              </p>
            )}
            <div className="flex justify-end pt-1">
              <button className="btn-primary flex items-center gap-2 text-sm" disabled={profileSaving}
                onClick={saveProfile}>
                <Save className="w-3.5 h-3.5" />
                {profileSaving ? 'Saving…' : 'Update Profile'}
              </button>
            </div>
          </div>

          {/* Password */}
          <div className="card space-y-4">
            <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
              <Shield className="w-4 h-4 text-indigo-400" />
              <h2 className="font-semibold text-white text-sm">Change Password</h2>
            </div>

            <div>
              <label className="label">Current Password</label>
              <div className="relative">
                <input className="input w-full pr-9" type={showCurrent ? 'text' : 'password'}
                  value={pw.current} onChange={e => setPw(p => ({ ...p, current: e.target.value }))} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  onClick={() => setShowCurrent(v => !v)}>
                  {showCurrent ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="label">New Password</label>
              <div className="relative">
                <input className="input w-full pr-9" type={showNew ? 'text' : 'password'}
                  placeholder="Min 8 characters"
                  value={pw.newPw} onChange={e => setPw(p => ({ ...p, newPw: e.target.value }))} />
                <button type="button" className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                  onClick={() => setShowNew(v => !v)}>
                  {showNew ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <div>
              <label className="label">Confirm New Password</label>
              <input className="input w-full" type="password" placeholder="Repeat new password"
                value={pw.confirm} onChange={e => setPw(p => ({ ...p, confirm: e.target.value }))} />
              {pw.confirm && pw.newPw !== pw.confirm && (
                <p className="text-xs text-red-400 mt-1">Passwords do not match</p>
              )}
            </div>

            {pwMsg && (
              <p className={`text-sm ${pwMsg.ok ? 'text-green-400' : 'text-red-400'}`}>
                {pwMsg.ok ? '✓ ' : '✗ '}{pwMsg.text}
              </p>
            )}

            <div className="flex justify-end pt-1">
              <button
                className="btn-primary text-sm flex items-center gap-2"
                disabled={pwSaving || !pw.current || !pw.newPw || pw.newPw !== pw.confirm}
                onClick={changePassword}
              >
                <Shield className="w-3.5 h-3.5" />
                {pwSaving ? 'Changing…' : 'Change Password'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Danger Zone Tab ───────────────────────────────────────────────────── */}
      {tab === 'danger' && (
        <div className="max-w-2xl space-y-5">

          {/* Purge Cancelled Companies */}
          <div className="card space-y-4" style={{ borderColor: 'rgba(239,68,68,0.3)' }}>
            <div className="flex items-center gap-2 pb-3 border-b border-gray-800">
              <AlertTriangle className="w-4 h-4 text-red-400" />
              <div>
                <h2 className="font-semibold text-red-300 text-sm">Purge Cancelled Companies</h2>
                <p className="text-xs text-gray-500">Permanently delete all cancelled companies and their entire databases</p>
              </div>
            </div>

            <div className="bg-red-900/20 border border-red-700/30 rounded-lg px-4 py-3 text-xs text-red-300 flex items-start gap-2">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>This permanently destroys all data for every company with status "Cancelled". This cannot be undone. Use only for clean-up of old inactive tenants.</span>
            </div>

            {purgeResult && (
              <p className={`text-sm ${purgeResult.startsWith('✓') ? 'text-green-400' : 'text-red-400'}`}>
                {purgeResult}
              </p>
            )}

            {purgeConfirm ? (
              <div className="flex gap-2">
                <button className="btn-ghost text-sm" onClick={() => setPurgeConfirm(false)}>
                  Cancel
                </button>
                <button
                  className="px-4 py-2 rounded-lg bg-red-700 hover:bg-red-600 text-white text-sm font-semibold disabled:opacity-50 flex items-center gap-1.5"
                  onClick={purgeCancelled} disabled={purgeLoading}>
                  <Building2 className="w-3.5 h-3.5" />
                  {purgeLoading ? 'Purging…' : 'Yes, Permanently Delete All Cancelled'}
                </button>
              </div>
            ) : (
              <button
                className="btn-ghost text-sm text-red-400 hover:text-red-300 flex items-center gap-1.5"
                onClick={purgeCancelled}>
                <Trash2 className="w-3.5 h-3.5" />
                Purge All Cancelled Companies…
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
