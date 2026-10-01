import { useCallback, useEffect, useState } from 'react'
import { Check, Clock3, Copy, KeyRound, RefreshCw, ShieldCheck, X } from 'lucide-react'
import {
  productKeyAccess,
  type ProductKeyAccessRequest,
} from '../lib/api'

type RevealedCode = {
  code: string
  expires_at: string
  company_name: string
  device_name: string
}

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Date(value).toLocaleString()
}

function StatusPill({ status }: { status: ProductKeyAccessRequest['status'] }) {
  const color = status === 'pending' ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
    : status === 'approved' ? 'border-blue-500/30 bg-blue-500/10 text-blue-300'
    : status === 'consumed' ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
    : 'border-gray-600 bg-gray-800 text-gray-400'
  return <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold capitalize ${color}`}>{status}</span>
}

export default function ProductKeyAccessPage() {
  const [rows, setRows] = useState<ProductKeyAccessRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [workingId, setWorkingId] = useState('')
  const [error, setError] = useState('')
  const [revealed, setRevealed] = useState<RevealedCode | null>(null)

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true)
    try {
      setRows(await productKeyAccess.list())
      setError('')
    } catch (e) {
      setError((e as Error).message)
    } finally {
      if (!quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(true), 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  async function approve(row: ProductKeyAccessRequest) {
    setWorkingId(row.id)
    try {
      const result = await productKeyAccess.approve(row.id)
      setRevealed(result)
      await load(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorkingId('')
    }
  }

  async function deny(row: ProductKeyAccessRequest) {
    setWorkingId(row.id)
    try {
      await productKeyAccess.deny(row.id)
      await load(true)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setWorkingId('')
    }
  }

  const pending = rows.filter(row => row.status === 'pending')

  return (
    <div className="min-h-full p-6 lg:p-8">
      <div className="mb-7 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="rounded-xl bg-blue-500/10 p-2.5 text-blue-400"><KeyRound className="h-5 w-5" /></div>
            <div>
              <h1 className="text-2xl font-bold text-white">Product key access</h1>
              <p className="mt-1 text-sm text-gray-400">Approve a device before it can open the company-key screen.</p>
            </div>
          </div>
        </div>
        <button onClick={() => void load()} disabled={loading}
          className="flex items-center gap-2 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-300 hover:bg-gray-800 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4"><p className="text-xs uppercase tracking-wide text-gray-500">Pending</p><p className="mt-2 text-3xl font-bold text-amber-300">{pending.length}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4"><p className="text-xs uppercase tracking-wide text-gray-500">Approved / waiting</p><p className="mt-2 text-3xl font-bold text-blue-300">{rows.filter(r => r.status === 'approved').length}</p></div>
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-4"><p className="text-xs uppercase tracking-wide text-gray-500">Used</p><p className="mt-2 text-3xl font-bold text-emerald-300">{rows.filter(r => r.status === 'consumed').length}</p></div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{error}</div>}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900">
        <div className="border-b border-gray-800 px-5 py-4"><h2 className="font-semibold text-white">Recent requests</h2></div>
        {loading ? (
          <div className="flex items-center justify-center gap-2 py-16 text-sm text-gray-500"><RefreshCw className="h-4 w-4 animate-spin" /> Loading requests…</div>
        ) : rows.length === 0 ? (
          <div className="py-16 text-center text-sm text-gray-500">No product-key access requests yet.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-gray-950/60 text-xs uppercase text-gray-500"><tr><th className="px-5 py-3">Company / device</th><th className="px-5 py-3">Requested</th><th className="px-5 py-3">Expires</th><th className="px-5 py-3">Status</th><th className="px-5 py-3 text-right">Action</th></tr></thead>
              <tbody className="divide-y divide-gray-800">
                {rows.map(row => (
                  <tr key={row.id} className="text-gray-300">
                    <td className="px-5 py-4"><p className="font-semibold text-white">{row.company_name}</p><p className="mt-1 text-xs text-gray-500">{row.device_name} · {row.device_id.slice(0, 12)}</p></td>
                    <td className="px-5 py-4 text-gray-400">{formatDate(row.created_at)}</td>
                    <td className="px-5 py-4 text-gray-400">{formatDate(row.expires_at)}</td>
                    <td className="px-5 py-4"><StatusPill status={row.status} /></td>
                    <td className="px-5 py-4">
                      {row.status === 'pending' && <div className="flex justify-end gap-2">
                        <button onClick={() => void deny(row)} disabled={workingId === row.id} className="rounded-lg border border-red-500/25 px-3 py-2 text-xs font-semibold text-red-300 hover:bg-red-500/10 disabled:opacity-50"><X className="mr-1 inline h-3.5 w-3.5" />Deny</button>
                        <button onClick={() => void approve(row)} disabled={workingId === row.id} className="rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"><Check className="mr-1 inline h-3.5 w-3.5" />Approve</button>
                      </div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {revealed && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-emerald-500/25 bg-gray-900 p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4"><div className="rounded-xl bg-emerald-500/10 p-3 text-emerald-400"><ShieldCheck className="h-6 w-6" /></div><button onClick={() => setRevealed(null)} className="text-gray-500 hover:text-white"><X className="h-5 w-5" /></button></div>
            <h2 className="mt-5 text-xl font-bold text-white">Approval code</h2>
            <p className="mt-2 text-sm leading-6 text-gray-400">Give this code only to the administrator at <span className="font-semibold text-gray-200">{revealed.device_name}</span>. It is shown once and expires in 10 minutes.</p>
            <button onClick={() => void navigator.clipboard.writeText(revealed.code)} className="mt-5 flex w-full items-center justify-center gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-5 font-mono text-4xl font-bold tracking-[0.35em] text-emerald-300 hover:bg-emerald-500/15">{revealed.code}<Copy className="h-5 w-5" /></button>
            <div className="mt-4 flex items-center gap-2 text-xs text-gray-500"><Clock3 className="h-3.5 w-3.5" />Expires {formatDate(revealed.expires_at)}</div>
            <button onClick={() => setRevealed(null)} className="mt-6 w-full rounded-lg bg-gray-800 px-4 py-2.5 text-sm font-semibold text-white hover:bg-gray-700">Done</button>
          </div>
        </div>
      )}
    </div>
  )
}

