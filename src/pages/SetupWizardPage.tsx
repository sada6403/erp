import { useState } from 'react'
import type React from 'react'
import { useNavigate } from 'react-router-dom'
import { ShieldOff, Eye, EyeOff, CheckCircle2, WifiOff, AlertCircle, Settings, HardDrive } from 'lucide-react'
import toast from 'react-hot-toast'

type View = 'contact' | 'configure' | 'connecting' | 'syncing' | 'done' | 'no_users'

export default function SetupWizardPage() {
  const navigate = useNavigate()
  const [view, setView] = useState<View>('contact')
  const [apiUrl, setApiUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [showKey, setShowKey] = useState(false)
  const [companyName, setCompanyName] = useState('')
  const [error, setError] = useState('')
  // Secret tap counter — tap the icon 5 times to reveal configure form
  const [tapCount, setTapCount] = useState(0)

  function handleIconTap() {
    const next = tapCount + 1
    setTapCount(next)
    if (next >= 5) {
      setTapCount(0)
      setView('configure')
    }
  }

  async function handleConnect(e: React.FormEvent) {
    e.preventDefault()
    setError('')

    const url = apiUrl.trim().replace(/\/$/, '')
    const key = apiKey.trim()

    if (!url || !key) {
      setError('Both fields are required.')
      return
    }

    setView('connecting')
    try {
      const resp = await fetch(`${url}/api/brand`, {
        headers: { 'x-api-key': key },
      })

      if (resp.status === 401) {
        setView('configure')
        setError('Invalid API Key. Check with your administrator.')
        return
      }
      if (resp.status === 403) {
        setView('configure')
        setError('This company account is suspended or cancelled.')
        return
      }
      if (!resp.ok) {
        setView('configure')
        setError(`Cannot reach server (${resp.status}). Check the API URL.`)
        return
      }

      const brand = await resp.json()
      if (!brand.company_name) {
        setView('configure')
        setError('Unexpected server response.')
        return
      }
      setCompanyName(brand.company_name)

      const api = (window as unknown as { api: {
        settings: { update: (p: unknown) => Promise<unknown> }
        admin: { branches: { findByCode: (code: string) => Promise<{ success: boolean; data?: { id: string } }>, update: (id: string, p: unknown) => Promise<unknown> } }
      } }).api

      await api.settings.update({
        cloud_api_url:   url,
        cloud_api_key:   key,
        company_name:    brand.company_name,
        company_email:   brand.company_email  ?? '',
        company_phone:   brand.company_phone  ?? '',
        receipt_header:  brand.company_name,
        ...(brand.brand_color    ? { brand_color:      brand.brand_color }    : {}),
        ...(brand.brand_logo_url ? { company_logo_url: brand.brand_logo_url } : {}),
      })

      // Update Main Branch with company contact details from SuperAdmin
      try {
        const branchRes = await api.admin.branches.findByCode('MAIN')
        if (branchRes.success && branchRes.data?.id) {
          await api.admin.branches.update(branchRes.data.id, {
            name:    brand.company_name,
            phone:   brand.company_phone  ?? '',
            email:   brand.company_email  ?? '',
            address: brand.company_address ?? '',
          })
        }
      } catch { /* non-fatal — branch update fails silently */ }

      setView('syncing')
      await (window as unknown as { api: { sync: { trigger: () => Promise<void> } } }).api.sync.trigger()

      const stillEmpty = await (window as unknown as {
        api: { admin: { isSetupRequired: () => Promise<boolean> } }
      }).api.admin.isSetupRequired()

      if (stillEmpty) {
        setView('no_users')
        return
      }

      setView('done')
      setTimeout(() => navigate('/login', { replace: true }), 2500)
    } catch (err) {
      setView('configure')
      setError('Connection failed: ' + String(err))
    }
  }

  // ── Connecting / Syncing spinner ──────────────────────────────────────────
  if (view === 'connecting' || view === 'syncing') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-center space-y-5">
          <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          <div>
            <h2 className="text-lg font-semibold" style={{ color: 'var(--text-1)' }}>
              {view === 'connecting' ? 'Verifying connection…' : 'Syncing your data…'}
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
              {view === 'connecting'
                ? 'Checking your API key with the cloud server'
                : 'Pulling accounts and settings from the cloud'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Done ──────────────────────────────────────────────────────────────────
  if (view === 'done') {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ background: 'var(--bg-base)' }}>
        <div className="text-center space-y-4">
          <CheckCircle2 className="w-16 h-16 text-green-400 mx-auto" />
          <h2 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Connected!</h2>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            {companyName} synced successfully. Redirecting to login…
          </p>
        </div>
      </div>
    )
  }

  // ── No users found after sync ─────────────────────────────────────────────
  if (view === 'no_users') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-sm text-center space-y-5">
          <div className="w-14 h-14 rounded-2xl bg-amber-600/20 flex items-center justify-center mx-auto">
            <WifiOff className="w-8 h-8 text-amber-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>No Accounts Found</h2>
            <p className="text-sm mt-2" style={{ color: 'var(--text-2)' }}>
              Connected to <strong>{companyName}</strong> but no user accounts have been set up yet.
            </p>
            <p className="text-sm mt-1" style={{ color: 'var(--text-3)' }}>
              Ask your administrator to create your account, then try again.
            </p>
          </div>
          <button className="btn-primary w-full py-2.5" onClick={() => { setView('contact'); setError('') }}>
            Back
          </button>
        </div>
      </div>
    )
  }

  // ── Configure form (hidden — only shown after 5 taps on icon) ────────────
  if (view === 'configure') {
    return (
      <div className="min-h-screen flex items-center justify-center p-4" style={{ background: 'var(--bg-base)' }}>
        <div className="w-full max-w-md">
          <div className="text-center mb-6">
            <div className="w-12 h-12 rounded-xl bg-blue-600/20 flex items-center justify-center mx-auto mb-3">
              <Settings className="w-6 h-6 text-blue-400" />
            </div>
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>Terminal Configuration</h1>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>For authorized personnel only</p>
          </div>

          <form onSubmit={handleConnect} className="space-y-4 rounded-2xl p-6" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                Cloud API URL
              </label>
              <input
                className="input w-full"
                type="url"
                required
                placeholder="https://your-server.com"
                value={apiUrl}
                onChange={e => setApiUrl(e.target.value)}
                autoFocus
              />
            </div>

            <div>
              <label className="block text-xs font-semibold mb-1.5" style={{ color: 'var(--text-2)' }}>
                API Key
              </label>
              <div className="relative">
                <input
                  className="input w-full pr-10"
                  type={showKey ? 'text' : 'password'}
                  required
                  placeholder="Paste your API key here"
                  value={apiKey}
                  onChange={e => setApiKey(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-3 top-1/2 -translate-y-1/2"
                  style={{ color: 'var(--text-3)' }}
                  onClick={() => setShowKey(p => !p)}
                >
                  {showKey ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div className="flex items-start gap-2 rounded-lg px-3 py-2.5 text-sm text-red-400" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={!apiUrl.trim() || !apiKey.trim()}
              className="btn-primary w-full py-2.5"
            >
              Connect &amp; Sync
            </button>

            <button
              type="button"
              className="w-full py-2 text-sm"
              style={{ color: 'var(--text-3)' }}
              onClick={() => { setView('contact'); setError('') }}
            >
              Cancel
            </button>
          </form>

          <div className="mt-4 rounded-xl p-4 text-center" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
            <p className="text-xs mb-3" style={{ color: 'var(--text-3)' }}>
              No cloud server? Set up this terminal for local offline use.
            </p>
            <button
              type="button"
              onClick={async () => {
                const res = await (window as unknown as { api: { admin: { seedLocalDefaults: () => Promise<{ success: boolean; error?: string }> } } }).api.admin.seedLocalDefaults()
                if (res.success) {
                  toast.success('Local setup complete!')
                  setTimeout(() => navigate('/login', { replace: true }), 800)
                } else {
                  toast.error(res.error || 'Setup failed')
                }
              }}
              className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg text-sm font-semibold"
              style={{ background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8' }}
            >
              <HardDrive size={14} />
              Setup Locally (No Cloud)
            </button>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
              Login: <span className="font-mono">admin@pos.local</span> / <span className="font-mono">admin123</span> · PIN: <span className="font-mono">1234</span>
            </p>
          </div>
        </div>
      </div>
    )
  }

  // ── Default: Contact SuperAdmin (shown to all users) ──────────────────────
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6" style={{ background: 'var(--bg-base)' }}>
      <div className="text-center max-w-sm space-y-6">
        {/* Tap 5 times on this icon to reveal the configure form */}
        <button
          type="button"
          onClick={handleIconTap}
          className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto focus:outline-none"
          style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
          tabIndex={-1}
        >
          <ShieldOff className="w-10 h-10" style={{ color: 'var(--text-3)' }} />
        </button>

        <div>
          <h1 className="text-xl font-bold" style={{ color: 'var(--text-1)' }}>
            Terminal Not Activated
          </h1>
          <p className="text-sm mt-2 leading-relaxed" style={{ color: 'var(--text-2)' }}>
            This POS terminal has not been set up yet.
          </p>
          <p className="text-sm mt-1 leading-relaxed" style={{ color: 'var(--text-3)' }}>
            Please contact your <strong style={{ color: 'var(--text-2)' }}>System Administrator</strong> to
            activate this device.
          </p>
        </div>

        <div className="rounded-xl p-4 text-left space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <p className="text-xs font-semibold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>
            What to tell your administrator
          </p>
          <ul className="text-sm space-y-1" style={{ color: 'var(--text-2)' }}>
            <li>• This terminal needs a Cloud API Key</li>
            <li>• The key is issued from the SuperAdmin Portal</li>
            <li>• Once activated, you can log in normally</li>
          </ul>
        </div>

        <p className="text-xs" style={{ color: 'var(--text-4)' }}>
          Enterprise POS ERP
        </p>
      </div>
    </div>
  )
}
