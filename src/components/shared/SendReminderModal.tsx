import { useEffect, useState } from 'react'
import Modal from '@/components/shared/Modal'
import { Send, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Review-before-send payment reminder — reused by the Conduct Draw pending-
// members list, the standalone Pending Members view, and the Payment
// Reminders page, so the review/send/duplicate-warning flow only exists once.
export default function SendReminderModal({ memberId, cycleNo, onClose, onSent }: {
  memberId: string; cycleNo?: number; onClose: () => void; onSent?: () => void
}) {
  const [preview, setPreview] = useState<Row | null>(null)
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [confirmNeeded, setConfirmNeeded] = useState<string | null>(null)

  useEffect(() => {
    window.api.chits.reminders.preview(memberId, cycleNo).then((res: { success: boolean; data?: Row; error?: string }) => {
      if (res.success) setPreview(res.data || null)
      else toast.error(res.error || 'Failed to prepare reminder')
    }).catch(() => toast.error('Failed to prepare reminder')).finally(() => setLoading(false))
  }, [memberId, cycleNo])

  const send = async (force = false) => {
    setSending(true)
    try {
      const res = await window.api.chits.reminders.send(memberId, cycleNo, force)
      if (res.success) {
        toast.success('Reminder sent')
        onSent?.()
        onClose()
      } else if (res.requiresConfirmation) {
        setConfirmNeeded(res.error || 'A reminder was already sent today.')
      } else {
        toast.error(res.error || 'Failed to send reminder')
      }
    } catch (err) {
      toast.error((err as Error)?.message || 'Failed to send reminder')
    } finally {
      setSending(false)
    }
  }

  return (
    <Modal title="Send Payment Reminder" onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={() => send(false)} disabled={sending || loading || !preview} className="btn-primary gap-1.5">
          <Send size={14} /> {sending ? 'Sending…' : 'Send Reminder'}
        </button>
      </>}>
      {loading ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>Loading...</p>
      ) : !preview ? (
        <p className="text-center py-6" style={{ color: 'var(--text-3)' }}>Nothing to remind — this member has already paid.</p>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2 text-xs">
            <div><span style={{ color: 'var(--text-3)' }}>Customer</span><p style={{ color: 'var(--text-1)' }}>{preview.customerName as string}</p></div>
            <div><span style={{ color: 'var(--text-3)' }}>Phone</span><p style={{ color: 'var(--text-1)' }}>{(preview.customerPhone as string) || '—'}</p></div>
            <div><span style={{ color: 'var(--text-3)' }}>Required</span><p style={{ color: 'var(--text-1)' }}>Rs.{money(preview.requiredAmount)}</p></div>
            <div><span style={{ color: 'var(--text-3)' }}>Paid</span><p style={{ color: 'var(--text-1)' }}>Rs.{money(preview.paidAmount)}</p></div>
            <div><span style={{ color: 'var(--text-3)' }}>Balance</span><p className="font-semibold" style={{ color: '#f59e0b' }}>Rs.{money(preview.balanceDue)}</p></div>
            <div><span style={{ color: 'var(--text-3)' }}>Due Date</span><p style={{ color: 'var(--text-1)' }}>{preview.dueDate as string}</p></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1">Message Preview</label>
            <textarea readOnly value={preview.message as string} className="input h-28 resize-none text-sm" />
          </div>
          {preview.lastReminder ? (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>
              Last Reminder Sent: {new Date(String((preview.lastReminder as Row).sent_at)).toLocaleString()}
            </p>
          ) : (
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>No reminder sent yet for this cycle.</p>
          )}
          {confirmNeeded && (
            <div className="rounded-lg p-3 flex items-start gap-2" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid #f59e0b' }}>
              <AlertTriangle size={16} className="text-yellow-500 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs" style={{ color: '#a16207' }}>{confirmNeeded}</p>
                <button onClick={() => send(true)} disabled={sending} className="btn-secondary btn-sm mt-2">Send Anyway</button>
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
