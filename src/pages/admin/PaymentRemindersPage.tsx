import { useEffect, useState } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import SendReminderModal from '@/components/shared/SendReminderModal'
import { Send, Bell, History } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const STATUS_BADGE: Record<string, string> = {
  paid: 'badge-green', partial: 'badge-yellow', pending: 'badge-gray', overdue: 'badge-red',
}

// Cross-scheme "who owes what right now" + reminder history — the standalone
// counterpart to the Pending Members tab on a single scheme's detail page,
// scoped to the caller's branch (or company-wide for Super Admin) like every
// other Smart Buy cross-scheme report.
export default function PaymentRemindersPage() {
  const [tab, setTab] = useState<'outstanding' | 'history'>('outstanding')
  const [branches, setBranches] = useState<Row[]>([])
  const [branchId, setBranchId] = useState('')
  const [outstanding, setOutstanding] = useState<Row[]>([])
  const [history, setHistory] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [remindingMemberId, setRemindingMemberId] = useState<string | null>(null)

  useEffect(() => {
    window.api.admin.branches.list().then((res: Row) => { if (res.success) setBranches(res.data as Row[]) }).catch(() => {})
  }, [])

  const load = async () => {
    setLoading(true)
    try {
      if (tab === 'outstanding') {
        const res = await window.api.chits.reportsOutstanding({ branchId: branchId || undefined })
        if (res.success) setOutstanding(res.data as Row[])
        else toast.error(res.error || 'Failed to load outstanding members')
      } else {
        const res = await window.api.chits.reminders.list({ branchId: branchId || undefined })
        if (res.success) setHistory(res.data as Row[])
        else toast.error(res.error || 'Failed to load reminder history')
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to load')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [tab, branchId]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Payment Reminders" subtitle="Members with outstanding SmartBuy payments and reminder history" />

      <div className="flex flex-wrap items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="flex gap-1">
          <button onClick={() => setTab('outstanding')} className={tab === 'outstanding' ? 'btn-primary btn-sm gap-1.5' : 'btn-secondary btn-sm gap-1.5'}>
            <Bell size={13} /> Outstanding
          </button>
          <button onClick={() => setTab('history')} className={tab === 'history' ? 'btn-primary btn-sm gap-1.5' : 'btn-secondary btn-sm gap-1.5'}>
            <History size={13} /> Reminder History
          </button>
        </div>
        <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input text-sm w-auto">
          <option value="">All Branches</option>
          {branches.map(b => <option key={b.id as string} value={b.id as string}>{b.name as string}</option>)}
        </select>
      </div>

      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>Loading...</p>
        ) : tab === 'outstanding' ? (
          outstanding.length === 0 ? (
            <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>No outstanding payments — everyone is paid up.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-sm">
                <thead>
                  <tr style={{ background: 'var(--bg-soft)' }}>
                    {['Member', 'Phone', 'Scheme', 'Cycle', 'Month', 'Required', 'Paid', 'Balance', 'Due Date', 'Days Overdue', 'Status', ''].map(h => (
                      <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {outstanding.map((r, i) => (
                    <tr key={i} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{(r.member_name as string) || '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(r.member_phone as string) || '—'}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{r.scheme_name as string} <span className="font-mono" style={{ color: 'var(--text-3)' }}>({r.scheme_number as string})</span></td>
                      <td className="px-3 py-2 text-xs">{r.cycle_no as number}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{r.month as string}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">Rs.{money(r.required)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-xs">Rs.{money(r.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: '#f59e0b' }}>Rs.{money(r.balance)}</td>
                      <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{r.due_date as string}</td>
                      <td className="px-3 py-2 text-xs">{Number(r.days_overdue || 0) > 0 ? <span className="text-red-500 font-semibold">{r.days_overdue as number}</span> : '—'}</td>
                      <td className="px-3 py-2"><span className={STATUS_BADGE[String(r.status)] || 'badge-gray'}>{r.status as string}</span></td>
                      <td className="px-3 py-2">
                        <button onClick={() => setRemindingMemberId(r.member_id as string)} className="btn-secondary btn-sm gap-1.5"><Send size={12} /> Send Reminder</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : history.length === 0 ? (
          <p className="text-center py-16" style={{ color: 'var(--text-3)' }}>No reminders sent yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-sm">
              <thead>
                <tr style={{ background: 'var(--bg-soft)' }}>
                  {['Sent At', 'Member', 'Scheme', 'Cycle', 'Delivery Status', 'Sent By'].map(h => (
                    <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {history.map(r => (
                  <tr key={r.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{new Date(String(r.sent_at)).toLocaleString()}</td>
                    <td className="px-3 py-2" style={{ color: 'var(--text-1)' }}>{(r.customer_name as string) || '—'} <span className="text-xs" style={{ color: 'var(--text-3)' }}>{(r.customer_phone as string) || ''}</span></td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{r.scheme_name as string} <span className="font-mono" style={{ color: 'var(--text-3)' }}>({r.scheme_number as string})</span></td>
                    <td className="px-3 py-2 text-xs">{r.cycle_no as number}</td>
                    <td className="px-3 py-2">
                      <span className={r.delivery_status === 'sent' ? 'badge-green' : r.delivery_status === 'failed' ? 'badge-red' : 'badge-gray'}>{r.delivery_status as string}</span>
                    </td>
                    <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(r.sent_by_name as string) || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {remindingMemberId && (
        <SendReminderModal memberId={remindingMemberId} onClose={() => setRemindingMemberId(null)} onSent={load} />
      )}
    </div>
  )
}
