import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { auth } from '../lib/api'
import { ShieldCheck, ArrowLeft, KeyRound, Mail, CheckCircle2 } from 'lucide-react'

export default function LoginPage() {
  const [mode, setMode]               = useState<'login' | 'forgot' | 'reset'>('login')
  const [email, setEmail]             = useState('')
  const [password, setPassword]       = useState('')
  const [otp, setOtp]                 = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const [error, setError]     = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)

  const navigate  = useNavigate()
  const setUser   = useAuthStore(s => s.setUser)

  async function handleLogin(e: FormEvent) {
    e.preventDefault()
    setError(''); setMessage(''); setLoading(true)
    try {
      const d = await auth.login(email, password) as { accessToken: string; refreshToken: string; user: { id: string; name: string; email: string } }
      setUser({ ...d.user, portal: 'superadmin' }, d.accessToken, d.refreshToken)
      localStorage.setItem('sa_user', JSON.stringify({ ...d.user, portal: 'superadmin' }))
      navigate('/')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleSendOtp(e: FormEvent) {
    e.preventDefault()
    setError(''); setMessage(''); setLoading(true)
    try {
      const res = await auth.forgotPassword(email) as { success: boolean; sent?: boolean; noSmtp?: boolean; message?: string }
      if (res.success) {
        if (res.noSmtp) {
          setMessage('Reset code generated. SMTP is not enabled on server, ask platform admin or check server logs for the 6-digit code.')
        } else {
          setMessage('Reset code sent to your email!')
        }
        setMode('reset')
      } else {
        setError(res.message || 'Failed to send reset code')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword(e: FormEvent) {
    e.preventDefault()
    setError(''); setMessage(''); setLoading(true)

    if (newPassword !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (newPassword.length < 8) {
      setError('Password must be at least 8 characters long')
      setLoading(false)
      return
    }

    try {
      const res = await auth.resetPassword(email, otp, newPassword) as { success: boolean; message?: string }
      if (res.success) {
        setMessage('Password reset successful! Logging in...')
        // Auto login with new password
        try {
          const d = await auth.login(email, newPassword) as { accessToken: string; refreshToken: string; user: { id: string; name: string; email: string } }
          setUser({ ...d.user, portal: 'superadmin' }, d.accessToken, d.refreshToken)
          localStorage.setItem('sa_user', JSON.stringify({ ...d.user, portal: 'superadmin' }))
          navigate('/')
        } catch {
          // If auto login fails, return to login mode with success message
          setMode('login')
          setPassword('')
          setMessage('Password reset successful! Please sign in with your new password.')
        }
      } else {
        setError(res.message || 'Failed to reset password')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reset failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4 shadow-lg shadow-blue-500/20">
            {mode === 'login' ? (
              <ShieldCheck className="w-8 h-8 text-white" />
            ) : mode === 'forgot' ? (
              <Mail className="w-8 h-8 text-white" />
            ) : (
              <KeyRound className="w-8 h-8 text-white" />
            )}
          </div>
          <h1 className="text-2xl font-bold text-white">
            {mode === 'login' ? 'Superadmin Portal' : mode === 'forgot' ? 'Reset Password' : 'Enter Reset Code'}
          </h1>
          <p className="text-gray-400 text-sm mt-1">
            {mode === 'login' && 'Enterprise POS ERP — Platform Management'}
            {mode === 'forgot' && 'Enter your registered email to receive a 6-digit reset code.'}
            {mode === 'reset' && `Enter the 6-digit code sent to ${email || 'your email'}`}
          </p>
        </div>

        <div className="card space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {message && (
            <div className="bg-green-900/30 border border-green-700/50 rounded-lg px-4 py-3 text-green-400 text-sm flex items-start gap-2">
              <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
              <span>{message}</span>
            </div>
          )}

          {/* Mode 1: Sign In Form */}
          {mode === 'login' && (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <input className="input" type="email" autoFocus value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="superadmin@example.com" required />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="label">Password</label>
                  <button
                    type="button"
                    onClick={() => { setError(''); setMessage(''); setMode('forgot') }}
                    className="text-xs text-blue-400 hover:text-blue-300 font-medium transition-colors"
                  >
                    Forgot password?
                  </button>
                </div>
                <input className="input" type="password" value={password}
                  onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
              </div>

              <button className="btn-primary w-full mt-2" type="submit" disabled={loading}>
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          )}

          {/* Mode 2: Forgot Password Form */}
          {mode === 'forgot' && (
            <form onSubmit={handleSendOtp} className="space-y-4">
              <div>
                <label className="label">Superadmin Email</label>
                <input className="input" type="email" autoFocus value={email}
                  onChange={e => setEmail(e.target.value)} placeholder="superadmin@example.com" required />
              </div>

              <button className="btn-primary w-full mt-2" type="submit" disabled={loading}>
                {loading ? 'Sending code…' : 'Send Reset Code'}
              </button>

              <div className="pt-2 text-center">
                <button
                  type="button"
                  onClick={() => { setError(''); setMessage(''); setMode('login') }}
                  className="inline-flex items-center gap-1.5 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign in
                </button>
              </div>
            </form>
          )}

          {/* Mode 3: Reset Password with OTP Form */}
          {mode === 'reset' && (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div>
                <label className="label">Superadmin Email</label>
                <input className="input" type="email" value={email}
                  onChange={e => setEmail(e.target.value)} required />
              </div>

              <div>
                <label className="label">6-Digit Verification Code</label>
                <input className="input tracking-widest text-center text-lg font-mono" type="text" maxLength={6} autoFocus
                  value={otp} onChange={e => setOtp(e.target.value)} placeholder="123456" required />
              </div>

              <div>
                <label className="label">New Password</label>
                <input className="input" type="password" value={newPassword}
                  onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 8 characters" required />
              </div>

              <div>
                <label className="label">Confirm New Password</label>
                <input className="input" type="password" value={confirmPassword}
                  onChange={e => setConfirmPassword(e.target.value)} placeholder="Re-enter new password" required />
              </div>

              <button className="btn-primary w-full mt-2" type="submit" disabled={loading}>
                {loading ? 'Resetting password…' : 'Reset Password & Sign In'}
              </button>

              <div className="pt-2 text-center flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => { setError(''); setMessage(''); setMode('forgot') }}
                  className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Resend code
                </button>
                <button
                  type="button"
                  onClick={() => { setError(''); setMessage(''); setMode('login') }}
                  className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-white transition-colors"
                >
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to Sign in
                </button>
              </div>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-600 mt-6">
          This portal is restricted to authorised platform administrators only.
        </p>
      </div>
    </div>
  )
}
