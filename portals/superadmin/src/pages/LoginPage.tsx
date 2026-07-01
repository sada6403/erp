import { useState, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { auth } from '../lib/api'
import { ShieldCheck } from 'lucide-react'

export default function LoginPage() {
  const [email, setEmail]     = useState('')
  const [password, setPassword] = useState('')
  const [error, setError]     = useState('')
  const [loading, setLoading] = useState(false)
  const navigate  = useNavigate()
  const setUser   = useAuthStore(s => s.setUser)

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(''); setLoading(true)
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

  return (
    <div className="min-h-screen bg-gray-950 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-blue-600 mb-4">
            <ShieldCheck className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-white">Superadmin Portal</h1>
          <p className="text-gray-400 text-sm mt-1">Enterprise POS ERP — Platform Management</p>
        </div>

        <form onSubmit={submit} className="card space-y-4">
          {error && (
            <div className="bg-red-900/30 border border-red-700/50 rounded-lg px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <div>
            <label className="label">Email</label>
            <input className="input" type="email" autoFocus value={email}
              onChange={e => setEmail(e.target.value)} required />
          </div>

          <div>
            <label className="label">Password</label>
            <input className="input" type="password" value={password}
              onChange={e => setPassword(e.target.value)} required />
          </div>

          <button className="btn-primary w-full mt-2" type="submit" disabled={loading}>
            {loading ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        <p className="text-center text-xs text-gray-600 mt-6">
          This portal is restricted to authorised platform administrators only.
        </p>
      </div>
    </div>
  )
}
