import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { DollarSign, Unlock, Lock, History, TrendingUp, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

const DENOMINATIONS = [2000, 1000, 500, 100, 50, 20, 10, 5, 2, 1]

type DenomMap = Record<number, number>
type Session = {
  id: string; branch_id: string; opened_by: string; opened_by_name?: string
  opened_at: string; opening_cash: number; denominations: string
  closed_by?: string; closed_by_name?: string; closed_at?: string
  closing_cash?: number; closing_denominations?: string; closing_notes?: string
  sales_total?: number; sales_count?: number; difference?: number; status: string
}

const fmt = (n: number | undefined | null) =>
  `Rs. ${Number(n ?? 0).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`

function DenomGrid({ values, onChange, disabled }: {
  values: DenomMap; onChange: (d: number, v: number) => void; disabled?: boolean
}) {
  const total = DENOMINATIONS.reduce((s, d) => s + d * (values[d] || 0), 0)
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 mb-3">
        {DENOMINATIONS.map(d => (
          <div key={d} className="flex items-center gap-2">
            <span className="text-xs w-10 text-right font-semibold" style={{ color: 'var(--text-2)' }}>
              {d >= 1 ? `${d}` : `${d * 100}¢`}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-3)' }}>×</span>
            <input
              type="number" min={0}
              value={values[d] || ''}
              onChange={e => onChange(d, Math.max(0, parseInt(e.target.value) || 0))}
              disabled={disabled}
              className="input py-1 text-xs w-20 text-center"
              placeholder="0"
            />
            <span className="text-xs w-20 text-right" style={{ color: 'var(--text-2)' }}>
              {values[d] ? fmt(d * values[d]) : ''}
            </span>
          </div>
        ))}
      </div>
      <div className="flex justify-end pt-2 border-t font-bold text-blue-600 text-sm" style={{ borderTop: '1px solid var(--border)' }}>
        Total: {fmt(total)}
      </div>
    </div>
  )
}

function emptyDenoms(): DenomMap {
  return Object.fromEntries(DENOMINATIONS.map(d => [d, 0]))
}

function calcTotal(dm: DenomMap) {
  return DENOMINATIONS.reduce((s, d) => s + d * (dm[d] || 0), 0)
}

export default function CashRegisterPage() {
  const { user } = useAuthStore()
  const branchId = user?.branch?.id || (user as unknown as Record<string, unknown>)?.branch_id as string || ''

  const [session, setSession]       = useState<Session | null>(null)
  const [loading, setLoading]       = useState(true)
  const [history, setHistory]       = useState<Session[]>([])
  const [tab, setTab]               = useState<'register' | 'history'>('register')

  // Open session form
  const [openDenoms, setOpenDenoms] = useState<DenomMap>(emptyDenoms())
  const [openNotes, setOpenNotes]   = useState('')
  const [opening, setOpening]       = useState(false)

  // Close session form
  const [closeDenoms, setCloseDenoms] = useState<DenomMap>(emptyDenoms())
  const [closeNotes, setCloseNotes]   = useState('')
  const [closing, setClosing]         = useState(false)
  const [showCloseForm, setShowCloseForm] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [sess, hist] = await Promise.all([
        window.api.cash.getOpen(branchId),
        window.api.cash.history(branchId),
      ])
      if (sess.success) setSession(sess.data as Session | null)
      else { setSession(null); toast.error(sess.error || 'Failed to load cash session') }
      if (hist.success) setHistory(hist.data as Session[])
      else { setHistory([]); toast.error(hist.error || 'Failed to load cash history') }
    } catch (err: any) {
      toast.error(err.message || 'Failed to load cash register data')
    } finally { setLoading(false) }
  }

  useEffect(() => { if (branchId) load() }, [branchId])

  const openSession = async () => {
    if (!branchId) { toast.error('No branch assigned to your account'); return }
    const total = calcTotal(openDenoms)
    setOpening(true)
    try {
      const res = await window.api.cash.open({
        branch_id: branchId, opened_by: user?.id || '',
        opening_cash: total, denominations: openDenoms, notes: openNotes || undefined
      })
      if (res.success) {
        toast.success(`Session opened — Opening cash: ${fmt(total)}`)
        setOpenDenoms(emptyDenoms())
        setOpenNotes('')
        load()
      } else toast.error(res.error || 'Failed to open session')
    } catch (err: any) {
      toast.error(err.message || 'Failed to open session')
    } finally { setOpening(false) }
  }

  const closeSession = async () => {
    if (!session) return
    const total = calcTotal(closeDenoms)
    setClosing(true)
    try {
      const res = await window.api.cash.close({
        session_id: session.id, closed_by: user?.id || '',
        closing_cash: total, denominations: closeDenoms, notes: closeNotes || undefined
      })
      if (res.success) {
        toast.success('Session closed successfully')
        setShowCloseForm(false)
        setCloseDenoms(emptyDenoms())
        setCloseNotes('')
        load()
      } else toast.error(res.error || 'Failed to close session')
    } catch (err: any) {
      toast.error(err.message || 'Failed to close session')
    } finally { setClosing(false) }
  }

  const openDenomChange = (d: number, v: number) => setOpenDenoms(prev => ({ ...prev, [d]: v }))
  const closeDenomChange = (d: number, v: number) => setCloseDenoms(prev => ({ ...prev, [d]: v }))

  const closingTotal = calcTotal(closeDenoms)
  const openingCash  = Number(session?.opening_cash || 0)

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>
        Loading cash register…
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Cash Register"
        subtitle={session ? `Session open since ${session.opened_at?.slice(0, 16).replace('T', ' ')}` : 'No open session'}
        actions={
          <div className="flex gap-2">
            <button
              onClick={() => setTab('register')}
              className={tab === 'register' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            >
              <DollarSign size={14} /> Register
            </button>
            <button
              onClick={() => setTab('history')}
              className={tab === 'history' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}
            >
              <History size={14} /> History
            </button>
          </div>
        }
      />

      {tab === 'register' && (
        <div className="flex-1 overflow-auto p-6">
          {!session ? (
            /* — Open Session — */
            <div className="max-w-2xl mx-auto">
              <div className="card mb-6">
                <div className="flex items-center gap-2 mb-4">
                  <Unlock size={18} className="text-green-500" />
                  <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Open New Session</p>
                </div>
                <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
                  Count and enter your opening cash by denomination. This records the starting float for the day.
                </p>

                <DenomGrid values={openDenoms} onChange={openDenomChange} />

                <div className="mt-4">
                  <label className="label">Notes (optional)</label>
                  <input className="input" value={openNotes} onChange={e => setOpenNotes(e.target.value)} placeholder="e.g. Opening shift" />
                </div>

                <div className="mt-5 flex justify-between items-center">
                  <p className="text-sm" style={{ color: 'var(--text-3)' }}>
                    Opening float: <span className="font-bold text-blue-600">{fmt(calcTotal(openDenoms))}</span>
                  </p>
                  <button onClick={openSession} disabled={opening} className="btn-primary gap-1.5">
                    <Unlock size={14} />
                    {opening ? 'Opening…' : 'Open Session'}
                  </button>
                </div>
              </div>
            </div>
          ) : !showCloseForm ? (
            /* — Active Session Dashboard — */
            <div className="max-w-2xl mx-auto space-y-4">
              <div className="card">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Session Active</p>
                  </div>
                  <button onClick={() => setShowCloseForm(true)} className="btn-danger btn-sm gap-1.5">
                    <Lock size={13} /> Close Session
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  {[
                    { label: 'Opened By', value: session.opened_by_name || '—' },
                    { label: 'Opened At', value: session.opened_at?.slice(0, 16).replace('T', ' ') },
                    { label: 'Opening Cash', value: fmt(session.opening_cash) },
                    { label: 'Branch', value: user?.branch?.name || branchId },
                  ].map(({ label, value }) => (
                    <div key={label} className="p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                      <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>{label}</p>
                      <p className="font-semibold text-sm" style={{ color: 'var(--text-1)' }}>{value}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            /* — Close Session Form — */
            <div className="max-w-2xl mx-auto">
              <div className="card">
                <div className="flex items-center gap-2 mb-2">
                  <Lock size={18} className="text-red-500" />
                  <p className="font-semibold" style={{ color: 'var(--text-1)' }}>Close Session</p>
                </div>
                <p className="text-sm mb-4" style={{ color: 'var(--text-3)' }}>
                  Count the actual cash in the drawer and enter it below to close the session.
                </p>

                {/* Summary preview */}
                <div className="grid grid-cols-3 gap-3 mb-5 p-3 rounded-lg border" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <div className="text-center">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Opening Cash</p>
                    <p className="font-semibold text-sm text-blue-600">{fmt(openingCash)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Closing Count</p>
                    <p className="font-semibold text-sm text-blue-600">{fmt(closingTotal)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Expected Diff</p>
                    <p className={`font-semibold text-sm ${closingTotal - openingCash >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                      {closingTotal - openingCash >= 0 ? '+' : ''}{fmt(closingTotal - openingCash)}
                    </p>
                  </div>
                </div>

                <DenomGrid values={closeDenoms} onChange={closeDenomChange} />

                <div className="mt-4">
                  <label className="label">Closing Notes (optional)</label>
                  <input className="input" value={closeNotes} onChange={e => setCloseNotes(e.target.value)} placeholder="e.g. End of day shift" />
                </div>

                <div className="mt-5 flex gap-3 justify-end">
                  <button onClick={() => setShowCloseForm(false)} className="btn-secondary">Back</button>
                  <button onClick={closeSession} disabled={closing} className="btn-danger gap-1.5">
                    <Lock size={14} />
                    {closing ? 'Closing…' : `Close — ${fmt(closingTotal)}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'history' && (
        <div className="flex-1 overflow-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-header">
                <th className="text-left px-4 py-3">Date</th>
                <th className="text-left px-4 py-3">Opened By</th>
                <th className="text-right px-4 py-3">Opening</th>
                <th className="text-right px-4 py-3">Sales</th>
                <th className="text-right px-4 py-3">Closing</th>
                <th className="text-right px-4 py-3">Difference</th>
                <th className="text-left px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0
                ? <tr><td colSpan={7} className="text-center py-12" style={{ color: 'var(--text-3)' }}>No history</td></tr>
                : history.map((s, i) => {
                    const diff = Number(s.difference ?? 0)
                    return (
                      <tr key={s.id} className="border-t" style={{ borderColor: 'var(--border)', background: i % 2 === 1 ? 'var(--bg-soft)' : undefined }}>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-2)' }}>
                          <p>{s.opened_at?.slice(0, 10)}</p>
                          <p style={{ color: 'var(--text-3)' }}>{s.opened_at?.slice(11, 16)}</p>
                        </td>
                        <td className="px-4 py-3 text-xs" style={{ color: 'var(--text-1)' }}>{s.opened_by_name || '—'}</td>
                        <td className="px-4 py-3 text-right text-xs font-semibold" style={{ color: 'var(--text-2)' }}>{fmt(s.opening_cash)}</td>
                        <td className="px-4 py-3 text-right text-xs" style={{ color: 'var(--text-2)' }}>
                          {s.sales_total != null ? fmt(s.sales_total) : '—'}
                          {s.sales_count != null && <span style={{ color: 'var(--text-3)' }}> ({s.sales_count})</span>}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-semibold" style={{ color: 'var(--text-2)' }}>
                          {s.closing_cash != null ? fmt(s.closing_cash) : '—'}
                        </td>
                        <td className="px-4 py-3 text-right text-xs font-bold">
                          {s.difference != null ? (
                            <span className={diff >= 0 ? 'text-green-600' : 'text-red-500'}>
                              {diff >= 0 ? '+' : ''}{fmt(diff)}
                              {Math.abs(diff) > 500 && <AlertTriangle size={11} className="inline ml-1" />}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`badge text-xs ${
                            s.status === 'open' ? 'badge-success'
                            : s.status === 'closed' ? 'badge-secondary'
                            : 'bg-yellow-100 text-yellow-700'
                          }`}>
                            {s.status}
                          </span>
                        </td>
                      </tr>
                    )
                  })
              }
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
