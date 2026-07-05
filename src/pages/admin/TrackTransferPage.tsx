import { useState, useEffect, useCallback, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import { useAuthStore } from '@/store/authStore'
import {
  Search, Package, ArrowRightLeft, Truck, CheckCircle, Clock, XCircle,
  Printer, ShieldCheck, MapPin, User, Check, X, RefreshCw, AlertTriangle,
} from 'lucide-react'
import toast from 'react-hot-toast'

interface Transfer {
  id: string; transfer_number: string; status: string; quantity: number
  product_name: string; sku: string
  from_branch_id: string; to_branch_id: string
  from_branch_name: string; to_branch_name: string
  initiated_by: string; initiated_by_name: string; initiated_at: string
  approved_by_name: string | null; received_by_name: string | null
  driver_name: string | null; driver_phone: string | null; vehicle_number: string | null
  dispatch_at: string | null; expected_delivery_at: string | null; actual_delivery_at: string | null
  received_quantity: number; damaged_quantity: number; missing_quantity: number
  reject_reason: string | null; discrepancy_note: string | null; notes: string | null
}
interface HistoryRow { id?: string; status: string; notes: string | null; created_at: string; actor_name: string | null }

const PIPELINE = [
  { key: 'pending_approval', label: 'Requested',  icon: Clock },
  { key: 'approved',         label: 'Approved',   icon: ShieldCheck },
  { key: 'dispatched',       label: 'Dispatched', icon: Truck },
  { key: 'received',         label: 'Received',    icon: CheckCircle },
]
function stageIndex(status: string): number {
  if (['pending_approval', 'pending'].includes(status)) return 0
  if (['approved', 'ready_for_dispatch'].includes(status)) return 1
  if (['dispatched', 'in_transit'].includes(status)) return 2
  if (['received', 'partially_received', 'discrepancy'].includes(status)) return 3
  return -1
}
const fmt = (s?: string | null) => s ? new Date(s).toLocaleString() : '—'

export default function TrackTransferPage() {
  const { user } = useAuthStore()
  const u = user as unknown as Record<string, unknown>
  const perms = ((u?.role as Record<string, unknown>)?.permissions ?? u?.permissions ?? {}) as Record<string, unknown>
  const isAdmin = Boolean(perms.all)
  const userId = String(u?.id ?? '')
  const myBranchId = String(u?.branch_id ?? '')

  const [query, setQuery]       = useState('')
  const [transfer, setTransfer] = useState<Transfer | null>(null)
  const [history, setHistory]   = useState<HistoryRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [busy, setBusy]         = useState(false)
  const [dispatchOpen, setDispatchOpen] = useState(false)
  const [receiveOpen, setReceiveOpen]   = useState(false)
  const [driver, setDriver] = useState({ driver_name: '', driver_phone: '', vehicle_number: '', expected_delivery_at: '' })
  const [recv, setRecv]     = useState({ received_quantity: '', damaged_quantity: '0' })
  const inputRef = useRef<HTMLInputElement>(null)

  const track = useCallback(async (q: string, silent = false) => {
    const key = q.trim()
    if (!key) return
    if (!silent) { setLoading(true); setError('') }
    const res = await window.api.stocks.trackTransfer(key) as { success: boolean; data?: { transfer: Transfer; history: HistoryRow[] }; error?: string }
    if (res.success && res.data) {
      setTransfer(res.data.transfer)
      setHistory(res.data.history || [])
      setError('')
    } else if (!silent) {
      setTransfer(null); setHistory([]); setError(res.error || 'Not found')
    }
    setLoading(false)
  }, [])

  // Live auto-refresh every 5s while a transfer is on screen and not yet finished.
  // Paused while a dispatch/receive form is open so it doesn't disrupt input.
  useEffect(() => {
    if (!transfer || dispatchOpen || receiveOpen) return
    const done = ['received', 'rejected', 'cancelled', 'discrepancy'].includes(transfer.status)
    if (done) return
    const timer = window.setInterval(() => track(transfer.transfer_number, true), 5000)
    return () => window.clearInterval(timer)
  }, [transfer, track, dispatchOpen, receiveOpen])

  useEffect(() => { inputRef.current?.focus() }, [])

  const act = async (status: string, payload: Record<string, unknown> = {}, okMsg = 'Updated') => {
    if (!transfer) return
    setBusy(true)
    const res = await window.api.stocks.updateTransfer(transfer.id, status, payload) as { success: boolean; error?: string }
    setBusy(false)
    if (res.success) {
      toast.success(okMsg)
      setDispatchOpen(false); setReceiveOpen(false)
      track(transfer.transfer_number)
    } else toast.error(res.error || 'Failed')
  }

  const onReject = () => {
    const reason = window.prompt('Reason for rejecting this transfer?')
    if (reason && reason.trim()) act('rejected', { reject_reason: reason.trim() }, 'Transfer rejected')
  }
  const onCancel = () => {
    if (window.confirm('Cancel this transfer? Stock (if already deducted) will be returned to source.')) act('cancelled', {}, 'Transfer cancelled')
  }
  const doPrint = async () => {
    if (!transfer) return
    const r = await window.api.printer.printTransfer(transfer as unknown as Record<string, unknown>) as { success: boolean; error?: string }
    if (r?.success) toast.success('Transfer note sent to printer / save as PDF')
    else toast.error(r?.error || 'Print failed')
  }

  const t = transfer
  const stage = t ? stageIndex(t.status) : -1
  const isDone = t ? ['received', 'rejected', 'cancelled', 'discrepancy'].includes(t.status) : false
  const canApprove  = t && ['pending_approval', 'pending'].includes(t.status) && t.initiated_by !== userId && (isAdmin || t.from_branch_id === myBranchId)
  const canReject   = t && ['pending_approval', 'pending'].includes(t.status) && (isAdmin || t.from_branch_id === myBranchId)
  const canDispatch = t && ['approved', 'ready_for_dispatch'].includes(t.status) && (isAdmin || t.from_branch_id === myBranchId)
  const canReceive  = t && ['approved', 'ready_for_dispatch', 'dispatched', 'in_transit'].includes(t.status) && (isAdmin || t.to_branch_id === myBranchId)
  const canCancel   = t && !isDone && (isAdmin || t.from_branch_id === myBranchId)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Track Transfer" subtitle="Enter a tracking number or scan the note to trace goods live" />

      <div className="flex-1 overflow-auto px-6 py-4">
        {/* Search */}
        <form onSubmit={e => { e.preventDefault(); track(query) }} className="max-w-2xl mx-auto">
          <div className="relative">
            <Search size={20} className="absolute left-4 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input
              ref={inputRef}
              className="input w-full pl-12 pr-28 h-14 text-lg font-mono"
              placeholder="TRF-XXXXXXXX  (type or scan)"
              value={query}
              onChange={e => setQuery(e.target.value)}
            />
            <button type="submit" disabled={loading}
              className="btn-primary absolute right-2 top-1/2 -translate-y-1/2 px-5">
              {loading ? '…' : 'Track'}
            </button>
          </div>
          {error && <p className="text-center text-sm mt-3 text-red-500 flex items-center justify-center gap-1.5"><AlertTriangle size={14} /> {error}</p>}
        </form>

        {t && (
          <div className="max-w-4xl mx-auto mt-8 space-y-6">
            {/* Header + status */}
            <div className="card">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-bold text-brand-500">{t.transfer_number}</span>
                    <StatusChip status={t.status} />
                    <button onClick={() => track(t.transfer_number)} title="Refresh" className="btn-ghost btn-sm p-1"><RefreshCw size={13} /></button>
                  </div>
                  <p className="text-lg font-bold mt-1" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
                  <p className="text-xs font-mono" style={{ color: 'var(--text-3)' }}>{t.sku} · × {t.quantity} units</p>
                </div>
                <button onClick={doPrint} className="btn-secondary btn-sm gap-1.5"><Printer size={14} /> Print / Download</button>
              </div>

              {/* Pipeline */}
              <div className="flex items-center mt-6">
                {PIPELINE.map((step, i) => {
                  const Icon = step.icon
                  const active = i <= stage && stage >= 0
                  const current = i === stage
                  return (
                    <div key={step.key} className="flex-1 flex items-center">
                      <div className="flex flex-col items-center flex-shrink-0">
                        <div className="w-9 h-9 rounded-full flex items-center justify-center border-2 transition-colors"
                          style={{
                            background: active ? 'var(--brand-primary)' : 'var(--bg-soft)',
                            borderColor: active ? 'var(--brand-primary)' : 'var(--border-2)',
                            color: active ? '#fff' : 'var(--text-3)',
                            boxShadow: current ? '0 0 0 4px var(--ring)' : undefined,
                          }}>
                          <Icon size={16} />
                        </div>
                        <span className="text-[10px] mt-1.5 font-medium" style={{ color: active ? 'var(--text-1)' : 'var(--text-3)' }}>{step.label}</span>
                      </div>
                      {i < PIPELINE.length - 1 && (
                        <div className="flex-1 h-0.5 mx-1 -mt-4" style={{ background: i < stage ? 'var(--brand-primary)' : 'var(--border-2)' }} />
                      )}
                    </div>
                  )
                })}
              </div>
              {['rejected', 'cancelled', 'discrepancy'].includes(t.status) && (
                <p className="text-center text-xs mt-3 text-red-500">{t.status === 'discrepancy' ? '⚠ Discrepancy' : `✗ ${t.status}`}{t.reject_reason ? ` — ${t.reject_reason}` : ''}{t.discrepancy_note ? ` — ${t.discrepancy_note}` : ''}</p>
              )}
            </div>

            {/* Route + details */}
            <div className="grid md:grid-cols-2 gap-6">
              <div className="card">
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>Route &amp; Location</h4>
                <div className="flex items-center gap-2 text-sm font-medium" style={{ color: 'var(--text-1)' }}>
                  <MapPin size={14} className="text-brand-500" /> {t.from_branch_name}
                  <ArrowRightLeft size={13} style={{ color: 'var(--text-3)' }} />
                  <MapPin size={14} className="text-green-500" /> {t.to_branch_name}
                </div>
                <p className="text-xs mt-3" style={{ color: 'var(--text-2)' }}>
                  <strong>Now:</strong> {holderText(t)}
                </p>
              </div>
              <div className="card space-y-1.5 text-sm">
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Details</h4>
                <Row label="Requested by" value={`${t.initiated_by_name || '—'} · ${fmt(t.initiated_at)}`} />
                <Row label="Approved by"  value={t.approved_by_name || '—'} />
                <Row label="Driver / Vehicle" value={t.driver_name ? `${t.driver_name} ${t.vehicle_number ? '· ' + t.vehicle_number : ''}` : '—'} />
                <Row label="Dispatched"   value={fmt(t.dispatch_at)} />
                <Row label="Received by"  value={t.received_by_name || '—'} />
                {t.received_quantity > 0 && <Row label="Received qty" value={`${t.received_quantity}${t.damaged_quantity ? ` · ${t.damaged_quantity} damaged` : ''}${t.missing_quantity ? ` · ${t.missing_quantity} missing` : ''}`} />}
              </div>
            </div>

            {/* Actions — control the transfer from here */}
            {!isDone && (
              <div className="card">
                <h4 className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>Actions</h4>
                <div className="flex flex-wrap gap-2">
                  {canApprove && <button disabled={busy} onClick={() => act('approved', {}, 'Approved — stock now in transit')} className="btn-success btn-sm gap-1.5"><Check size={14} /> Approve</button>}
                  {canReject  && <button disabled={busy} onClick={onReject} className="btn-danger btn-sm gap-1.5"><X size={14} /> Reject</button>}
                  {canDispatch && <button disabled={busy} onClick={() => { setDispatchOpen(o => !o); setReceiveOpen(false) }} className="btn-primary btn-sm gap-1.5"><Truck size={14} /> Dispatch</button>}
                  {canReceive && <button disabled={busy} onClick={() => { setReceiveOpen(o => !o); setDispatchOpen(false); setRecv({ received_quantity: String(t.quantity), damaged_quantity: '0' }) }} className="btn-sm gap-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg px-3"><CheckCircle size={14} /> Receive</button>}
                  {canCancel && <button disabled={busy} onClick={onCancel} className="btn-ghost btn-sm gap-1.5">Cancel</button>}
                </div>

                {/* Dispatch form */}
                {dispatchOpen && (
                  <div className="mt-4 pt-4 border-t grid sm:grid-cols-2 gap-3" style={{ borderColor: 'var(--border)' }}>
                    <Field label="Driver Name *"><input className="input w-full" value={driver.driver_name} onChange={e => setDriver({ ...driver, driver_name: e.target.value })} placeholder="Full name" /></Field>
                    <Field label="Driver Phone"><input className="input w-full" value={driver.driver_phone} onChange={e => setDriver({ ...driver, driver_phone: e.target.value })} placeholder="07X XXX XXXX" /></Field>
                    <Field label="Vehicle Number"><input className="input w-full" value={driver.vehicle_number} onChange={e => setDriver({ ...driver, vehicle_number: e.target.value })} placeholder="NP-1234" /></Field>
                    <Field label="Expected Delivery"><input type="datetime-local" className="input w-full" value={driver.expected_delivery_at} onChange={e => setDriver({ ...driver, expected_delivery_at: e.target.value })} /></Field>
                    <div className="sm:col-span-2">
                      <button disabled={busy} onClick={() => driver.driver_name.trim() ? act('dispatched', driver, 'Dispatched — in transit') : toast.error('Driver name required')} className="btn-primary btn-sm gap-1.5"><Truck size={14} /> Confirm Dispatch</button>
                    </div>
                  </div>
                )}

                {/* Receive form */}
                {receiveOpen && (
                  <div className="mt-4 pt-4 border-t grid sm:grid-cols-2 gap-3" style={{ borderColor: 'var(--border)' }}>
                    <Field label={`Received Qty (of ${t.quantity})`}><input type="number" className="input w-full" value={recv.received_quantity} onChange={e => setRecv({ ...recv, received_quantity: e.target.value })} /></Field>
                    <Field label="Damaged Qty"><input type="number" className="input w-full" value={recv.damaged_quantity} onChange={e => setRecv({ ...recv, damaged_quantity: e.target.value })} /></Field>
                    <div className="sm:col-span-2">
                      <button disabled={busy} onClick={() => {
                        const r = Number(recv.received_quantity || 0), d = Number(recv.damaged_quantity || 0)
                        if (r + d > t.quantity) { toast.error('Received + damaged exceeds sent qty'); return }
                        const status = r >= t.quantity ? 'received' : 'partially_received'
                        act(status, { received_quantity: r, damaged_quantity: d }, 'Received & stock credited')
                      }} className="btn-sm gap-1.5 bg-teal-600 hover:bg-teal-500 text-white rounded-lg px-3"><CheckCircle size={14} /> Confirm Receipt</button>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Handover timeline */}
            <div className="card">
              <h4 className="text-xs font-semibold uppercase tracking-wide mb-4" style={{ color: 'var(--text-3)' }}>Handover Timeline (live)</h4>
              {history.length === 0 ? <p className="text-sm" style={{ color: 'var(--text-3)' }}>No history yet.</p> : (
                <div>
                  {history.map((h, i) => (
                    <div key={h.id || i} className="flex gap-3">
                      <div className="flex flex-col items-center">
                        <div className="w-2.5 h-2.5 rounded-full mt-1.5" style={{ background: i === history.length - 1 ? 'var(--brand-primary)' : 'var(--border-2)' }} />
                        {i < history.length - 1 && <div className="w-px flex-1 my-1" style={{ background: 'var(--border)' }} />}
                      </div>
                      <div className="pb-4">
                        <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-1)' }}>{h.status}</p>
                        <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                          <Clock size={10} className="inline mr-1" />{fmt(h.created_at)}
                          {h.actor_name ? <> · by <strong style={{ color: 'var(--text-2)' }}>{h.actor_name}</strong></> : null}
                        </p>
                        {h.notes ? <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{h.notes}</p> : null}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {!t && !loading && !error && (
          <div className="flex flex-col items-center justify-center mt-24" style={{ color: 'var(--text-3)' }}>
            <Package size={48} className="mb-3 opacity-30" />
            <p className="font-medium" style={{ color: 'var(--text-2)' }}>Enter a tracking number to trace a transfer</p>
            <p className="text-xs mt-1">Scan the QR / barcode on the transfer note, or type TRF-XXXXXXXX</p>
          </div>
        )}
      </div>
    </div>
  )
}

function holderText(t: Transfer): string {
  switch (t.status) {
    case 'pending_approval': case 'pending': return `Still at ${t.from_branch_name} — awaiting approval`
    case 'approved': case 'ready_for_dispatch': return `Reserved at ${t.from_branch_name} — ready to dispatch`
    case 'dispatched': case 'in_transit': return `In transit${t.driver_name ? ` with ${t.driver_name}` : ''} → ${t.to_branch_name}`
    case 'received': return `Delivered & received at ${t.to_branch_name} by ${t.received_by_name || '—'}`
    case 'partially_received': return `Partially received at ${t.to_branch_name}`
    case 'rejected': return `Rejected — stayed at ${t.from_branch_name}`
    case 'cancelled': return `Cancelled — returned to ${t.from_branch_name}`
    default: return t.status
  }
}
function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex justify-between gap-3"><span style={{ color: 'var(--text-3)' }}>{label}</span><span className="font-medium text-right" style={{ color: 'var(--text-1)' }}>{value}</span></div>
}
function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-2)' }}>{label}</label>{children}</div>
}
function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending_approval: 'badge-yellow', pending: 'badge-yellow', approved: 'badge-blue',
    ready_for_dispatch: 'badge-purple', dispatched: 'badge-orange', in_transit: 'badge-orange',
    received: 'badge-green', partially_received: 'badge-yellow', rejected: 'badge-red',
    cancelled: 'badge-gray', discrepancy: 'badge-red',
  }
  return <span className={map[status] || 'badge-gray'}>{status.replace(/_/g, ' ')}</span>
}
