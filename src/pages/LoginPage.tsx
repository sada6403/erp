import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { ShoppingBag, Cpu, Lock, Mail, Hash, GitBranch, ArrowRight, X } from 'lucide-react'
import toast from 'react-hot-toast'

function getPerms(u: unknown): Record<string, unknown> {
  const user = u as Record<string, unknown>
  return (user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>
    || user?.permissions as Record<string, unknown>
    || {}
}

function redirectByRole(perms: Record<string, unknown>) {
  // Admin-level roles go to dashboard; cashier/warehouse/delivery go to POS or their default
  if (perms.all || perms.reports || perms.employees || perms.inventory) return '/admin'
  return '/pos'
}

const TERMINAL_BRANCH_KEY = 'pos_terminal_branch'

function getStoredBranch(): { id: string; name: string; code: string } | null {
  try { return JSON.parse(localStorage.getItem(TERMINAL_BRANCH_KEY) || 'null') } catch { return null }
}
function setStoredBranch(b: { id: string; name: string; code: string } | null) {
  if (b) localStorage.setItem(TERMINAL_BRANCH_KEY, JSON.stringify(b))
  else localStorage.removeItem(TERMINAL_BRANCH_KEY)
}

export default function LoginPage() {
  const navigate = useNavigate()
  const { login, pinLogin, user } = useAuthStore()
  const [mode, setMode] = useState<'email' | 'pin'>('pin')
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [pin, setPin]           = useState('')
  const [loading, setLoading]   = useState(false)
  const [appBranchName, setAppBranchName] = useState('Main Branch')

  // Terminal branch state — persisted in localStorage
  const [terminalBranch, setTerminalBranch] = useState<{ id: string; name: string; code: string } | null>(getStoredBranch)
  const [showBranchInput, setShowBranchInput] = useState(false)
  const [branchCode, setBranchCode]           = useState('')
  const [branchSearching, setBranchSearching] = useState(false)
  const branchCodeRef = useRef<HTMLInputElement>(null)
  const emailRef = useRef<HTMLInputElement>(null)

  // Force dark mode on login page regardless of user theme setting
  useEffect(() => {
    const wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.add('dark')
    return () => { if (!wasDark) document.documentElement.classList.remove('dark') }
  }, [])

  useEffect(() => {
    window.api.settings.get().then((res: { success: boolean; data?: unknown }) => {
      if (res.success && res.data) {
        const s = res.data as Record<string, unknown>
        if (s.branch_name) setAppBranchName(s.branch_name as string)
      }
    })
  }, [])

  useEffect(() => {
    if (user) {
      navigate(redirectByRole(getPerms(user)), { replace: true })
    }
  }, [user, navigate])

  useEffect(() => {
    if (mode === 'email') emailRef.current?.focus()
  }, [mode])

  useEffect(() => {
    if (showBranchInput) setTimeout(() => branchCodeRef.current?.focus(), 50)
  }, [showBranchInput])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    try {
      const result = await login(email, password)
      if (result.success) {
        const perms = getPerms(useAuthStore.getState().user)
        navigate(redirectByRole(perms), { replace: true })
      } else {
        toast.error(result.error || 'Login failed')
      }
    } finally {
      setLoading(false)
    }
  }

  const confirmBranchCode = async () => {
    if (!branchCode.trim()) return
    setBranchSearching(true)
    try {
      const res = await window.api.admin.branches.findByCode(branchCode.trim())
      if (res.success && res.data) {
        const b = res.data as { id: string; name: string; code: string }
        const branch = { id: b.id, name: b.name, code: b.code || branchCode.toUpperCase() }
        setTerminalBranch(branch)
        setStoredBranch(branch)
        setShowBranchInput(false)
        setBranchCode('')
        toast.success(`Terminal set to ${branch.name}`)
      } else {
        toast.error('Branch code not found')
      }
    } finally {
      setBranchSearching(false)
    }
  }

  const clearBranch = () => {
    setTerminalBranch(null)
    setStoredBranch(null)
    setPin('')
    toast.success('Branch cleared — searching all branches for PIN')
  }

  const submitPin = async (p: string) => {
    if (p.length < 4 || loading) return
    setLoading(true)
    const result = await pinLogin(p, terminalBranch?.id)
    setLoading(false)
    if (result.success) {
      const perms = getPerms(useAuthStore.getState().user)
      navigate(redirectByRole(perms), { replace: true })
    } else { toast.error('Invalid PIN'); setPin('') }
  }

  const handlePinKey = (digit: string) => {
    if (loading) return
    if (digit === 'C') { setPin(''); return }
    if (pin.length >= 6) return
    setPin(p => p + digit)
  }

  // Keyboard support for PIN mode
  useEffect(() => {
    if (mode !== 'pin' || showBranchInput) return
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') { handlePinKey(e.key) }
      else if (e.key === 'Backspace') { setPin(p => p.slice(0, -1)) }
      else if (e.key === 'Enter') { setPin(p => { submitPin(p); return p }) }
      else if (e.key === 'Escape') { setPin('') }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loading, pin, showBranchInput, terminalBranch])

  return (
    <div className="min-h-screen bg-surface-900 flex">
      {/* Left panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 bg-gradient-to-br from-brand-900 via-brand-800 to-surface-900 p-12">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
            <ShoppingBag size={22} className="text-white" />
          </div>
          <span className="text-xl font-bold text-white">Enterprise POS ERP</span>
        </div>

        <div>
          <h1 className="text-4xl font-bold text-white leading-tight mb-4">
            Multi-Branch<br />Offline-First POS
          </h1>
          <p className="text-brand-200 text-lg mb-8">
            Built for large furniture & electronics enterprises. Works without internet, syncs when online.
          </p>
          <div className="grid grid-cols-2 gap-4">
            {['Offline First', 'Multi Branch', 'Real-time Sync', 'Thermal Print'].map(f => (
              <div key={f} className="flex items-center gap-2 text-brand-300">
                <div className="w-1.5 h-1.5 bg-brand-400 rounded-full" />
                <span className="text-sm">{f}</span>
              </div>
            ))}
          </div>

          {/* Login guide */}
          <div className="mt-8 bg-white/5 rounded-xl p-5 space-y-3 border border-white/10">
            <p className="text-xs font-semibold text-brand-300 uppercase tracking-wider">Branch Login Guide</p>
            <div className="space-y-2 text-sm text-brand-200">
              <p><span className="font-semibold text-white">Step 1:</span> Set terminal branch via branch code (e.g. MAIN)</p>
              <p><span className="font-semibold text-white">Step 2 — Staff:</span> Enter your 4–6 digit PIN</p>
              <p><span className="font-semibold text-white">Managers / Super Admin:</span> Use Email tab</p>
              <p><span className="font-semibold text-white">Setup:</span> Admin → Branches → Add Branch → set code</p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 text-brand-400 text-sm">
          <Cpu size={14} />
          <span>Powered by Electron + React + SQLite + Next.js</span>
        </div>
      </div>

      {/* Right panel */}
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="w-full max-w-md">
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 bg-brand-500 rounded-xl flex items-center justify-center">
              <ShoppingBag size={22} className="text-white" />
            </div>
            <span className="text-xl font-bold">Enterprise POS ERP</span>
          </div>

          {/* App branch badge */}
          <div className="flex items-center gap-2 mb-5 px-3 py-2 bg-brand-600/10 border border-brand-600/20 rounded-lg w-fit">
            <GitBranch size={13} className="text-brand-400" />
            <span className="text-xs font-medium text-brand-300">{appBranchName}</span>
          </div>

          <h2 className="text-2xl font-bold mb-1">Sign in</h2>
          <p className="text-slate-400 mb-6 text-sm">Staff: use PIN · Managers: use Email</p>

          {/* Mode toggle */}
          <div className="flex bg-surface-800 rounded-lg p-1 mb-6">
            <button onClick={() => setMode('pin')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${mode==='pin' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Hash size={14} className="inline mr-2" />Staff PIN
            </button>
            <button onClick={() => setMode('email')} className={`flex-1 py-2 rounded-md text-sm font-medium transition-all ${mode==='email' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'}`}>
              <Mail size={14} className="inline mr-2" />Admin Email
            </button>
          </div>

          {mode === 'pin' ? (
            <div>
              {/* Terminal branch selector */}
              <div className="mb-5">
                {showBranchInput ? (
                  <div className="flex gap-2">
                    <input
                      ref={branchCodeRef}
                      value={branchCode}
                      onChange={e => setBranchCode(e.target.value.toUpperCase())}
                      onKeyDown={e => { if (e.key === 'Enter') confirmBranchCode(); if (e.key === 'Escape') setShowBranchInput(false) }}
                      className="input flex-1 font-mono uppercase text-sm"
                      placeholder="Branch code (e.g. MAIN)"
                      maxLength={10}
                    />
                    <button onClick={confirmBranchCode} disabled={branchSearching || !branchCode.trim()}
                      className="btn-primary px-3 gap-1">
                      {branchSearching ? '...' : <ArrowRight size={15} />}
                    </button>
                    <button onClick={() => { setShowBranchInput(false); setBranchCode('') }} className="btn-ghost px-2">
                      <X size={15} />
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between px-3 py-2 bg-surface-800 rounded-lg border border-slate-700">
                    <div className="flex items-center gap-2">
                      <GitBranch size={13} className={terminalBranch ? 'text-brand-400' : 'text-slate-500'} />
                      {terminalBranch ? (
                        <span className="text-sm text-white">
                          <span className="font-mono text-brand-300 mr-1">[{terminalBranch.code}]</span>
                          {terminalBranch.name}
                        </span>
                      ) : (
                        <span className="text-sm text-slate-500">No branch set — all users can login</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button onClick={() => setShowBranchInput(true)}
                        className="text-xs text-brand-400 hover:text-brand-300 px-2 py-0.5">
                        {terminalBranch ? 'Change' : 'Set Branch'}
                      </button>
                      {terminalBranch && (
                        <button onClick={clearBranch} className="text-xs text-slate-500 hover:text-red-400 px-1">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* PIN display */}
              <div className="flex justify-center gap-3 mb-6">
                {Array.from({ length: 6 }).map((_, i) => (
                  <div key={i} className={`w-10 h-10 rounded-lg border-2 flex items-center justify-center text-xl font-bold transition-all ${i < pin.length ? 'border-brand-500 bg-brand-900/30 text-white' : 'border-slate-600'}`}>
                    {i < pin.length ? '●' : ''}
                  </div>
                ))}
              </div>
              {/* Numpad */}
              <div className="grid grid-cols-3 gap-3">
                {['1','2','3','4','5','6','7','8','9','C','0','⌫'].map(d => (
                  <button key={d} type="button"
                    disabled={loading}
                    onClick={() => d==='⌫' ? setPin(p=>p.slice(0,-1)) : handlePinKey(d)}
                    className={`h-14 rounded-xl text-lg font-semibold transition-all active:scale-95 ${d==='C' ? 'bg-red-900/40 text-red-400 hover:bg-red-800/40' : 'bg-surface-700 hover:bg-surface-600 text-white'} disabled:opacity-50`}>
                    {loading && d==='0' ? '...' : d}
                  </button>
                ))}
              </div>
              <button onClick={() => submitPin(pin)} disabled={loading || pin.length < 4}
                className={`btn-primary w-full mt-4 gap-2 transition-opacity ${pin.length < 4 ? 'opacity-30' : ''}`}>
                <Lock size={15} />{loading ? 'Signing in...' : 'Login'}
              </button>
              <p className="text-center text-xs text-slate-600 mt-3">
                {pin.length >= 4 ? 'Press Login or Enter to confirm' : 'Enter 4–6 digit PIN · Keyboard works too'}
              </p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Email</label>
                <input ref={emailRef} type="email" value={email} onChange={e=>setEmail(e.target.value)}
                  className="input" placeholder="admin@pos.local" required />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1.5">Password</label>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)}
                  className="input" placeholder="••••••••" required />
              </div>
              <button type="submit" disabled={loading} className="btn-primary w-full btn-lg mt-2">
                <Lock size={16} />
                {loading ? 'Signing in...' : 'Sign In'}
              </button>
              <p className="text-center text-xs text-slate-600">Default: admin@pos.local / admin123</p>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
