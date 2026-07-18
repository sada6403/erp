import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '@/store/authStore'
import { useSyncStatus } from '@/hooks/useSyncStatus'
import {
  ShoppingBag, Lock, Mail, GitBranch, ArrowRight, X, Delete,
  WifiOff, RefreshCw, Shield, CheckCircle, AlertTriangle, Search,
  Building2, Eye, EyeOff, Zap, Phone, MessageCircleMore,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { getLandingRoute } from '@/lib/sessionRouting'

// ── Helpers ───────────────────────────────────────────────────────────────────
function redirectBySession(u: unknown) {
  return getLandingRoute(u as Parameters<typeof getLandingRoute>[0])
}

const TERMINAL_BRANCH_KEY = 'pos_terminal_branch'
const RECENT_USERS_KEY    = 'pos_recent_login_users'

function getStoredBranch(): { id: string; name: string; code: string } | null {
  try { return JSON.parse(localStorage.getItem(TERMINAL_BRANCH_KEY) || 'null') } catch { return null }
}
function setStoredBranch(b: { id: string; name: string; code: string } | null) {
  if (b) localStorage.setItem(TERMINAL_BRANCH_KEY, JSON.stringify(b))
  else localStorage.removeItem(TERMINAL_BRANCH_KEY)
}

function saveRecentUser(u: { id: string; name: string; roleName: string }) {
  const list = (() => { try { return JSON.parse(localStorage.getItem(RECENT_USERS_KEY) || '[]') } catch { return [] } })()
  const filtered = list.filter((x: { id: string }) => x.id !== u.id)
  localStorage.setItem(RECENT_USERS_KEY, JSON.stringify([u, ...filtered].slice(0, 4)))
}

const PAD_KEYS = ['1','2','3','4','5','6','7','8','9','C','0','⌫']

// ── Clock ─────────────────────────────────────────────────────────────────────
function LiveClock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  const date = now.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
  const time = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })
  return (
    <span className="font-mono text-xs tabular-nums" style={{ color: '#94a3b8' }}>
      {date} &nbsp;|&nbsp; <span style={{ color: '#e2e8f0' }}>{time}</span>
    </span>
  )
}

// ── Status Bar ────────────────────────────────────────────────────────────────
function StatusBar({ online, pending, lastSync, licenseOk, version }: {
  online: boolean; pending: number; lastSync?: string; licenseOk: boolean; version: string
}) {
  const fmtSync = () => {
    if (!lastSync) return 'Never'
    const diff = Math.floor((Date.now() - new Date(lastSync).getTime()) / 1000)
    if (diff < 10) return 'Just now'
    if (diff < 60) return `${diff}s ago`
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`
    return `${Math.floor(diff / 3600)}h ago`
  }
  return (
    <div className="fixed top-0 left-0 right-0 z-50 flex items-center justify-between px-4 py-1.5"
      style={{ background: 'rgba(10,12,20,0.95)', borderBottom: '1px solid rgba(255,255,255,0.06)', backdropFilter: 'blur(12px)' }}>
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded"
        style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)' }}>
        <Zap size={9} style={{ color: '#818cf8' }} />
        <span className="text-xs font-bold" style={{ color: '#818cf8' }}>v{version}</span>
      </div>
      <div className="flex items-center gap-3">
        <LiveClock />
        <div className="w-px h-3" style={{ background: '#1e293b' }} />
        <div className="flex items-center gap-1">
          {online
            ? <><div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-xs text-emerald-400">Online</span></>
            : <><div className="w-1.5 h-1.5 rounded-full bg-red-400" /><span className="text-xs text-red-400">Offline</span></>}
        </div>
        <div className="w-px h-3" style={{ background: '#1e293b' }} />
        <div className="flex items-center gap-1">
          {pending > 0
            ? <><RefreshCw size={9} className="text-yellow-400" style={{ animation: 'spin 1.5s linear infinite' }} /><span className="text-xs text-yellow-400">{pending} pending</span></>
            : <><CheckCircle size={9} className="text-emerald-400" /><span className="text-xs" style={{ color: '#64748b' }}>Sync: {fmtSync()}</span></>}
        </div>
        <div className="w-px h-3" style={{ background: '#1e293b' }} />
        <div className="flex items-center gap-1">
          {licenseOk
            ? <><Shield size={9} className="text-emerald-400" /><span className="text-xs text-emerald-400">Active</span></>
            : <><AlertTriangle size={9} className="text-red-400" /><span className="text-xs text-red-400">Invalid</span></>}
        </div>
      </div>
    </div>
  )
}

// ── Main Login Page ───────────────────────────────────────────────────────────
export default function LoginPage() {
  const navigate = useNavigate()
  const { pinLogin, user, init } = useAuthStore()
  const { status: syncStatus } = useSyncStatus()

  const [mode, setMode]                 = useState<'email' | 'pin'>('pin')
  const [email, setEmail]               = useState('')
  const [password, setPassword]         = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [pin, setPin]                   = useState('')
  const [showPin, setShowPin]           = useState(false)
  const [loading, setLoading]           = useState(false)
  const [loginState, setLoginState]     = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  // 2FA
  const [requires2FA, setRequires2FA] = useState(false)
  const [tempToken, setTempToken]     = useState('')
  const [otpCode, setOtpCode]         = useState('')

  // Force password change
  const [requiresPwChange, setRequiresPwChange] = useState(false)
  const [newPassword,      setNewPassword]       = useState('')
  const [confirmPassword,  setConfirmPassword]   = useState('')
  const [showNewPw,        setShowNewPw]         = useState(false)

  // Forgot password
  const [forgotStep,    setForgotStep]    = useState<'off' | 'email' | 'otp' | 'done'>('off')
  const [forgotEmail,   setForgotEmail]   = useState('')
  const [forgotOtp,     setForgotOtp]     = useState('')
  const [forgotNewPw,   setForgotNewPw]   = useState('')
  const [forgotConfirm, setForgotConfirm] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotNoSmtp,  setForgotNoSmtp]  = useState(false)

  // Branding + settings
  const [branding,  setBranding]  = useState<Record<string, unknown>>({})
  const [logoFailed, setLogoFailed] = useState(false)
  const [licenseOk, setLicenseOk] = useState(true)
  const [deviceId,  setDeviceId]  = useState('POS-001')
  const [version, setVersion]      = useState('')
  const [updateInfo, setUpdateInfo] = useState<{ version: string } | null>(null)
  const [updateState, setUpdateState] = useState<'idle' | 'downloading' | 'ready'>('idle')
  const [downloadPct, setDownloadPct] = useState(0)

  // Branch — never pre-populate; always verify DB first so deleted branches can't bypass
  const [terminalBranch, setTerminalBranch]   = useState<{ id: string; name: string; code: string } | null>(null)
  const [showBranchInput, setShowBranchInput] = useState(false)
  const [branchCode, setBranchCode]           = useState('')
  const [branchSearching, setBranchSearching] = useState(false)
  const [branchList, setBranchList]           = useState<{ id: string; name: string; code: string; branch_pin: string }[]>([])
  const [branchQuery, setBranchQuery]         = useState('')
  const [showBranchList, setShowBranchList]   = useState(false)
  const [branchListLoading, setBranchListLoading] = useState(false)

  // PIN animation states
  const [pinShake, setPinShake]     = useState(false)
  const [pinSuccess, setPinSuccess] = useState(false)

  // Account locked
  const [isAccountLocked, setIsAccountLocked] = useState(false)
  const [syncUnlocking,   setSyncUnlocking]   = useState(false)

  const branchCodeRef = useRef<HTMLInputElement>(null)
  const emailRef      = useRef<HTMLInputElement>(null)

  const brandName = String(branding.company_name   || 'Enterprise POS')
  const brandLogo = String(branding.login_logo_url || branding.company_logo_url || '')
  const supportPhone = String(branding.company_phone || '')
  const supportEmail = String(branding.company_email || '')

  // ── Effects ──
  useEffect(() => {
    if (!window.api) return
    const loadBranding = async () => {
      await window.api.settings.refreshBranding?.().catch(() => undefined)
      const res = await window.api.settings.get() as { success: boolean; data?: unknown }
      if (res.success && res.data) setBranding(res.data as Record<string, unknown>)
    }
    loadBranding().catch(() => undefined)
    window.api.license?.status?.().then((r: { active?: boolean }) => {
      setLicenseOk(r?.active !== false)
    }).catch(() => {})
    window.api.app?.getDeviceInfo?.().then((r: { deviceId?: string }) => {
      if (r?.deviceId) setDeviceId(r.deviceId.slice(0, 12).toUpperCase())
    }).catch(() => {})
    window.api.app?.getVersion?.().then((v: string) => setVersion(v)).catch(() => {})
    const brandingTimer = window.setInterval(() => { loadBranding().catch(() => undefined) }, 30_000)
    const offSettingsUpdated = window.api.on?.('settings:updated', () => { loadBranding().catch(() => undefined) })
    return () => {
      window.clearInterval(brandingTimer)
      offSettingsUpdated?.()
    }
  }, [])

  useEffect(() => {
    if (!window.api?.on) return
    const off1 = window.api.on('update:available', (info: unknown) => setUpdateInfo(info as { version: string }))
    const off2 = window.api.on('update:progress', (p: unknown) => {
      setUpdateState('downloading')
      setDownloadPct(Math.round((p as { percent: number }).percent))
    })
    const off3 = window.api.on('update:downloaded', () => setUpdateState('ready'))
    const off4 = window.api.on('update:error', () => {
      setUpdateState('idle')
      setUpdateInfo(null)
    })
    window.api.updater?.check?.().catch(() => undefined)
    return () => { off1?.(); off2?.(); off3?.(); off4?.() }
  }, [])

  // Verify stored branch on startup — only restore if still exists in DB
  useEffect(() => {
    const stored = getStoredBranch()
    if (stored?.code && window.api) {
      window.api.admin.branches.findByCode(stored.code).then((res: { success: boolean; data?: unknown }) => {
        if (res.success && res.data) setTerminalBranch(stored)
        else setStoredBranch(null)
      }).catch(() => {})
    }
  }, [])

  useEffect(() => { if (user) navigate(redirectBySession(user), { replace: true }) }, [user, navigate])
  useEffect(() => { if (mode === 'email') emailRef.current?.focus() }, [mode])
  useEffect(() => { if (showBranchInput) setTimeout(() => branchCodeRef.current?.focus(), 50) }, [showBranchInput])

  useEffect(() => {
    if (!terminalBranch || !window.api?.auth?.loginOptions) return
    window.api.auth.loginOptions({ branch_id: terminalBranch.id }).then((res: {
      success: boolean
      data?: { users: number; pin_users: number; admin_email?: string }
    }) => {
      if (!res.success || !res.data?.users) return
      if (res.data.pin_users === 0) {
        if (res.data.admin_email && !email) setEmail(res.data.admin_email)
        setMode('email')
        toast('No PIN users found for this branch. Use admin email login.', { icon: 'ℹ️' })
      }
    }).catch(() => {})
  }, [terminalBranch, email])

  // ── Handlers ──
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true); setLoginState('loading')
    try {
      const result = await window.api.auth.login({ email, password }) as {
        success: boolean; data?: Record<string, unknown>
        requiresTwoFactor?: boolean; requiresPasswordChange?: boolean
        tempToken?: string; error?: string
      }
      if (result.requiresTwoFactor && result.tempToken) {
        setTempToken(result.tempToken); setRequires2FA(true); setOtpCode(''); setLoginState('idle'); return
      }
      if (result.requiresPasswordChange && result.tempToken) {
        setTempToken(result.tempToken); setRequiresPwChange(true); setLoginState('idle')
        toast('You must set a new password before continuing.', { icon: '🔐' }); return
      }
      if (result.success && result.data) {
        await init()
        setLoginState('success')
        const u = useAuthStore.getState().user as Record<string, unknown> | null
        if (u) saveRecentUser({ id: String(u.id), name: String(u.name), roleName: String((u.role as Record<string,unknown>)?.name || 'Admin') })
        setTimeout(() => navigate(redirectBySession(u), { replace: true }), 400)
      } else {
        setLoginState('error')
        const errMsg = result.error || 'Login failed'
        toast.error(errMsg)
        if (errMsg.toLowerCase().includes('locked')) setIsAccountLocked(true)
        setTimeout(() => setLoginState('idle'), 1500)
      }
    } catch (err) {
      setLoginState('error')
      toast.error((err as Error)?.message || 'Login failed')
      setTimeout(() => setLoginState('idle'), 1500)
    } finally { setLoading(false) }
  }

  const handleSyncUnlock = async () => {
    setSyncUnlocking(true)
    try {
      await (window as unknown as { api: { sync: { trigger: () => Promise<void> } } }).api.sync.trigger()
      setIsAccountLocked(false); setLoginState('idle')
      toast.success('Sync complete — try logging in now.')
    } catch { toast.error('Sync failed. Check your connection.') }
    finally { setSyncUnlocking(false) }
  }

  const handleForcePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (newPassword !== confirmPassword) { toast.error('Passwords do not match'); return }
    setLoading(true); setLoginState('loading')
    try {
      const result = await window.api.auth.completeForcePasswordChange({ tempToken, newPassword }) as {
        success: boolean; data?: Record<string, unknown>; error?: string
      }
      if (result.success && result.data) {
        setLoginState('success'); await init()
        const u = useAuthStore.getState().user as Record<string, unknown> | null
        toast.success('Password changed!'); setTimeout(() => navigate(redirectBySession(u), { replace: true }), 400)
      } else {
        setLoginState('error'); toast.error(result.error || 'Failed to change password')
        setTimeout(() => setLoginState('idle'), 1500)
      }
    } catch (err) {
      setLoginState('error')
      toast.error((err as Error)?.message || 'Failed to change password')
      setTimeout(() => setLoginState('idle'), 1500)
    } finally { setLoading(false) }
  }

  const handleOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (otpCode.length !== 6) { toast.error('Enter 6-digit code'); return }
    setLoading(true); setLoginState('loading')
    try {
      const result = await window.api.auth.twoFa.verifyLogin({ tempToken, otp: otpCode }) as {
        success: boolean; data?: Record<string, unknown>; error?: string
      }
      if (result.success && result.data) {
        setLoginState('success'); await init()
        navigate(redirectBySession(result.data.user), { replace: true })
      } else {
        setLoginState('error'); toast.error(result.error || 'Invalid code')
        setOtpCode(''); setTimeout(() => setLoginState('idle'), 1500)
      }
    } catch (err) {
      setLoginState('error')
      toast.error((err as Error)?.message || 'Invalid code')
      setOtpCode(''); setTimeout(() => setLoginState('idle'), 1500)
    } finally { setLoading(false) }
  }

  const confirmBranchCode = async () => {
    if (!branchCode.trim()) return
    setBranchSearching(true)
    try {
      if (!window.api) { toast.error('Not running in Electron'); return }
      const res = await window.api.admin.branches.findByCode(branchCode.trim())
      if (res.success && res.data) {
        const b = res.data as { id: string; name: string; code: string }
        const branch = { id: b.id, name: b.name, code: b.code || branchCode.toUpperCase() }
        setTerminalBranch(branch); setStoredBranch(branch)
        setShowBranchInput(false); setBranchCode('')
        toast.success(`Branch → ${branch.name}`)
      } else { toast.error('Branch not found. Check the code or PIN.') }
    } catch (err) {
      toast.error((err as Error)?.message || 'Branch lookup failed')
    } finally { setBranchSearching(false) }
  }

  const clearBranch = () => {
    setTerminalBranch(null); setStoredBranch(null); setPin('')
    toast.success('Branch cleared')
  }

  const loadBranchList = async () => {
    if (!window.api) return
    setBranchListLoading(true)
    setBranchQuery('')
    try {
      const res = await window.api.admin.branches.list()
      if (res.success && res.data) {
        const all = (res.data as { id: string; name: string; code?: string; branch_pin?: string; is_active?: number | boolean }[])
        const active = all.filter(b => b.is_active === undefined || Boolean(b.is_active))
        const mapped = (active.length > 0 ? active : all).map(b => ({
          id: String(b.id),
          name: String(b.name || 'Branch'),
          code: String(b.code || ''),
          branch_pin: String(b.branch_pin || ''),
        }))
        setBranchList(mapped)
        setShowBranchList(true)
        if (all.length === 0) toast.error('No branches found. Create a branch first.')
        return
      }
      toast.error(res.error || 'Could not load branches')
    } catch (err) {
      toast.error((err as Error)?.message || 'Could not load branches')
    } finally {
      setBranchListLoading(false)
    }
  }

  const pickBranchFromList = (b: { id: string; name: string; code: string; branch_pin: string }) => {
    const branch = { id: b.id, name: b.name, code: b.code || b.name.toUpperCase().replace(/\s+/g, '') }
    setTerminalBranch(branch); setStoredBranch(branch)
    setShowBranchList(false); setShowBranchInput(false); setBranchCode('')
    toast.success(`Branch → ${branch.name}`)
  }

  const visibleBranchList = branchList.filter(b => {
    const q = branchQuery.trim().toLowerCase()
    if (!q) return true
    return (
      b.name.toLowerCase().includes(q) ||
      b.code.toLowerCase().includes(q) ||
      b.id.toLowerCase().includes(q)
    )
  })

  const handleForgotRequest = async (e: React.FormEvent) => {
    e.preventDefault(); setForgotLoading(true)
    try {
      const res = await (window as unknown as { api: { auth: { forgotPassword: (e: string) => Promise<{ success: boolean; sent?: boolean; noSmtp?: boolean }> } } }).api.auth.forgotPassword(forgotEmail)
      if (res.success) { setForgotNoSmtp(Boolean(res.noSmtp) || !res.sent); setForgotStep('otp') }
      else toast.error('Something went wrong. Try again.')
    } catch { toast.error('Request failed') }
    finally { setForgotLoading(false) }
  }

  const handleForgotReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (forgotNewPw.length < 8) { toast.error('Password must be at least 8 characters'); return }
    if (forgotNewPw !== forgotConfirm) { toast.error('Passwords do not match'); return }
    setForgotLoading(true)
    try {
      const res = await (window as unknown as { api: { auth: { resetWithOtp: (e: string, o: string, p: string) => Promise<{ success: boolean; error?: string }> } } }).api.auth.resetWithOtp(forgotEmail, forgotOtp, forgotNewPw)
      if (res.success) setForgotStep('done')
      else toast.error(res.error || 'Reset failed')
    } catch { toast.error('Reset failed') }
    finally { setForgotLoading(false) }
  }

  const resetForgot = () => {
    setForgotStep('off'); setForgotEmail(''); setForgotOtp('')
    setForgotNewPw(''); setForgotConfirm(''); setForgotNoSmtp(false)
  }

  const submitPin = async (p: string) => {
    if (p.length < 1 || loading || !terminalBranch) return
    setLoading(true); setLoginState('loading')
    const result = await pinLogin(p, terminalBranch.id)
    setLoading(false)
    if (result.success) {
      setLoginState('success'); setPinSuccess(true)
      const u = useAuthStore.getState().user as Record<string, unknown> | null
      if (u) saveRecentUser({ id: String(u.id), name: String(u.name), roleName: String((u.role as Record<string,unknown>)?.name || 'Staff') })
      setTimeout(() => navigate(redirectBySession(useAuthStore.getState().user), { replace: true }), 600)
    } else {
      setLoginState('error'); setPinShake(true)
      setTimeout(() => { setPinShake(false); setLoginState('idle') }, 600)
      toast.error('Invalid PIN'); setPin('')
    }
  }

  const handlePinKey = (digit: string) => {
    if (loading || loginState === 'success' || !terminalBranch) return
    if (digit === 'C') { setPin(''); return }
    if (pin.length >= 6) return
    setPin(prev => prev + digit)
  }

  useEffect(() => {
    if (mode !== 'pin' || showBranchInput || !terminalBranch) return
    const handler = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') handlePinKey(e.key)
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1))
      else if (e.key === 'Enter') submitPin(pin)
      else if (e.key === 'Escape') setPin('')
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, loading, pin, showBranchInput, terminalBranch, loginState])

  // ── Styles ──
  const pinDotStyle = (i: number) => {
    if (pinSuccess && i < pin.length) return { background: '#10b981', border: '2px solid #10b981' }
    if (loginState === 'error' && i < pin.length) return { background: '#ef4444', border: '2px solid #ef4444' }
    if (i < pin.length) return { background: '#4f46e5', border: '2px solid #6366f1', boxShadow: '0 0 0 3px rgba(99,102,241,0.25)' }
    return { background: '#0f1623', border: '2px solid #1e2d45' }
  }

  const padStyle = (d: string): React.CSSProperties => {
    if (d === 'C')  return { background: 'rgba(239,68,68,0.1)',  color: '#f87171', border: '1px solid rgba(239,68,68,0.2)' }
    if (d === '⌫') return { background: 'rgba(99,102,241,0.1)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.2)' }
    return { background: '#111827', color: '#f1f5f9', border: '1px solid #1e293b' }
  }

  const loginBtnStyle = (): React.CSSProperties => {
    if (loginState === 'success') return { background: '#059669' }
    if (loginState === 'error')   return { background: '#dc2626' }
    if (pin.length < 1 && mode === 'pin') return { background: '#0d1117', color: '#334155', border: '1px solid #1e293b', cursor: 'not-allowed' }
    return { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }
  }
  const loginBtnLabel = () => {
    if (loginState === 'loading') return <><RefreshCw size={13} className="inline mr-1.5 animate-spin" />Signing in…</>
    if (loginState === 'success') return <><CheckCircle size={13} className="inline mr-1.5" />Access Granted</>
    if (loginState === 'error')   return <><AlertTriangle size={13} className="inline mr-1.5" />Invalid Credentials</>
    return <><Lock size={13} className="inline mr-1.5" />Login</>
  }

  // ── Render ──
  return (
    <div className="h-screen flex flex-col overflow-hidden" style={{ background: '#080c14' }}>

      <StatusBar
        online={syncStatus.online} pending={syncStatus.pending}
        lastSync={syncStatus.last_sync} licenseOk={licenseOk} version={version || '...'}
      />
      {updateInfo && (
        <div className="fixed top-10 left-1/2 -translate-x-1/2 z-[60] flex items-center gap-3 rounded-xl border px-4 py-2 shadow-xl"
          style={{ background: '#111827', borderColor: '#3730a3', color: '#e0e7ff' }}>
          <span className="text-sm font-semibold">
            {updateState === 'ready'
              ? `Update v${updateInfo.version} ready`
              : updateState === 'downloading'
              ? `Downloading update v${updateInfo.version} ${downloadPct}%`
              : `Update v${updateInfo.version} available`}
          </span>
          {updateState === 'idle' && (
            <button
              onClick={() => { setUpdateState('downloading'); window.api.updater?.download?.()?.catch(() => { setUpdateState('idle'); toast.error('Failed to start update download') }) }}
              className="rounded-lg bg-indigo-600 px-3 py-1 text-xs font-bold text-white hover:bg-indigo-500"
            >
              Download
            </button>
          )}
          {updateState === 'ready' && (
            <button
              onClick={() => window.api.updater?.install?.()?.catch(() => toast.error('Failed to install update'))}
              className="rounded-lg bg-emerald-600 px-3 py-1 text-xs font-bold text-white hover:bg-emerald-500"
            >
              Install
            </button>
          )}
        </div>
      )}

      <div className="flex-1 flex items-center justify-center" style={{ paddingTop: '32px' }}>
        <div className="w-full max-w-[330px] px-4 space-y-3">

          {/* ── Company header ── */}
          <div className="flex items-center gap-3 pb-3" style={{ borderBottom: '1px solid #0f1623' }}>
            <div className="w-9 h-9 rounded-xl flex items-center justify-center overflow-hidden flex-shrink-0"
              style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
              {brandLogo && !logoFailed
                ? <img src={brandLogo} alt="" className="w-full h-full object-cover" onError={() => setLogoFailed(true)} />
                : <ShoppingBag size={17} className="text-white" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-bold text-white text-sm truncate">{brandName}</div>
              <div className="flex items-center gap-1 mt-0.5">
                <Building2 size={9} style={{ color: '#475569' }} />
                <span className="text-xs truncate" style={{ color: '#475569' }}>
                  {terminalBranch ? terminalBranch.name : 'No branch selected'}
                </span>
              </div>
            </div>
            {licenseOk
              ? <div className="flex items-center gap-1 text-xs text-emerald-400 flex-shrink-0">
                  <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" /> Active
                </div>
              : <span className="text-xs text-red-400 flex-shrink-0">Inactive</span>
            }
          </div>

          {/* ═══════════ PIN MODE ═══════════ */}
          {mode === 'pin' && !requires2FA && !requiresPwChange && (
            <div className="space-y-3">

              {/* Branch selector */}
              {showBranchInput ? (
                <div className="flex gap-2">
                  <input
                    ref={branchCodeRef}
                    value={branchCode}
                    onChange={e => setBranchCode(e.target.value.toUpperCase())}
                    onKeyDown={e => {
                      if (e.key === 'Enter') confirmBranchCode()
                      if (e.key === 'Escape') { setShowBranchInput(false); setBranchCode('') }
                    }}
                    className="flex-1 px-3 py-2.5 rounded-xl text-sm font-mono text-white outline-none"
                    style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                    placeholder="Branch code or PIN (e.g. MAIN, 1001)"
                    maxLength={10}
                  />
                  <button onClick={confirmBranchCode} disabled={branchSearching || !branchCode.trim()}
                    className="px-3.5 py-2.5 rounded-xl text-white font-bold disabled:opacity-40 flex-shrink-0"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #6d28d9)' }}>
                    {branchSearching ? <RefreshCw size={14} className="animate-spin" /> : <ArrowRight size={14} />}
                  </button>
                  <button onClick={loadBranchList}
                    disabled={branchListLoading}
                    className="px-3.5 py-2.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 flex-shrink-0"
                    style={{ background: '#0d1117', color: '#c7d2fe', border: '1px solid #1e293b', opacity: branchListLoading ? 0.7 : 1 }}>
                    <GitBranch size={13} />
                    {branchListLoading ? 'Loading…' : 'Browse'}
                  </button>
                  <button onClick={() => { setShowBranchInput(false); setBranchCode('') }}
                    className="px-3 py-2.5 rounded-xl flex-shrink-0"
                    style={{ background: '#0d1117', color: '#475569', border: '1px solid #1e293b' }}>
                    <X size={13} />
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between px-3 py-2 rounded-xl"
                  style={{ background: '#0d1117', border: `1px solid ${terminalBranch ? 'rgba(99,102,241,0.3)' : 'rgba(239,68,68,0.25)'}` }}>
                  <div className="flex items-center gap-2 min-w-0">
                    <GitBranch size={12} style={{ color: terminalBranch ? '#818cf8' : '#ef4444', flexShrink: 0 }} />
                    {terminalBranch ? (
                      <span className="text-sm text-white truncate">
                        <span className="font-mono text-xs font-bold mr-1.5 px-1.5 py-0.5 rounded"
                          style={{ background: 'rgba(99,102,241,0.2)', color: '#818cf8' }}>{terminalBranch.code}</span>
                        {terminalBranch.name}
                      </span>
                    ) : (
                      <span className="text-sm font-medium" style={{ color: '#ef4444' }}>No branch — set before login</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 ml-2 flex-shrink-0">
                    <button onClick={() => setShowBranchInput(true)}
                      className="text-xs font-semibold px-2 py-1 rounded-lg"
                      style={{
                        background: terminalBranch ? 'rgba(99,102,241,0.12)' : 'rgba(239,68,68,0.12)',
                        color:      terminalBranch ? '#818cf8' : '#f87171',
                        border:     `1px solid ${terminalBranch ? 'rgba(99,102,241,0.2)' : 'rgba(239,68,68,0.25)'}`,
                      }}>
                      {terminalBranch ? 'Change' : 'Set Branch'}
                    </button>
                    {terminalBranch && (
                      <button onClick={clearBranch} className="p-1 rounded" style={{ color: '#334155' }}>
                        <X size={11} />
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Branch list dropdown */}
              {showBranchList && (
                <div className="fixed inset-0 z-[70] flex items-center justify-center px-4" style={{ background: 'rgba(2,6,23,0.72)' }}>
                  <div className="w-full max-w-md rounded-2xl overflow-hidden shadow-2xl"
                    style={{ border: '1px solid rgba(99,102,241,0.3)', background: '#0a0e18' }}>
                    <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: '1px solid #0f1623' }}>
                      <div>
                        <p className="text-sm font-semibold" style={{ color: '#e0e7ff' }}>Select Branch</p>
                        <p className="text-xs" style={{ color: '#64748b' }}>Choose a branch to continue login</p>
                      </div>
                      <button onClick={() => setShowBranchList(false)} style={{ color: '#334155' }}>
                        <X size={14} />
                      </button>
                    </div>
                    <div className="px-4 pt-3">
                      <div className="relative">
                        <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: '#475569' }} />
                        <input
                          value={branchQuery}
                          onChange={e => setBranchQuery(e.target.value)}
                          className="w-full rounded-xl text-sm text-white outline-none pl-9 pr-3 py-2.5"
                          style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                          placeholder="Search branch name or code"
                        />
                      </div>
                    </div>
                    <div className="max-h-[60vh] overflow-y-auto">
                      {branchListLoading ? (
                        <p className="text-sm text-center py-6" style={{ color: '#64748b' }}>Loading branches…</p>
                      ) : visibleBranchList.length === 0 ? (
                        <p className="text-sm text-center py-6" style={{ color: '#64748b' }}>No branches found</p>
                      ) : visibleBranchList.map(b => (
                        <button key={b.id} onClick={() => pickBranchFromList(b)}
                          className="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-indigo-600/10"
                          style={{ borderBottom: '1px solid #0f1623' }}>
                          <GitBranch size={12} style={{ color: '#4f46e5', flexShrink: 0 }} />
                          <div className="min-w-0 flex-1">
                            <span className="block text-sm text-white truncate">{b.name}</span>
                            <span className="block text-[11px] text-slate-500 font-mono truncate">{b.id}</span>
                          </div>
                          {b.code && (
                            <span className="text-xs font-mono px-1.5 py-0.5 rounded flex-shrink-0"
                              style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8' }}>{b.code}</span>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* PIN section — only when branch is selected */}
              {terminalBranch ? (
                <div className="space-y-2.5">
                  {/* PIN dots */}
                  <div className={`flex justify-center gap-2 ${pinShake ? 'lp-shake' : ''}`}>
                    {Array.from({ length: 6 }).map((_, i) => (
                      <div key={i}
                        className="w-10 h-10 rounded-xl flex items-center justify-center transition-all duration-200"
                        style={pinDotStyle(i)}>
                        {i < pin.length && (
                          showPin
                            ? <span className="text-white font-bold text-sm">{pin[i]}</span>
                            : <div className="w-2.5 h-2.5 rounded-full bg-white" />
                        )}
                      </div>
                    ))}
                  </div>

                  {/* Numpad */}
                  <div className="grid grid-cols-3 gap-1.5">
                    {PAD_KEYS.map(d => (
                      <button key={d} type="button"
                        disabled={loading || loginState === 'success'}
                        onClick={() => d === '⌫' ? setPin(p => p.slice(0, -1)) : handlePinKey(d)}
                        className="h-12 rounded-xl text-lg font-bold transition-all active:scale-95 disabled:opacity-40 flex items-center justify-center select-none"
                        style={padStyle(d)}>
                        {d === '⌫' ? <Delete size={17} /> : d}
                      </button>
                    ))}
                  </div>

                  {/* Login button + show PIN toggle */}
                  <div className="flex gap-2">
                    <button onClick={() => submitPin(pin)}
                      disabled={loading || pin.length < 1 || loginState === 'success'}
                      className="flex-1 py-2.5 rounded-xl text-white font-bold text-sm transition-all flex items-center justify-center"
                      style={loginBtnStyle()}>
                      {loginBtnLabel()}
                    </button>
                    <button onClick={() => setShowPin(p => !p)}
                      className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 self-center"
                      style={{ background: '#0d1117', border: '1px solid #1e293b', color: '#475569' }}>
                      {showPin ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="relative text-center py-4 rounded-xl"
                  style={{ background: 'rgba(99,102,241,0.05)', border: '1px dashed rgba(99,102,241,0.2)' }}>
                  <GitBranch size={18} className="mx-auto mb-1.5" style={{ color: '#4f46e5' }} />
                  <p className="text-xs font-semibold" style={{ color: '#818cf8' }}>Select your branch first</p>
                  <p className="text-xs mt-0.5 mb-2.5" style={{ color: '#475569' }}>
                    Enter your branch code or PIN above
                  </p>
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={loadBranchList}
                      disabled={branchListLoading}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors inline-flex items-center gap-1.5"
                      style={{ background: 'rgba(99,102,241,0.15)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', opacity: branchListLoading ? 0.7 : 1 }}>
                      <GitBranch size={12} />
                      {branchListLoading ? 'Loading…' : 'Browse all branches'}
                    </button>
                    <span className="text-[11px] px-2 py-1 rounded-lg" style={{ background: '#0d1117', color: '#64748b', border: '1px solid #1e293b' }}>
                      {branchList.length} branches
                    </span>
                  </div>
                </div>
              )}

              {/* Offline notice */}
              {!syncStatus.online && (
                <div className="rounded-lg px-3 py-2 flex items-center gap-2"
                  style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)' }}>
                  <WifiOff size={11} className="text-yellow-400 flex-shrink-0" />
                  <p className="text-xs text-yellow-400">Offline — transactions save locally</p>
                </div>
              )}

              {/* Admin link */}
              <div className="flex items-center justify-between pt-0.5">
                <span className="text-xs font-mono" style={{ color: '#0f172a' }}>v{version} · {deviceId}</span>
                <button onClick={() => { setMode('email'); setLoginState('idle') }}
                  className="flex items-center gap-1 text-xs font-semibold" style={{ color: '#818cf8' }}>
                  <Mail size={10} /> Admin
                </button>
              </div>

              {(supportPhone || supportEmail) && (
                <div className="mt-2 rounded-xl px-3 py-2" style={{ background: '#0d1117', border: '1px solid #1e293b' }}>
                  <p className="text-[11px] font-semibold mb-1.5" style={{ color: '#94a3b8' }}>Need help or password reset?</p>
                  <div className="flex flex-wrap gap-2 text-xs">
                    {supportPhone && (
                      <a href={`tel:${supportPhone.replace(/\s+/g, '')}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(99,102,241,0.12)', color: '#c7d2fe' }}>
                        <Phone size={11} /> {supportPhone}
                      </a>
                    )}
                    {supportEmail && (
                      <a href={`mailto:${supportEmail}`} className="inline-flex items-center gap-1.5 px-2 py-1 rounded-lg" style={{ background: 'rgba(16,185,129,0.10)', color: '#a7f3d0' }}>
                        <MessageCircleMore size={11} /> {supportEmail}
                      </a>
                    )}
                  </div>
                  <p className="text-[11px] mt-1.5" style={{ color: '#64748b' }}>
                    If you forgot your password, use Admin Login → Forgot Password or contact your administrator.
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ═══════════ EMAIL MODE ═══════════ */}
          {mode === 'email' && forgotStep === 'off' && !requires2FA && !requiresPwChange && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#818cf8' }}>
                  <Mail size={13} /> Admin Login
                </div>
                <button onClick={() => { setMode('pin'); setPin(''); setLoginState('idle'); resetForgot() }}
                  className="text-xs" style={{ color: '#475569' }}>
                  ← Staff PIN
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-2.5">
                <div className="relative">
                  <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                  <input ref={emailRef} type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white outline-none"
                    style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                    placeholder="Email address" required />
                </div>
                <div className="relative">
                  <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                  <input type={showPassword ? 'text' : 'password'} value={password}
                    onChange={e => { setPassword(e.target.value); setIsAccountLocked(false) }}
                    className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white outline-none"
                    style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                    placeholder="Password" required />
                  <button type="button" onClick={() => setShowPassword(p => !p)}
                    className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }}>
                    {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>

                <button type="submit" disabled={loading || loginState === 'success'}
                  className="w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center"
                  style={loginState === 'success' ? { background: '#059669' } : loginState === 'error' ? { background: '#dc2626' } : { background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
                  {loginBtnLabel()}
                </button>

                {isAccountLocked && (
                  <button type="button" onClick={handleSyncUnlock} disabled={syncUnlocking}
                    className="w-full py-2 rounded-xl text-sm font-semibold flex items-center justify-center gap-2"
                    style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)', color: '#fbbf24' }}>
                    <RefreshCw size={13} className={syncUnlocking ? 'animate-spin' : ''} />
                    {syncUnlocking ? 'Syncing…' : 'Sync from Cloud to Unlock'}
                  </button>
                )}

                <div className="flex justify-end">
                  <button type="button" onClick={() => { setForgotEmail(email); setForgotStep('email') }}
                    className="text-xs font-medium" style={{ color: '#6366f1' }}>
                    Forgot Password?
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* ═══════════ FORGOT PASSWORD ═══════════ */}
          {mode === 'email' && forgotStep !== 'off' && !requires2FA && !requiresPwChange && (
            <div className="space-y-3">
              {forgotStep === 'done' && (
                <div className="text-center space-y-3 py-4">
                  <CheckCircle size={32} className="mx-auto text-emerald-400" />
                  <p className="font-bold text-white">Password Reset!</p>
                  <button onClick={resetForgot} className="w-full py-2.5 rounded-xl text-white font-bold text-sm"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)' }}>
                    Back to Login
                  </button>
                </div>
              )}

              {forgotStep === 'email' && (
                <form onSubmit={handleForgotRequest} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={resetForgot} className="text-xs" style={{ color: '#475569' }}>←</button>
                    <p className="text-sm font-bold text-white">Reset Password</p>
                  </div>
                  {forgotNoSmtp && (
                    <div className="rounded-lg p-2.5 text-xs"
                      style={{ background: 'rgba(234,179,8,0.08)', border: '1px solid rgba(234,179,8,0.2)', color: '#d97706' }}>
                      <strong>Email not configured.</strong> Ask your administrator for the reset code.
                    </div>
                  )}
                  <div className="relative">
                    <Mail size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                    <input type="email" value={forgotEmail} required autoFocus onChange={e => setForgotEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                      placeholder="Your email address" />
                  </div>
                  <button type="submit" disabled={forgotLoading || !forgotEmail.trim()}
                    className="w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', opacity: !forgotEmail.trim() ? 0.5 : 1 }}>
                    {forgotLoading ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Sending…</> : 'Send Reset Code'}
                  </button>
                </form>
              )}

              {forgotStep === 'otp' && (
                <form onSubmit={handleForgotReset} className="space-y-3">
                  <div className="flex items-center gap-2">
                    <button type="button" onClick={() => setForgotStep('email')} className="text-xs" style={{ color: '#475569' }}>←</button>
                    <p className="text-sm font-bold text-white">{forgotNoSmtp ? 'Enter Reset Code' : 'Check Your Email'}</p>
                  </div>
                  <input type="text" inputMode="numeric" maxLength={6} value={forgotOtp} required autoFocus
                    onChange={e => setForgotOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    className="w-full px-4 py-2.5 rounded-xl text-center text-xl font-mono tracking-[0.4em] text-white outline-none border"
                    style={{ background: '#0d1117', borderColor: '#1e293b' }}
                    onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                    onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                    placeholder="000000" />
                  <div className="relative">
                    <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                    <input type={showNewPw ? 'text' : 'password'} value={forgotNewPw} required
                      onChange={e => setForgotNewPw(e.target.value)}
                      className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                      onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                      onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                      placeholder="New password (min 8 chars)" />
                    <button type="button" onClick={() => setShowNewPw(p => !p)}
                      className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }}>
                      {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                  <div className="relative">
                    <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                    <input type={showNewPw ? 'text' : 'password'} value={forgotConfirm} required
                      onChange={e => setForgotConfirm(e.target.value)}
                      className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white outline-none"
                      style={{ background: '#0d1117', border: `1px solid ${forgotConfirm && forgotNewPw !== forgotConfirm ? '#ef4444' : '#1e293b'}` }}
                      placeholder="Confirm password" />
                  </div>
                  <button type="submit"
                    disabled={forgotLoading || forgotOtp.length < 4 || forgotNewPw.length < 8 || forgotNewPw !== forgotConfirm}
                    className="w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', opacity: (forgotOtp.length < 4 || forgotNewPw.length < 8 || forgotNewPw !== forgotConfirm) ? 0.5 : 1 }}>
                    {forgotLoading
                      ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Resetting…</>
                      : <><CheckCircle size={13} className="mr-1.5" />Reset Password</>}
                  </button>
                </form>
              )}
            </div>
          )}

          {/* ═══════════ 2FA ═══════════ */}
          {requires2FA && (
            <form onSubmit={handleOtpSubmit} className="space-y-3">
              <div className="text-center py-2">
                <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-2"
                  style={{ background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)' }}>
                  <Lock size={22} style={{ color: '#818cf8' }} />
                </div>
                <p className="font-bold text-white text-sm">Two-Factor Auth</p>
                <p className="text-xs mt-0.5" style={{ color: '#475569' }}>Enter the 6-digit code from your authenticator app</p>
              </div>
              <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={6}
                value={otpCode} onChange={e => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                className="w-full px-4 py-3 rounded-xl text-center text-2xl font-mono tracking-[0.5em] text-white outline-none border"
                style={{ background: '#0d1117', borderColor: '#1e293b' }}
                onFocus={e => { e.currentTarget.style.borderColor = '#4f46e5' }}
                onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                placeholder="000000" autoFocus />
              <button type="submit" disabled={loading || otpCode.length !== 6}
                className="w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center"
                style={{ background: 'linear-gradient(135deg, #4f46e5, #7c3aed)', opacity: otpCode.length !== 6 ? 0.45 : 1 }}>
                {loading ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Verifying…</> : <><CheckCircle size={13} className="mr-1.5" />Verify Code</>}
              </button>
              <button type="button" onClick={() => { setRequires2FA(false); setOtpCode('') }}
                className="w-full text-center text-xs py-1" style={{ color: '#334155' }}>
                ← Back to login
              </button>
            </form>
          )}

          {/* ═══════════ FORCE PASSWORD CHANGE ═══════════ */}
          {requiresPwChange && (
            <form onSubmit={handleForcePasswordChange} className="space-y-3">
              <div className="text-center py-2">
                <div className="w-12 h-12 mx-auto rounded-2xl flex items-center justify-center mb-2"
                  style={{ background: 'rgba(234,179,8,0.12)', border: '1px solid rgba(234,179,8,0.3)' }}>
                  <Lock size={22} style={{ color: '#fbbf24' }} />
                </div>
                <p className="font-bold text-white text-sm">Set New Password</p>
                <p className="text-xs mt-0.5" style={{ color: '#94a3b8' }}>Required before you can continue</p>
              </div>
              <div className="relative">
                <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                <input type={showNewPw ? 'text' : 'password'} value={newPassword}
                  onChange={e => setNewPassword(e.target.value)}
                  className="w-full pl-10 pr-10 py-2.5 rounded-xl text-sm text-white outline-none"
                  style={{ background: '#0d1117', border: '1px solid #1e293b' }}
                  onFocus={e => { e.currentTarget.style.borderColor = '#fbbf24' }}
                  onBlur={e => { e.currentTarget.style.borderColor = '#1e293b' }}
                  placeholder="New password (min 8 chars)" autoFocus required />
                <button type="button" onClick={() => setShowNewPw(p => !p)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }}>
                  {showNewPw ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
              <div className="relative">
                <Lock size={13} className="absolute left-3.5 top-1/2 -translate-y-1/2" style={{ color: '#334155' }} />
                <input type={showNewPw ? 'text' : 'password'} value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)}
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl text-sm text-white outline-none"
                  style={{ background: '#0d1117', border: `1px solid ${confirmPassword && newPassword !== confirmPassword ? '#ef4444' : '#1e293b'}` }}
                  placeholder="Confirm new password" required />
              </div>
              <button type="submit" disabled={loading || newPassword.length < 8 || newPassword !== confirmPassword}
                className="w-full py-2.5 rounded-xl text-white font-bold text-sm flex items-center justify-center"
                style={{ background: newPassword.length >= 8 && newPassword === confirmPassword ? 'linear-gradient(135deg, #d97706, #b45309)' : '#0d1117', opacity: newPassword.length < 8 || newPassword !== confirmPassword ? 0.5 : 1 }}>
                {loading
                  ? <><RefreshCw size={13} className="mr-1.5 animate-spin" />Saving…</>
                  : <><CheckCircle size={13} className="mr-1.5" />Set Password &amp; Login</>}
              </button>
            </form>
          )}

        </div>
      </div>
    </div>
  )
}
