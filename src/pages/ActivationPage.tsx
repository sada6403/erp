import { useState, useEffect } from 'react'
import { Loader2, CheckCircle2, Monitor, Globe, GitBranch, ChevronRight, ShieldCheck, ArrowLeft, Settings } from 'lucide-react'

interface Branch { id: string; name: string; address?: string }
interface VerifyResult {
  company_id: string; company_name: string; package_name: string
  sub_status: string; brand_color: string | null; brand_logo_url: string | null
  active_devices: number; max_devices: number; device_slots_left: number
  branches: Branch[]
}

type Step = 'key' | 'branch' | 'activating' | 'done'

interface Props { onActivated: () => void }
type VerifyResponse = VerifyResult & { success?: boolean; error?: string }

const DEFAULT_API_URL =
  (import.meta.env.VITE_CLOUD_API_URL as string | undefined)?.trim().replace(/\/+$/, '') ||
  'http://72.61.115.222:4001'

export default function ActivationPage({ onActivated }: Props) {
  const [step, setStep]             = useState<Step>('key')
  const [companyKey, setCompanyKey] = useState('')
  const [apiUrl, setApiUrl]         = useState(DEFAULT_API_URL)
  const [showServerSettings, setShowServerSettings] = useState(false)
  const [supportTapCount, setSupportTapCount] = useState(0)
  const [deviceName, setDeviceName] = useState('')
  const [selectedBranch, setSelectedBranch] = useState<Branch | null>(null)
  const [verifyResult, setVerifyResult]     = useState<VerifyResult | null>(null)
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [companyName, setCompanyName] = useState('')

  useEffect(() => {
    if (!window.api?.app) return
    window.api.app.getDeviceInfo().then((info: Record<string, string>) => {
      setDeviceName(info.device_name ?? '')
    })
    const saved = localStorage.getItem('activation_api_url')?.trim().replace(/\/+$/, '')
    if (saved && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(saved)) {
      setApiUrl(saved)
    } else if (saved) {
      localStorage.setItem('activation_api_url', DEFAULT_API_URL)
      setApiUrl(DEFAULT_API_URL)
    }
  }, [])

  function handleSupportUnlock() {
    const next = supportTapCount + 1
    setSupportTapCount(next)
    if (next >= 5) {
      setSupportTapCount(0)
      setShowServerSettings(true)
    }
  }

  // Step 1 — Verify company key
  async function handleVerify() {
    if (!companyKey.trim()) { setError('Company key is required'); return }
    const serverUrl = apiUrl.trim().replace(/\/+$/, '')
    if (!serverUrl) {
      setError('Activation server is not configured. Open Server Settings and enter the API URL.')
      setShowServerSettings(true)
      return
    }
    setLoading(true); setError('')
    try {
      let data: VerifyResponse
      if (window.api?.app?.verifyCompanyKey) {
        data = await window.api.app.verifyCompanyKey({
          company_key: companyKey.trim(),
          cloud_api_url: serverUrl,
        }) as VerifyResponse
        if (!data.success) { setError(`${data.error ?? 'Verification failed'} (Server: ${serverUrl})`); setLoading(false); return }
      } else {
        const url = `${serverUrl}/api/activate/verify?company_key=${encodeURIComponent(companyKey.trim())}`
        const res = await fetch(url)
        data = await res.json() as VerifyResponse
        if (!res.ok) { setError(`${data.error ?? 'Verification failed'} (Server: ${serverUrl})`); setLoading(false); return }
      }
      if (data.device_slots_left <= 0) {
        setError(`Device limit reached (${data.active_devices}/${data.max_devices}). Please upgrade your subscription.`)
        setLoading(false); return
      }
      setVerifyResult(data)
      setCompanyName(data.company_name)
      localStorage.setItem('activation_api_url', serverUrl)
      setStep('branch')
    } catch (err) {
      setError('Cannot reach the backend. Check the Cloud API URL.')
    }
    setLoading(false)
  }

  // Step 2 — Activate with selected branch
  async function handleActivate() {
    setStep('activating'); setError('')
    try {
      const res = await window.api.app.activate({
        company_key:   companyKey.trim(),
        cloud_api_url: apiUrl.trim().replace(/\/+$/, ''),
        branch_id:     selectedBranch?.id ?? null,
        device_name:   deviceName,
      }) as Record<string, unknown>

      if (!res.success) {
        setError(String(res.error ?? 'Activation failed'))
        setStep('branch')
      } else {
        setStep('done')
        setTimeout(() => onActivated(), 2000)
      }
    } catch (err) {
      setError((err as Error).message)
      setStep('branch')
    }
  }

  const subBadge = (s: string) => ({
    active:  'bg-green-500/20 text-green-400',
    trial:   'bg-yellow-500/20 text-yellow-400',
    grace:   'bg-orange-500/20 text-orange-400',
    expired: 'bg-red-500/20 text-red-400',
  }[s] ?? 'bg-gray-700 text-gray-400')

  return (
    <div className="min-h-screen flex" style={{ background: '#0f1117' }}>
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-[400px] flex-shrink-0 p-10"
        style={{ background: 'linear-gradient(160deg, #052e16 0%, #14532d 100%)' }}>
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-white/10 flex items-center justify-center">
            <ShieldCheck className="w-5 h-5 text-emerald-300" />
          </div>
          <span className="text-white font-bold text-lg tracking-tight">Enterprise POS ERP</span>
        </div>

        <div>
          <h1 className="text-3xl font-bold text-white leading-snug mb-3">
            {step === 'key'    ? <>Enter your<br />Company Key.</> :
             step === 'branch' ? <>Select your<br />Branch.</> :
             step === 'done'   ? <>All set!</> :
             <>Activating…</>}
          </h1>
          <p className="text-emerald-200 text-sm leading-relaxed">
            {step === 'key'
              ? 'Your platform administrator provides one Company Key for your entire organisation. All devices use the same key.'
              : step === 'branch'
              ? 'Select which branch this POS device belongs to. You can change this later from Admin → Branches.'
              : 'Connecting this device to your company account and downloading your data.'}
          </p>

          {/* Steps indicator */}
          <div className="mt-8 space-y-3">
            {[
              { s: 'key',    label: 'Enter Company Key' },
              { s: 'branch', label: 'Select Branch' },
              { s: 'done',   label: 'Start Selling' },
            ].map(({ s, label }, i) => {
              const current = step === s
              const done    = (step === 'branch' && i === 0) || (step === 'done')
              return (
                <div key={s} className={`flex items-center gap-3 text-sm ${current ? 'text-white' : done ? 'text-emerald-400' : 'text-emerald-800'}`}>
                  <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${current ? 'bg-emerald-500 text-white' : done ? 'bg-emerald-500/30 text-emerald-400' : 'bg-white/10'}`}>
                    {done ? '✓' : i + 1}
                  </span>
                  {label}
                </div>
              )
            })}
          </div>
        </div>

        <div className="space-y-3 text-sm text-emerald-200">
          {['Offline-first — works without internet', 'Auto-sync every 30 seconds', 'One key for all your devices'].map(t => (
            <div key={t} className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span>{t}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">

          {/* ── Done ── */}
          {step === 'done' && (
            <div className="text-center space-y-4">
              <div className="w-16 h-16 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-9 h-9 text-green-400" />
              </div>
              <h2 className="text-2xl font-bold text-white">Activated!</h2>
              <p className="text-gray-400">Connected to <span className="text-white font-semibold">{companyName}</span></p>
              {selectedBranch && <p className="text-sm text-gray-500">Branch: {selectedBranch.name}</p>}
              <p className="text-sm text-gray-500">Redirecting to login…</p>
            </div>
          )}

          {/* ── Activating spinner ── */}
          {step === 'activating' && (
            <div className="text-center space-y-4">
              <Loader2 className="w-12 h-12 animate-spin text-emerald-400 mx-auto" />
              <h2 className="text-xl font-bold text-white">Activating device…</h2>
              <p className="text-gray-400 text-sm">Connecting to {companyName}</p>
            </div>
          )}

          {/* ── Step 1: Company Key ── */}
          {step === 'key' && (
            <div className="space-y-6">
              <div>
                <button type="button" onClick={handleSupportUnlock} className="text-left">
                  <h2 className="text-2xl font-bold text-white mb-1">Device Activation</h2>
                </button>
                <p className="text-sm text-gray-400">Enter the Company Key provided by your administrator</p>
              </div>

              <div className="rounded-xl border px-4 py-3 flex items-center gap-3" style={{ borderColor: '#2a2d3a', background: '#16181f' }}>
                <Monitor className="w-5 h-5 text-gray-500 flex-shrink-0" />
                <div>
                  <p className="text-xs text-gray-500">This device</p>
                  <p className="text-sm text-white font-medium">{deviceName || 'Loading…'}</p>
                </div>
              </div>

              {error && <div className="rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3 text-red-400 text-sm">{error}</div>}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">Company Activation Key</label>
                  <div className="relative">
                    <ShieldCheck className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                    <input
                      className="w-full pl-10 pr-4 py-3 rounded-xl font-mono text-sm text-white border outline-none focus:border-emerald-500 transition-colors"
                      style={{ background: '#16181f', borderColor: '#2a2d3a' }}
                      placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                      value={companyKey}
                      onChange={e => setCompanyKey(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleVerify()}
                    />
                  </div>
                </div>
                {showServerSettings && (
                <div className="rounded-xl border" style={{ borderColor: '#2a2d3a', background: '#12151d' }}>
                  <button
                    type="button"
                    onClick={() => setShowServerSettings(v => !v)}
                    className="w-full px-4 py-3 flex items-center gap-2 text-sm font-medium"
                    style={{ color: '#94a3b8' }}
                  >
                    <Settings className="w-4 h-4" />
                    <span className="flex-1 text-left">Server Settings</span>
                    <ChevronRight className={`w-4 h-4 transition-transform ${showServerSettings ? 'rotate-90' : ''}`} />
                  </button>
                  {showServerSettings && (
                    <div className="px-4 pb-4">
                      <label className="block text-xs font-medium text-gray-400 mb-1.5">Cloud API URL</label>
                      <div className="relative">
                        <Globe className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                        <input
                          className="w-full pl-10 pr-4 py-3 rounded-xl font-mono text-sm text-white border outline-none focus:border-emerald-500 transition-colors"
                          style={{ background: '#16181f', borderColor: '#2a2d3a' }}
                          placeholder="https://pos-api.example.com"
                          value={apiUrl}
                          onChange={e => setApiUrl(e.target.value)}
                        />
                      </div>
                      <p className="text-xs text-gray-600 mt-1">Only change this if support asks you to.</p>
                    </div>
                  )}
                </div>
                )}
              </div>

              <button onClick={handleVerify} disabled={loading}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-60"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying…</> : <>Verify Key <ChevronRight className="w-4 h-4" /></>}
              </button>
            </div>
          )}

          {/* ── Step 2: Branch Selection ── */}
          {step === 'branch' && verifyResult && (
            <div className="space-y-5">
              <div className="flex items-center gap-3">
                <button onClick={() => { setStep('key'); setError('') }} className="p-1.5 rounded-lg hover:bg-white/10 text-gray-400">
                  <ArrowLeft className="w-4 h-4" />
                </button>
                <div>
                  <h2 className="text-xl font-bold text-white">{verifyResult.company_name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-gray-500">{verifyResult.package_name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${subBadge(verifyResult.sub_status)}`}>
                      {verifyResult.sub_status}
                    </span>
                    <span className="text-xs text-gray-500">
                      {verifyResult.active_devices}/{verifyResult.max_devices} devices
                    </span>
                  </div>
                </div>
              </div>

              {error && <div className="rounded-xl border border-red-700/50 bg-red-900/20 px-4 py-3 text-red-400 text-sm">{error}</div>}

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-2">
                  <GitBranch className="inline w-3 h-3 mr-1" />Select Branch
                </label>
                <div className="space-y-2 max-h-52 overflow-y-auto pr-1">
                  {verifyResult.branches.length === 0 ? (
                    <div
                      className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ${!selectedBranch ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-gray-700 text-gray-300 hover:border-gray-600'}`}
                      onClick={() => setSelectedBranch(null)}
                      style={{ background: !selectedBranch ? undefined : '#16181f' }}
                    >
                      <p className="font-medium">Main Branch</p>
                      <p className="text-xs text-gray-500 mt-0.5">Default branch (no branches configured)</p>
                    </div>
                  ) : (
                    verifyResult.branches.map(b => (
                      <div key={b.id}
                        className={`w-full text-left px-4 py-3 rounded-xl border text-sm transition-colors cursor-pointer ${selectedBranch?.id === b.id ? 'border-emerald-500 bg-emerald-500/10 text-emerald-400' : 'border-gray-700 text-gray-300 hover:border-gray-600'}`}
                        onClick={() => setSelectedBranch(b)}
                        style={{ background: selectedBranch?.id === b.id ? undefined : '#16181f' }}
                      >
                        <p className="font-medium">{b.name}</p>
                        {b.address && <p className="text-xs text-gray-500 mt-0.5">{b.address}</p>}
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-400 mb-1.5">Device Name</label>
                <div className="relative">
                  <Monitor className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                  <input
                    className="w-full pl-10 pr-4 py-3 rounded-xl text-sm text-white border outline-none focus:border-emerald-500 transition-colors"
                    style={{ background: '#16181f', borderColor: '#2a2d3a' }}
                    placeholder="e.g. Counter 1, Cashier Station"
                    value={deviceName}
                    onChange={e => setDeviceName(e.target.value)}
                  />
                </div>
              </div>

              <button onClick={handleActivate} disabled={!deviceName.trim()}
                className="w-full py-3 rounded-xl font-semibold text-white text-sm transition-all flex items-center justify-center gap-2 disabled:opacity-40"
                style={{ background: 'linear-gradient(135deg, #16a34a, #15803d)' }}>
                <ShieldCheck className="w-4 h-4" /> Activate Device
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
