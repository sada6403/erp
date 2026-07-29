import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import { Coins, Users, Wallet, Shuffle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export default function SmartBuyDashboardPage() {
  const navigate = useNavigate()
  const [data, setData] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)

  const load = async () => {
    setLoading(true)
    try {
      const res = await window.api.chits.dashboard()
      if (res.success) setData(res.data)
      else toast.error(res.error || 'Failed to load Smart Buy dashboard')
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load Smart Buy dashboard')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading || !data) {
    return <div className="flex items-center justify-center h-full" style={{ color: 'var(--text-3)' }}>Loading...</div>
  }

  const recentDraws = (data.recent_draws || []) as Row[]
  const agentsWithBalance = (data.agents_with_balance || []) as Row[]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Smart Buy Dashboard" subtitle="Schemes, collections, agents, and lottery activity overview" />

      <div className="flex-1 overflow-auto p-6 space-y-6">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button onClick={() => navigate('/admin/chits')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Coins size={13} /> Active Schemes</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.active_schemes || 0)}</p>
          </button>
          <button onClick={() => navigate('/admin/chit-customers')} className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Users size={13} /> Members Enrolled</p>
            <p className="text-2xl font-bold mt-1" style={{ color: 'var(--text-1)' }}>{Number(data.members_enrolled || 0)}</p>
          </button>
          <div className="rounded-xl border p-4" style={{ background: 'var(--bg-card)', borderColor: 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Coins size={13} /> Collected This Month</p>
            <p className="text-2xl font-bold mt-1 text-brand-400">Rs.{money(data.collected_this_month)}</p>
          </div>
          <button onClick={() => navigate('/admin/smart-buy-agents')}
            className="rounded-xl border p-4 text-left transition-colors hover:border-[var(--brand-primary)]"
            style={{ background: Number(data.pending_remittance_total) > 0 ? 'color-mix(in srgb, #f59e0b 10%, transparent)' : 'var(--bg-card)', borderColor: Number(data.pending_remittance_total) > 0 ? '#f59e0b' : 'var(--border)' }}>
            <p className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--text-3)' }}><Wallet size={13} /> Pending Agent Remittance</p>
            <p className="text-2xl font-bold mt-1" style={{ color: Number(data.pending_remittance_total) > 0 ? '#f59e0b' : 'var(--text-1)' }}>Rs.{money(data.pending_remittance_total)}</p>
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><Shuffle size={14} /> Recent Draws</h3>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    {['Date', 'Scheme', 'Winner', 'Product'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {recentDraws.length === 0 ? (
                    <tr><td colSpan={4} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No draws yet</td></tr>
                  ) : recentDraws.map((d, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{d.draw_date ? new Date(String(d.draw_date)).toLocaleDateString() : '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{d.scheme_name as string}</td>
                      <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{d.method === 'final_batch' ? 'Final settlement' : (d.winner_name as string) || '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{d.redeemed_product_name ? `${d.redeemed_product_name as string} × ${d.redeemed_qty as number}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-semibold mb-2 flex items-center gap-1.5" style={{ color: 'var(--text-1)' }}><AlertCircle size={14} /> Agents With Outstanding Cash</h3>
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    {['Agent', 'Balance to Submit'].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {agentsWithBalance.length === 0 ? (
                    <tr><td colSpan={2} className="text-center py-8" style={{ color: 'var(--text-3)' }}>All agents are settled up</td></tr>
                  ) : agentsWithBalance.map(a => (
                    <tr key={a.id as string} className="border-t cursor-pointer hover:bg-[var(--bg-soft)]" style={{ borderColor: 'var(--border)' }}
                      onClick={() => navigate('/admin/smart-buy-agents')}>
                      <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{a.name as string} <span className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>({a.code as string})</span></td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: '#f59e0b' }}>Rs.{money(a.cash_balance)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
