import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { Shield, ShieldCheck, ShieldOff, QrCode, Key, CheckCircle, AlertTriangle, Loader2, Copy } from 'lucide-react'
import { useAuthStore } from '@/store/authStore'
import toast from 'react-hot-toast'

type Step = 'status' | 'setup' | 'confirm' | 'disable'

export default function SecurityPage() {
  const { user } = useAuthStore()
  const userId = (user as unknown as Record<string, unknown>)?.id as string | undefined

  const [twoFaEnabled, setTwoFaEnabled] = useState(false)
  const [step, setStep]                 = useState<Step>('status')
  const [qrDataUrl, setQrDataUrl]       = useState('')
  const [secret, setSecret]             = useState('')
  const [otp, setOtp]                   = useState('')
  const [loading, setLoading]           = useState(false)
  const [checking, setChecking]         = useState(true)

  const checkStatus = async () => {
    if (!userId) return
    setChecking(true)
    const res = await window.api.auth.twoFa.status(userId) as { success: boolean; data?: { enabled: boolean } }
    if (res.success) setTwoFaEnabled(res.data?.enabled ?? false)
    setChecking(false)
  }

  useEffect(() => { checkStatus() }, [userId])

  const startSetup = async () => {
    if (!userId) return
    setLoading(true)
    const res = await window.api.auth.twoFa.setup(userId) as {
      success: boolean
      data?: { secret: string; qrDataUrl: string }
      error?: string
    }
    setLoading(false)
    if (res.success && res.data) {
      setSecret(res.data.secret)
      setQrDataUrl(res.data.qrDataUrl)
      setStep('setup')
    } else {
      toast.error(res.error || 'Setup failed')
    }
  }

  const confirmSetup = async () => {
    if (!userId || otp.length !== 6) { toast.error('Enter 6-digit code'); return }
    setLoading(true)
    const res = await window.api.auth.twoFa.confirm(userId, otp) as { success: boolean; error?: string }
    setLoading(false)
    if (res.success) {
      toast.success('2FA enabled successfully!')
      setTwoFaEnabled(true)
      setStep('status')
      setOtp('')
      setSecret('')
      setQrDataUrl('')
    } else {
      toast.error(res.error || 'Invalid code')
      setOtp('')
    }
  }

  const disable2FA = async () => {
    if (!userId || otp.length !== 6) { toast.error('Enter 6-digit code'); return }
    setLoading(true)
    const res = await window.api.auth.twoFa.disable(userId, otp) as { success: boolean; error?: string }
    setLoading(false)
    if (res.success) {
      toast.success('2FA disabled')
      setTwoFaEnabled(false)
      setStep('status')
      setOtp('')
    } else {
      toast.error(res.error || 'Invalid code')
      setOtp('')
    }
  }

  const copySecret = () => {
    navigator.clipboard.writeText(secret).then(() => toast.success('Secret copied'))
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Security" subtitle="Two-Factor Authentication and account security" />

      <div className="flex-1 overflow-auto p-6">
        <div className="max-w-lg space-y-6">

          {/* 2FA Status Card */}
          <div className="rounded-xl border p-6" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
            <div className="flex items-center gap-3 mb-4">
              {twoFaEnabled
                ? <ShieldCheck size={24} className="text-green-400" />
                : <Shield size={24} className="text-yellow-400" />}
              <div>
                <h3 className="font-semibold" style={{ color: 'var(--text-1)' }}>Two-Factor Authentication (2FA)</h3>
                <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                  Adds an extra layer of security to your account login
                </p>
              </div>
              <div className="ml-auto">
                {checking ? (
                  <Loader2 size={16} className="animate-spin" style={{ color: 'var(--text-3)' }} />
                ) : (
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${twoFaEnabled ? 'bg-green-500/20 text-green-400' : 'bg-yellow-500/20 text-yellow-400'}`}>
                    {twoFaEnabled ? 'ENABLED' : 'DISABLED'}
                  </span>
                )}
              </div>
            </div>

            {step === 'status' && !checking && (
              <>
                {twoFaEnabled ? (
                  <div className="space-y-3">
                    <div className="flex items-center gap-2 text-sm text-green-400">
                      <CheckCircle size={14} />
                      <span>Your account is protected with 2FA</span>
                    </div>
                    <p className="text-xs" style={{ color: 'var(--text-3)' }}>
                      Each login requires your password + a 6-digit code from your authenticator app (Google Authenticator, Authy, etc.)
                    </p>
                    <button
                      onClick={() => { setStep('disable'); setOtp('') }}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-colors mt-2">
                      <ShieldOff size={14} /> Disable 2FA
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-start gap-2 text-xs" style={{ color: 'var(--text-3)' }}>
                      <AlertTriangle size={13} className="text-yellow-400 flex-shrink-0 mt-0.5" />
                      <span>2FA is currently disabled. Enable it to protect your account from unauthorized access.</span>
                    </div>
                    <button
                      onClick={startSetup}
                      disabled={loading}
                      className="flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold text-white transition-colors"
                      style={{ background: 'var(--brand-primary)' }}>
                      {loading ? <Loader2 size={14} className="animate-spin" /> : <QrCode size={14} />}
                      Set Up 2FA
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Setup step: show QR + secret */}
            {step === 'setup' && (
              <div className="space-y-4">
                <div className="text-sm" style={{ color: 'var(--text-2)' }}>
                  <strong>Step 1:</strong> Scan this QR code with your authenticator app
                </div>
                {qrDataUrl ? (
                  <div className="flex justify-center">
                    <div className="p-3 rounded-xl bg-white inline-block">
                      <img src={qrDataUrl} alt="2FA QR Code" className="w-44 h-44" />
                    </div>
                  </div>
                ) : (
                  <div className="flex justify-center py-8">
                    <Loader2 size={24} className="animate-spin" style={{ color: 'var(--text-3)' }} />
                  </div>
                )}

                <div>
                  <p className="text-xs mb-1.5" style={{ color: 'var(--text-3)' }}>Or enter this secret manually:</p>
                  <div className="flex items-center gap-2 p-2 rounded-lg font-mono text-sm border"
                    style={{ borderColor: 'var(--border)', background: 'var(--bg)' }}>
                    <Key size={12} style={{ color: 'var(--text-3)' }} />
                    <span className="flex-1 tracking-widest" style={{ color: 'var(--text-1)' }}>{secret}</span>
                    <button onClick={copySecret} className="p-1 hover:text-white transition-colors" style={{ color: 'var(--text-3)' }}>
                      <Copy size={12} />
                    </button>
                  </div>
                </div>

                <div>
                  <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
                    <strong>Step 2:</strong> Enter the 6-digit code from your app to confirm
                  </p>
                  <OtpInput value={otp} onChange={setOtp} />
                </div>

                <div className="flex gap-2">
                  <button onClick={() => { setStep('status'); setOtp('') }} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={confirmSetup} disabled={loading || otp.length !== 6} className="btn-primary flex-1">
                    {loading ? <Loader2 size={14} className="animate-spin" /> : 'Activate 2FA'}
                  </button>
                </div>
              </div>
            )}

            {/* Disable step */}
            {step === 'disable' && (
              <div className="space-y-4">
                <div className="rounded-lg p-3 border flex items-center gap-2"
                  style={{ borderColor: 'rgba(239,68,68,0.3)', background: 'rgba(239,68,68,0.05)' }}>
                  <AlertTriangle size={14} className="text-red-400" />
                  <p className="text-xs text-red-400">Disabling 2FA reduces your account security</p>
                </div>
                <div>
                  <p className="text-sm mb-2" style={{ color: 'var(--text-2)' }}>
                    Enter your current 2FA code to confirm:
                  </p>
                  <OtpInput value={otp} onChange={setOtp} />
                </div>
                <div className="flex gap-2">
                  <button onClick={() => { setStep('status'); setOtp('') }} className="btn-secondary flex-1">Cancel</button>
                  <button onClick={disable2FA} disabled={loading || otp.length !== 6}
                    className="flex-1 py-2 rounded-lg text-sm font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-40 transition-colors">
                    {loading ? <Loader2 size={14} className="animate-spin" /> : 'Disable 2FA'}
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Info card */}
          <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
            <h4 className="text-sm font-semibold mb-2" style={{ color: 'var(--text-1)' }}>Supported Authenticator Apps</h4>
            <ul className="text-xs space-y-1" style={{ color: 'var(--text-3)' }}>
              {['Google Authenticator (iOS / Android)', 'Authy (iOS / Android / Desktop)', 'Microsoft Authenticator', '1Password / Bitwarden (TOTP built-in)'].map(app => (
                <li key={app} className="flex items-center gap-2">
                  <CheckCircle size={11} className="text-green-400 flex-shrink-0" />
                  {app}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  )
}

function OtpInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="text"
      inputMode="numeric"
      pattern="[0-9]*"
      maxLength={6}
      value={value}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="input text-center text-2xl tracking-[0.5em] font-mono w-full py-3"
      placeholder="000000"
      autoFocus
    />
  )
}
