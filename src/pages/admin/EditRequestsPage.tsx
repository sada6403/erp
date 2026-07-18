import { useState, useEffect, useCallback } from 'react'
import { useAuthStore } from '@/store/authStore'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { CheckCircle2, XCircle, Clock, FileEdit, Package } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>

const STATUS_META: Record<string, { label: string; cls: string; icon: JSX.Element }> = {
  pending:  { label: 'Pending',  cls: 'badge-yellow', icon: <Clock size={11} /> },
  approved: { label: 'Approved', cls: 'badge-blue',   icon: <CheckCircle2 size={11} /> },
  rejected: { label: 'Rejected', cls: 'badge-red',     icon: <XCircle size={11} /> },
  consumed: { label: 'Applied',  cls: 'badge-green',   icon: <CheckCircle2 size={11} /> },
  expired:  { label: 'Expired',  cls: 'badge-gray',    icon: <XCircle size={11} /> },
}

function describeChanges(row: Row): string {
  try {
    const changes = JSON.parse(String(row.requested_changes || '{}')) as Record<string, unknown>
    if (row.target_table === 'stocks') return `New quantity: ${changes.new_quantity}`
    if (row.target_table === 'invoices') return `Qty ${changes.new_quantity} @ Rs.${changes.new_unit_price}`
    return JSON.stringify(changes)
  } catch { return '—' }
}

export default function EditRequestsPage() {
  const { user } = useAuthStore()
  const isAdmin = Boolean(((user?.role as unknown as Record<string, unknown>)?.permissions as Record<string, unknown> || {})?.all)

  const [status, setStatus] = useState<'pending' | 'all'>('pending')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<{ row: Row; action: 'approve' | 'reject' } | null>(null)
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.editRequests.list({ status })
      if (res.success) setRows(res.data as Row[])
      else toast.error(res.error || 'Failed to load edit requests')
    } catch {
      toast.error('Failed to load edit requests')
    } finally {
      setLoading(false)
    }
  }, [status])

  useEffect(() => { load() }, [load])

  const submitReview = async () => {
    if (!reviewing) return
    setSaving(true)
    try {
      const res = await window.api.editRequests.review(reviewing.row.id as string, reviewing.action, notes)
      if (res.success) {
        toast.success(reviewing.action === 'approve' ? 'Request approved' : 'Request rejected')
        setReviewing(null)
        setNotes('')
        load()
      } else {
        toast.error(res.error || 'Failed to review request')
      }
    } catch {
      toast.error('Failed to review request')
    } finally {
      setSaving(false)
    }
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center h-full text-sm" style={{ color: 'var(--text-3)' }}>
        Company Admin access required to view edit requests.
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Edit Requests" subtitle="Manager-requested corrections to completed invoices and stock" />

      <div className="flex gap-1 px-6 py-3 flex-shrink-0">
        <button onClick={() => setStatus('pending')} className={status === 'pending' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>Pending</button>
        <button onClick={() => setStatus('all')} className={status === 'all' ? 'btn-primary btn-sm' : 'btn-secondary btn-sm'}>All</button>
      </div>

      <div className="flex-1 overflow-auto px-6 pb-6">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Type', 'Record', 'Requested By', 'Branch', 'Reason', 'Changes', 'Status', 'Requested', ''].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">No edit requests{status === 'pending' ? ' pending' : ''}</td></tr>
            ) : rows.map(r => {
              const meta = STATUS_META[String(r.status)] || { label: String(r.status), cls: 'badge-gray', icon: null }
              return (
                <tr key={r.id as string} className="table-row">
                  <td className="table-cell">
                    <span className="inline-flex items-center gap-1 text-xs">
                      {r.target_table === 'invoices' ? <FileEdit size={12} /> : <Package size={12} />}
                      {r.target_table === 'invoices' ? 'Invoice' : 'Stock'}
                    </span>
                  </td>
                  <td className="table-cell font-mono text-xs">{String(r.target_record_id).slice(0, 24)}</td>
                  <td className="table-cell">{(r.requester_name as string) || '—'}</td>
                  <td className="table-cell text-slate-400">{(r.branch_name as string) || '—'}</td>
                  <td className="table-cell text-slate-400 max-w-[16rem] truncate" title={r.reason as string}>{r.reason as string}</td>
                  <td className="table-cell text-slate-400 text-xs">{describeChanges(r)}</td>
                  <td className="table-cell">
                    <span className={`inline-flex items-center gap-1 ${meta.cls}`}>{meta.icon} {meta.label}</span>
                  </td>
                  <td className="table-cell text-xs text-slate-500">{r.created_at ? new Date(String(r.created_at)).toLocaleString() : '—'}</td>
                  <td className="table-cell">
                    {r.status === 'pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => setReviewing({ row: r, action: 'approve' })} className="btn-ghost btn-sm p-1.5 text-green-400" title="Approve"><CheckCircle2 size={14} /></button>
                        <button onClick={() => setReviewing({ row: r, action: 'reject' })} className="btn-ghost btn-sm p-1.5 text-red-400" title="Reject"><XCircle size={14} /></button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {reviewing && (
        <Modal title={reviewing.action === 'approve' ? 'Approve Edit Request' : 'Reject Edit Request'} onClose={() => setReviewing(null)}
          footer={<>
            <button onClick={() => setReviewing(null)} className="btn-secondary">Cancel</button>
            <button onClick={submitReview} disabled={saving}
              className={reviewing.action === 'approve' ? 'btn-primary' : 'btn-danger'}>
              {saving ? 'Saving...' : reviewing.action === 'approve' ? 'Approve' : 'Reject'}
            </button>
          </>}>
          <div className="space-y-3">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>
              <strong>{(reviewing.row.requester_name as string) || 'A user'}</strong> requested to edit a{' '}
              {reviewing.row.target_table === 'invoices' ? 'completed invoice' : 'stock record'}: "{reviewing.row.reason as string}"
            </p>
            <p className="text-xs text-slate-500">Requested change: {describeChanges(reviewing.row)}</p>
            {reviewing.action === 'approve' && (
              <p className="text-xs text-amber-400">Once approved, they'll have 48 hours to make this one edit before it expires.</p>
            )}
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Notes {reviewing.action === 'reject' ? '(reason for rejection)' : '(optional)'}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} className="input h-20 resize-none" />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}
