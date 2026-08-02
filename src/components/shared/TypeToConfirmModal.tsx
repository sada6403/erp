import { useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

// Generic "type X to confirm" gate for irreversible actions — a plain
// confirm() is too easy to click through for something that erases history
// for good (e.g. purging a cancelled Smart Buy scheme).
export default function TypeToConfirmModal({
  title, message, confirmText, actionLabel, onConfirm, onClose,
}: {
  title: string
  message: string
  confirmText: string
  actionLabel: string
  onConfirm: () => void | Promise<void>
  onClose: () => void
}) {
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const matched = typed.trim() === confirmText

  const run = async () => {
    if (!matched) return
    setBusy(true)
    try { await onConfirm() } finally { setBusy(false) }
  }

  return (
    <Modal title={title} onClose={onClose}
      footer={<>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={run} disabled={!matched || busy} className="btn-primary disabled:opacity-50" style={{ background: '#dc2626' }}>
          {busy ? 'Working...' : actionLabel}
        </button>
      </>}>
      <div className="space-y-3">
        <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/10 p-3">
          <AlertTriangle size={16} className="text-red-500 flex-shrink-0 mt-0.5" />
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>{message}</p>
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">
            Type <span className="font-mono font-semibold" style={{ color: 'var(--text-1)' }}>{confirmText}</span> to confirm
          </label>
          <input
            autoFocus
            value={typed}
            onChange={e => setTyped(e.target.value)}
            className="input"
            placeholder={confirmText}
          />
        </div>
      </div>
    </Modal>
  )
}
