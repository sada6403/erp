import { useEffect, useState } from 'react'
import Modal from '@/components/shared/Modal'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Chronological ledger of every individual chit_contributions row for one
// Smart Buy member — reused from both the customer-side (ChitCustomersPage)
// and agent-side (SmartBuyAgentsPage) detail views.
export default function MemberPaymentHistoryModal({ memberId, onClose }: { memberId: string; onClose: () => void }) {
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    window.api.chits.members.contributionHistory(memberId).then((res: { success: boolean; data?: Row[]; error?: string }) => {
      if (res.success) setRows(res.data || [])
      else toast.error(res.error || 'Failed to load payment history')
    }).catch(() => toast.error('Failed to load payment history')).finally(() => setLoading(false))
  }, [memberId])

  return (
    <Modal title="Payment History" size="lg" onClose={onClose}>
      {loading ? (
        <p className="text-center py-8" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead>
              <tr style={{ background: 'var(--bg-soft)' }}>
                {['Date', 'Amount', 'Method', 'Receipt', 'Collected By', 'Status', 'Recorded By'].map(h => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold" style={{ color: 'var(--text-3)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-8" style={{ color: 'var(--text-3)' }}>No payments recorded yet</td></tr>
              ) : rows.map(r => (
                <tr key={r.id as string} className="border-t" style={{ borderColor: 'var(--border)' }}>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{new Date(String(r.paid_at)).toLocaleDateString()}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-semibold" style={{ color: 'var(--text-1)' }}>Rs.{money(r.amount)}</td>
                  <td className="px-3 py-2 text-xs capitalize" style={{ color: 'var(--text-2)' }}>{(r.method as string)?.replace('_', ' ')}</td>
                  <td className="px-3 py-2 text-xs font-mono" style={{ color: 'var(--text-3)' }}>{(r.receipt_number as string) || '—'}</td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-2)' }}>{(r.collected_by_agent_name as string) || '—'}</td>
                  <td className="px-3 py-2"><span className={r.status === 'approved' ? 'badge-green' : r.status === 'rejected' ? 'badge-red' : 'badge-yellow'}>{r.status as string}</span></td>
                  <td className="px-3 py-2 text-xs" style={{ color: 'var(--text-3)' }}>{(r.received_by_name as string) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Modal>
  )
}
