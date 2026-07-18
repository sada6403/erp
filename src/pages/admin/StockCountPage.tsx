import { useState, useEffect } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, ArrowLeft, CheckCircle, XCircle, ClipboardList, Download, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Session = Record<string, unknown>
type CountItem = Record<string, unknown>

function getPerms(u: unknown): Record<string, unknown> {
  const user = u as Record<string, unknown>
  return (user?.role as Record<string, unknown>)?.permissions as Record<string, unknown>
    || user?.permissions as Record<string, unknown> || {}
}

export default function StockCountPage() {
  const [sessions, setSessions]       = useState<Session[]>([])
  const [activeSession, setActiveSession] = useState<(Session & { items: CountItem[] }) | null>(null)
  const [showCreate, setShowCreate]   = useState(false)
  const [loading, setLoading]         = useState(true)
  const [detailLoading, setDetailLoading] = useState(false)
  const [apiMissing, setApiMissing]   = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      if (!window.api.stockCounts) {
        setApiMissing(true)
        setSessions([])
        return
      }
      setApiMissing(false)
      const res = await window.api.stockCounts.list()
      if (res.success) setSessions(res.data as Session[])
      else toast.error(res.error || 'Failed to load stock counts')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load stock counts')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const openSession = async (id: string) => {
    setDetailLoading(true)
    try {
      const res = await window.api.stockCounts.get(id)
      if (res.success) setActiveSession(res.data as Session & { items: CountItem[] })
      else toast.error(res.error || 'Failed to load session')
    } catch (err) {
      toast.error((err as Error).message || 'Failed to load session')
    } finally {
      setDetailLoading(false)
    }
  }

  const handleFinalize = async (id: string) => {
    try {
      const res = await window.api.stockCounts.finalize(id)
      if (res.success) {
        toast.success('Stock count finalized — adjustments applied')
        setActiveSession(null)
        load()
      } else {
        toast.error(res.error || 'Failed to finalize')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to finalize')
    }
  }

  const handleCancel = async (id: string) => {
    try {
      const res = await window.api.stockCounts.cancel(id)
      if (res.success) {
        toast.success('Stock count cancelled')
        setActiveSession(null)
        load()
      } else {
        toast.error(res.error || 'Failed to cancel')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to cancel')
    }
  }

  if (activeSession) {
    return (
      <SessionDetail
        session={activeSession}
        onBack={() => setActiveSession(null)}
        onFinalize={handleFinalize}
        onCancel={handleCancel}
        onItemUpdate={async (itemId, qty) => {
          await window.api.stockCounts.updateItem(activeSession.id as string, itemId, qty)
          const updated = { ...activeSession }
          updated.items = (activeSession.items as CountItem[]).map(i =>
            (i.id as string) === itemId
              ? { ...i, counted_qty: qty, variance: qty - (i.system_qty as number) }
              : i
          )
          setActiveSession(updated as Session & { items: CountItem[] })
        }}
        onRefresh={() => openSession(activeSession.id as string)}
      />
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Stock Count"
        subtitle="Physical inventory counting & reconciliation"
        actions={
          <button onClick={() => setShowCreate(true)} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> New Count
          </button>
        }
      />

      <div className="flex-1 overflow-auto">
        {apiMissing ? (
          <div className="flex flex-col items-center justify-center py-32 text-slate-500">
            <p className="text-sm font-semibold text-slate-300">Stock Count API not loaded</p>
            <p className="text-xs mt-2 max-w-md text-center">
              Please close and restart the Electron app so the rebuilt preload file can expose stock count import/export APIs.
            </p>
          </div>
        ) : detailLoading ? (
          <div className="flex items-center justify-center py-32 text-slate-500">Loading session...</div>
        ) : (
          <table className="w-full">
            <thead className="sticky top-0 bg-surface-900 z-10">
              <tr>
                {['Date', 'Branch / Warehouse', 'Notes', 'Items', 'Variances', 'Status', ''].map(h => (
                  <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} className="text-center py-16 text-slate-500">Loading...</td></tr>
              ) : sessions.length === 0 ? (
                <tr><td colSpan={7} className="text-center py-16 text-slate-500">No stock counts yet</td></tr>
              ) : sessions.map(s => (
                <tr key={s.id as string} className="table-row cursor-pointer" onClick={() => openSession(s.id as string)}>
                  <td className="table-cell text-xs text-slate-400">
                    {new Date(s.created_at as string).toLocaleDateString()}
                  </td>
                  <td className="table-cell">
                    <p className="font-medium text-sm">{s.branch_name as string}</p>
                    <p className="text-xs text-slate-500">{s.warehouse_name as string}</p>
                  </td>
                  <td className="table-cell text-slate-400 text-sm">{(s.notes as string) || '—'}</td>
                  <td className="table-cell text-center font-mono">{s.item_count as number}</td>
                  <td className="table-cell text-center">
                    {(s.variance_count as number) > 0
                      ? <span className="badge-red">{s.variance_count as number}</span>
                      : <span className="badge-green">0</span>}
                  </td>
                  <td className="table-cell">
                    <StatusBadge status={s.status as string} />
                  </td>
                  <td className="table-cell">
                    <button className="btn-ghost btn-sm"><ClipboardList size={14} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showCreate && (
        <CreateModal
          onClose={() => setShowCreate(false)}
          onSave={() => { setShowCreate(false); load() }}
        />
      )}
    </div>
  )
}

function SessionDetail({
  session, onBack, onFinalize, onCancel, onItemUpdate, onRefresh
}: {
  session: Session & { items: CountItem[] }
  onBack: () => void
  onFinalize: (id: string) => void
  onCancel: (id: string) => void
  onItemUpdate: (itemId: string, qty: number) => Promise<void>
  onRefresh: () => Promise<void>
}) {
  const id       = session.id as string
  const status   = session.status as string
  const items    = session.items as CountItem[]
  const editable = status === 'in_progress' || status === 'draft'

  const counted    = items.filter(i => i.counted_qty !== null).length
  const variances  = items.filter(i => i.variance !== null && (i.variance as number) !== 0).length

  const exportCsv = async () => {
    const res = await window.api.stockCounts.exportCsv(id)
    if (res.success) {
      const data = res.data as { exported: number }
      toast.success(`Exported ${data.exported} count rows`)
    } else if (res.error !== 'Cancelled') {
      toast.error(res.error || 'Export failed')
    }
  }

  const importCsv = async () => {
    const res = await window.api.stockCounts.importCsv(id)
    if (res.success) {
      const data = res.data as { imported: number }
      toast.success(`Imported ${data.imported} counted quantities`)
      await onRefresh()
    } else if (res.error !== 'Cancelled') {
      toast.error(res.error || 'Import failed')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Stock Count Session"
        subtitle={`${session.branch_name as string} · ${new Date(session.created_at as string).toLocaleDateString()}`}
        actions={
          <div className="flex items-center gap-2">
            <button onClick={onBack} className="btn-secondary btn-sm gap-1.5">
              <ArrowLeft size={14} /> Back
            </button>
            <button onClick={exportCsv} className="btn-secondary btn-sm gap-1.5">
              <Download size={14} /> Export CSV
            </button>
            {editable && (
              <>
                <button onClick={importCsv} className="btn-secondary btn-sm gap-1.5">
                  <Upload size={14} /> Import CSV
                </button>
                <button
                  onClick={() => { if (confirm('Cancel this stock count?')) onCancel(id) }}
                  className="btn-ghost btn-sm gap-1.5 text-red-400">
                  <XCircle size={14} /> Cancel
                </button>
                <button
                  onClick={() => { if (confirm('Finalize and apply all variances to stock?')) onFinalize(id) }}
                  className="btn-success btn-sm gap-1.5"
                  disabled={counted === 0}>
                  <CheckCircle size={14} /> Finalize
                </button>
              </>
            )}
          </div>
        }
      />

      {/* Summary bar */}
      <div className="flex gap-6 px-6 py-3 border-b border-slate-800 text-sm flex-shrink-0">
        <span className="text-slate-400">Status: <StatusBadge status={status} /></span>
        <span className="text-slate-400">Counted: <strong className="text-white">{counted}</strong> / {items.length}</span>
        {variances > 0 && (
          <span className="text-red-400">Variances: <strong>{variances}</strong></span>
        )}
        {Boolean(session.notes) && <span className="text-slate-500 italic">{String(session.notes)}</span>}
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Product', 'SKU', 'Unit', 'System Qty', 'Counted Qty', 'Variance'].map(h => (
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map(item => (
              <ItemRow
                key={item.id as string}
                item={item}
                editable={editable}
                onUpdate={(qty) => onItemUpdate(item.id as string, qty)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ItemRow({ item, editable, onUpdate }: {
  item: CountItem
  editable: boolean
  onUpdate: (qty: number) => Promise<void>
}) {
  const [val, setVal]     = useState<string>(item.counted_qty !== null ? String(item.counted_qty) : '')
  const [saving, setSaving] = useState(false)

  const variance = item.counted_qty !== null ? (item.counted_qty as number) - (item.system_qty as number) : null

  const commit = async () => {
    const qty = parseInt(val)
    if (isNaN(qty) || qty < 0) return
    setSaving(true)
    await onUpdate(qty)
    setSaving(false)
  }

  return (
    <tr className="table-row">
      <td className="table-cell font-medium text-sm">{item.product_name as string}</td>
      <td className="table-cell font-mono text-xs text-slate-400">{item.sku as string}</td>
      <td className="table-cell text-slate-400 text-xs">{item.unit as string}</td>
      <td className="table-cell font-bold text-slate-300">{item.system_qty as number}</td>
      <td className="table-cell">
        {editable ? (
          <input
            type="number"
            min="0"
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={commit}
            onKeyDown={e => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
            disabled={saving}
            placeholder="Enter count"
            className="input py-1 text-sm w-28"
          />
        ) : (
          <span className="font-bold">{item.counted_qty !== null ? item.counted_qty as number : '—'}</span>
        )}
      </td>
      <td className="table-cell">
        {variance === null ? (
          <span className="text-slate-600">—</span>
        ) : variance === 0 ? (
          <span className="badge-green">0</span>
        ) : (
          <span className={`font-bold ${variance > 0 ? 'text-blue-400' : 'text-red-400'}`}>
            {variance > 0 ? '+' : ''}{variance}
          </span>
        )}
      </td>
    </tr>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    draft: 'badge-yellow',
    in_progress: 'badge-blue',
    completed: 'badge-green',
    cancelled: 'badge-red',
  }
  return <span className={map[status] || 'badge-yellow'}>{status.replace('_', ' ')}</span>
}

function CreateModal({ onClose, onSave }: { onClose: () => void; onSave: () => void }) {
  const { user } = useAuthStore()
  const perms = getPerms(user)
  const isAdmin = Boolean(perms.all)
  const u = user as unknown as Record<string, unknown>
  const myBranchId = String(u?.branch_id ?? '')

  const [notes, setNotes] = useState('')
  const [branches, setBranches] = useState<Record<string, unknown>[]>([])
  const [branchId, setBranchId] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!isAdmin) return
    window.api.admin.branches.list().then((res: { success: boolean; data?: Record<string, unknown>[] }) => {
      if (res.success) {
        setBranches(res.data || [])
        setBranchId(myBranchId || (res.data?.[0]?.id as string) || '')
      } else {
        toast.error('Failed to load branches')
      }
    }).catch((err: Error) => toast.error(err.message || 'Failed to load branches'))
  }, [isAdmin])

  const myBranchName = String((user as unknown as { branch?: { name?: string } })?.branch?.name || 'your branch')

  const save = async () => {
    if (isAdmin && !branchId) { toast.error('Select a branch'); return }
    setSaving(true)
    try {
      const res = await window.api.stockCounts.create({ notes, branch_id: isAdmin ? branchId : undefined })
      if (res.success) {
        toast.success('Stock count session created')
        onSave()
      } else {
        toast.error(res.error || 'Failed to create session')
      }
    } catch (err) {
      toast.error((err as Error).message || 'Failed to create session')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      title="New Stock Count"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-primary">
            {saving ? 'Creating...' : 'Create'}
          </button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-slate-400">
          A new count session will be created with all current products. Enter the physical count for each item, then finalize to apply variances.
        </p>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Branch</label>
          {isAdmin ? (
            <select value={branchId} onChange={e => setBranchId(e.target.value)} className="input">
              {branches.map(b => (
                <option key={b.id as string} value={b.id as string}>{b.name as string}</option>
              ))}
            </select>
          ) : (
            <p className="text-sm text-slate-300">{myBranchName}</p>
          )}
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-400 mb-1">Notes (optional)</label>
          <input
            value={notes}
            onChange={e => setNotes(e.target.value)}
            placeholder="e.g. Monthly stock take, Spot check..."
            className="input"
          />
        </div>
      </div>
    </Modal>
  )
}
