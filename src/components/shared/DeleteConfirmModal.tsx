import { AlertTriangle } from 'lucide-react'
import Modal from './Modal'

// Generic delete-confirmation dialog reused by every list page's Delete
// action (Suppliers, Categories, Customers, Agents, Branches, Expenses,
// ...) so the confirmation copy, busy-state handling, and button layout
// stay identical everywhere instead of being re-implemented per page.
export default function DeleteConfirmModal({
  title = 'Delete Confirmation',
  itemLabel,
  message,
  busy,
  onCancel,
  onConfirm,
}: {
  title?: string
  itemLabel?: string
  message?: string
  busy: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  return (
    <Modal
      title={title}
      onClose={() => { if (!busy) onCancel() }}
      size="sm"
      footer={<>
        <button onClick={onCancel} disabled={busy} className="btn-secondary">Cancel</button>
        <button onClick={onConfirm} disabled={busy} className="btn-danger">
          {busy ? 'Deleting...' : 'Delete'}
        </button>
      </>}
    >
      <div className="flex gap-3">
        <AlertTriangle size={20} className="text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium" style={{ color: 'var(--text-1)' }}>
            Are you sure you want to delete{itemLabel ? ` "${itemLabel}"` : ' this record'}?
          </p>
          <p className="text-sm mt-1.5" style={{ color: 'var(--text-3)' }}>
            {message || 'This action will remove the record from this device and the cloud database.'}
          </p>
        </div>
      </div>
    </Modal>
  )
}
