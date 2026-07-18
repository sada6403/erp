import { useState, useEffect, useCallback, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { useAuthStore } from '@/store/authStore'
import {
  ArrowRightLeft, Check, X, Truck, RefreshCw,
  CheckCircle, XCircle, ChevronDown, ChevronUp, AlertTriangle,
  Printer, Search, Clock, FileText
} from 'lucide-react'
import toast from 'react-hot-toast'

type TransferStatus =
  | 'pending_approval' | 'approved' | 'ready_for_dispatch'
  | 'dispatched' | 'in_transit' | 'received'
  | 'partially_received' | 'discrepancy' | 'under_admin_review' | 'corrected' | 'rejected' | 'cancelled'

interface Transfer {
  id: string
  transfer_number: string
  product_name: string
  sku: string
  barcode?: string | null
  unit?: string | null
  product_id: string
  from_branch_id: string
  to_branch_id: string
  from_branch_name: string
  to_branch_name: string
  quantity: number
  received_quantity: number
  missing_quantity: number
  damaged_quantity: number
  status: TransferStatus
  initiated_by: string
  initiated_by_name: string
  initiated_at: string
  approved_by: string | null
  approved_by_name: string | null
  released_by: string | null
  driver_name: string | null
  driver_phone: string | null
  vehicle_number: string | null
  issuing_officer_name: string | null
  package_count: number
  serial_batch_no: string | null
  item_description: string | null
  dispatch_at: string | null
  expected_delivery_at: string | null
  actual_delivery_at: string | null
  received_by: string | null
  received_by_name: string | null
  received_designation: string | null
  received_remarks: string | null
  notes: string | null
  reject_reason: string | null
  discrepancy_note: string | null
  mismatch_reason_category: string | null
  mismatch_details: string | null
  print_count: number
  last_printed_at: string | null
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pending_approval:   { label: 'Pending Approval', cls: 'bg-yellow-500/20 text-yellow-600' },
  approved:           { label: 'Approved',          cls: 'bg-blue-500/20 text-blue-600'   },
  ready_for_dispatch: { label: 'Ready to Dispatch', cls: 'bg-purple-500/20 text-purple-600' },
  dispatched:         { label: 'Dispatched',         cls: 'bg-orange-500/20 text-orange-600' },
  in_transit:         { label: 'In Transit',          cls: 'bg-orange-500/20 text-orange-600' },
  received:           { label: 'Received',            cls: 'bg-green-500/20 text-green-600'  },
  partially_received: { label: 'Partial',             cls: 'bg-teal-500/20 text-teal-600'   },
  discrepancy:        { label: 'Discrepancy',         cls: 'bg-red-500/20 text-red-600'    },
  under_admin_review: { label: 'Admin Review',        cls: 'bg-red-500/20 text-red-600'    },
  corrected:          { label: 'Corrected',           cls: 'bg-indigo-500/20 text-indigo-600' },
  rejected:           { label: 'Rejected',            cls: 'bg-red-500/20 text-red-600'    },
  cancelled:          { label: 'Cancelled',           cls: 'bg-gray-500/20 text-gray-500'  },
}

const DONE = ['received', 'partially_received', 'discrepancy', 'under_admin_review', 'rejected', 'cancelled']

function StatusBadge({ status }: { status: string }) {
  const c = STATUS_CFG[status] ?? { label: status, cls: 'bg-gray-500/20 text-gray-500' }
  return <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${c.cls}`}>{c.label}</span>
}

function fmt(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function Detail({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <p className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</p>
      <p className={`text-sm font-medium mt-0.5 ${color ?? ''}`} style={!color ? { color: 'var(--text-1)' } : undefined}>
        {value}
      </p>
    </div>
  )
}

// ─── Approve Modal ────────────────────────────────────────────────────────────
function ApproveModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const submit = async () => {
    setLoading(true)
    try {
      const res = await window.api.stocks.updateTransfer(t.id, 'approved', {})
      if (res.success) { toast.success('Transfer approved. Dispatch will move stock to in-transit.'); onDone() }
      else toast.error(res.error || 'Failed')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to approve transfer')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Approve Transfer" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={submit} disabled={loading}>
          <Check size={14} /> Approve
        </button></>}>
      <div className="p-4 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
        <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
          {t.from_branch_name} → {t.to_branch_name} · <strong>{t.quantity}</strong> units
        </p>
        <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>Requested by {t.initiated_by_name}</p>
      </div>
    </Modal>
  )
}

// ─── Reject Modal ─────────────────────────────────────────────────────────────
function RejectModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [reason, setReason] = useState('')
  const submit = async () => {
    if (!reason.trim()) { toast.error('Rejection reason required'); return }
    setLoading(true)
    try {
      const res = await window.api.stocks.updateTransfer(t.id, 'rejected', { reject_reason: reason })
      if (res.success) { toast.success('Transfer rejected'); onDone() }
      else toast.error(res.error || 'Failed')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to reject transfer')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Reject Transfer" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold flex items-center gap-1.5 disabled:opacity-50"
          onClick={submit} disabled={loading}><X size={14} /> Reject</button></>}>
      <div className="space-y-4">
        <div className="p-4 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
          <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>
            {t.from_branch_name} → {t.to_branch_name} · {t.quantity} units
          </p>
        </div>
        <div>
          <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>
            Rejection Reason <span className="text-red-500">*</span>
          </label>
          <textarea className="input mt-1 h-24 resize-none w-full" value={reason}
            onChange={e => setReason(e.target.value)} placeholder="Why is this being rejected?" />
        </div>
      </div>
    </Modal>
  )
}

// ─── Dispatch Modal ───────────────────────────────────────────────────────────
function DispatchModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ driver_name: '', driver_phone: '', vehicle_number: '', expected_delivery_at: '', issuing_officer_name: '' })
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))
  const submit = async () => {
    if (!form.driver_name.trim()) { toast.error('Driver name required'); return }
    setLoading(true)
    try {
      const res = await window.api.stocks.updateTransfer(t.id, 'dispatched', form)
      if (res.success) { toast.success('Dispatched - stock will update when receiving branch confirms'); onDone() }
      else toast.error(res.error || 'Failed')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to dispatch transfer')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Dispatch Transfer" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={submit} disabled={loading}>
          <Truck size={14} /> Mark Dispatched
        </button></>}>
      <div className="space-y-4">
        <div className="p-3 rounded-lg border-l-4 border-orange-400" style={{ background: 'var(--bg-soft)' }}>
          <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            <strong>{t.from_branch_name}</strong> → {t.to_branch_name} · {t.quantity} units
          </p>
          <p className="text-xs mt-1 text-orange-500">Stock will be deducted only after the receiving branch confirms receipt.</p>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Driver Name <span className="text-red-500">*</span></label>
            <input className="input mt-1 w-full" value={form.driver_name} onChange={f('driver_name')} placeholder="Full name" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Driver Phone</label>
            <input className="input mt-1 w-full" value={form.driver_phone} onChange={f('driver_phone')} placeholder="07X XXX XXXX" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Vehicle Number</label>
            <input className="input mt-1 w-full" value={form.vehicle_number} onChange={f('vehicle_number')} placeholder="WP AB 1234" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Expected Delivery</label>
            <input className="input mt-1 w-full" type="datetime-local" value={form.expected_delivery_at} onChange={f('expected_delivery_at')} />
          </div>
          <div className="col-span-2">
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Issuing Officer Name</label>
            <input className="input mt-1 w-full" value={form.issuing_officer_name} onChange={f('issuing_officer_name')} placeholder="Officer issuing the delivery note" />
          </div>
        </div>
      </div>
    </Modal>
  )
}

// ─── Receive Modal ────────────────────────────────────────────────────────────
function ReceiveModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [loading, setLoading] = useState(false)
  const [received, setReceived] = useState(t.quantity)
  const [damaged, setDamaged] = useState(0)
  const [receivedByName, setReceivedByName] = useState('')
  const [designation, setDesignation] = useState('')
  const [notes, setNotes] = useState('')
  const missing = Math.max(0, t.quantity - received - damaged)

  const submit = async () => {
    if (received + damaged > t.quantity) { toast.error('Received + Damaged cannot exceed dispatched quantity'); return }
    if (received < 0 || damaged < 0) { toast.error('Quantities cannot be negative'); return }
    if (!receivedByName.trim()) { toast.error('Received by name required'); return }
    setLoading(true)
    const status = received >= t.quantity ? 'received' : 'partially_received'
    try {
      const res = await window.api.stocks.updateTransfer(t.id, status, {
        received_quantity: received,
        damaged_quantity: damaged,
        received_by_name: receivedByName,
        received_designation: designation,
        received_remarks: notes,
        notes,
      })
      if (res.success) { toast.success('Stock received at destination branch'); onDone() }
      else toast.error(res.error || 'Failed')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to record receipt')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Modal title="Receive Stock" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={submit} disabled={loading}>
          <CheckCircle size={14} /> Confirm Receipt
        </button></>}>
      <div className="space-y-4">
        <div className="p-3 rounded-lg border-l-4 border-green-400" style={{ background: 'var(--bg-soft)' }}>
          <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {t.from_branch_name} → <strong>{t.to_branch_name}</strong>
          </p>
          {t.driver_name && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-2)' }}>
              Driver: {t.driver_name}{t.vehicle_number ? ` · ${t.vehicle_number}` : ''}
            </p>
          )}
        </div>
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Dispatched</label>
            <div className="input mt-1 text-center font-bold" style={{ background: 'var(--bg-soft)', color: 'var(--text-3)' }}>
              {t.quantity}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Received <span className="text-red-500">*</span></label>
            <input className="input mt-1 w-full text-center" type="number" min={0} max={t.quantity}
              value={received} onChange={e => setReceived(Math.max(0, Number(e.target.value)))} />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Damaged</label>
            <input className="input mt-1 w-full text-center" type="number" min={0}
              max={t.quantity - received} value={damaged}
              onChange={e => setDamaged(Math.max(0, Number(e.target.value)))} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Received By <span className="text-red-500">*</span></label>
            <input className="input mt-1 w-full" value={receivedByName} onChange={e => setReceivedByName(e.target.value)} placeholder="Receiver name" />
          </div>
          <div>
            <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Designation</label>
            <input className="input mt-1 w-full" value={designation} onChange={e => setDesignation(e.target.value)} placeholder="Store keeper / Manager" />
          </div>
        </div>
        {missing > 0 && (
          <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-600 text-xs flex items-center gap-2">
            <AlertTriangle size={12} /> {missing} unit{missing > 1 ? 's' : ''} missing — will be recorded
          </div>
        )}
        <div>
          <label className="text-xs font-medium" style={{ color: 'var(--text-2)' }}>Notes</label>
          <textarea className="input mt-1 h-16 resize-none w-full" value={notes}
            onChange={e => setNotes(e.target.value)} placeholder="Delivery notes..." />
        </div>
      </div>
    </Modal>
  )
}

// ─── Transfer Card ────────────────────────────────────────────────────────────
function deliveryNoteHtml(t: Transfer) {
  return `<!doctype html><html><head><title>Delivery Note ${t.transfer_number}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    body { font-family: Arial, sans-serif; color:#111827; font-size:12px; }
    .top { display:flex; justify-content:space-between; gap:16px; border-bottom:2px solid #111827; padding-bottom:10px; }
    h1 { margin:0; font-size:20px; letter-spacing:.04em; }
    h2 { margin:2px 0 0; font-size:13px; font-weight:600; color:#475569; }
    .meta { display:grid; grid-template-columns:1fr 1fr; gap:6px 24px; margin:14px 0; }
    .box { border:1px solid #111827; padding:8px; min-height:34px; }
    .label { font-size:10px; text-transform:uppercase; color:#64748b; display:block; margin-bottom:2px; }
    table { width:100%; border-collapse:collapse; margin-top:10px; }
    th,td { border:1px solid #111827; padding:6px; vertical-align:top; }
    th { background:#f1f5f9; font-size:11px; text-transform:uppercase; }
    .num { text-align:right; }
    .remarks { min-height:52px; }
    .sign { display:grid; grid-template-columns:1fr 1fr 1fr; gap:18px; margin-top:34px; }
    .line { border-top:1px dotted #111827; padding-top:6px; min-height:44px; }
    .footer { margin-top:18px; font-size:10px; color:#64748b; display:flex; justify-content:space-between; }
  </style></head><body>
    <div class="top"><div><h1>DELIVERY NOTE / ISSUE NOTE</h1><h2>Branch Stock Transfer</h2></div><div style="text-align:right"><strong>${t.transfer_number}</strong><br/>${new Date().toLocaleString()}</div></div>
    <div class="meta">
      <div class="box"><span class="label">Issuing Store Name</span>${t.from_branch_name || ''}</div>
      <div class="box"><span class="label">Receiving Store Name</span>${t.to_branch_name || ''}</div>
      <div class="box"><span class="label">Driver Name / Phone</span>${t.driver_name || ''}${t.driver_phone ? ` / ${t.driver_phone}` : ''}</div>
      <div class="box"><span class="label">Vehicle No</span>${t.vehicle_number || ''}</div>
      <div class="box"><span class="label">Issuing Officer</span>${t.issuing_officer_name || t.initiated_by_name || ''}</div>
      <div class="box"><span class="label">Dispatch Date</span>${fmt(t.dispatch_at) || fmt(t.initiated_at)}</div>
    </div>
    <table>
      <thead><tr><th>No</th><th>Product / SKU</th><th>Description</th><th>Qty</th><th>Unit</th><th>No. of Packages</th><th>Serial / Batch</th></tr></thead>
      <tbody><tr><td>1</td><td>${t.product_name || ''}<br/><small>${t.sku || ''}${t.barcode ? ` / ${t.barcode}` : ''}</small></td><td>${t.item_description || ''}</td><td class="num">${Number(t.quantity || 0)}</td><td>${t.unit || 'Nos'}</td><td class="num">${Number(t.package_count || 0) || ''}</td><td>${t.serial_batch_no || ''}</td></tr></tbody>
      <tfoot><tr><th colspan="3" class="num">Total Quantity</th><th class="num">${Number(t.quantity || 0)}</th><th colspan="3"></th></tr></tfoot>
    </table>
    <div class="box remarks" style="margin-top:12px"><span class="label">Remarks</span>${t.notes || ''}</div>
    <div class="sign">
      <div class="line"><strong>Name & Signature of Issuing Officer</strong><br/>Designation:<br/>Date:</div>
      <div class="line"><strong>Name & Signature of Driver / Officer Taking Over</strong><br/>Designation:<br/>Date:</div>
      <div class="line"><strong>Name & Signature of Receiving Officer</strong><br/>Designation:<br/>Date:</div>
    </div>
    <div class="footer"><span>Printed copy must be signed manually and retained by both branches.</span><span>Print count: ${Number(t.print_count || 0) + 1}</span></div>
  </body></html>`
}

function DeliveryNoteModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const doPrint = async () => {
    try {
      const logRes = await window.api.stocks.logTransferPrint(t.id, { print_type: Number(t.print_count || 0) > 0 ? 'reprint' : 'print' })
      if (!logRes?.success) toast.error(logRes?.error || 'Failed to log print')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to log print')
    }
    const win = window.open('', '_blank', 'width=900,height=700')
    if (!win) { toast.error('Popup blocked'); return }
    win.document.open()
    win.document.write(deliveryNoteHtml(t))
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 300)
    toast.success('Delivery note print logged')
    onDone()
  }
  return (
    <Modal title={`Delivery Note - ${t.transfer_number}`} onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Close</button>
        <button className="btn-secondary flex items-center gap-1.5" onClick={doPrint}><FileText size={14} /> Download PDF</button>
        <button className="btn-primary flex items-center gap-1.5" onClick={doPrint}><Printer size={14} /> {Number(t.print_count || 0) > 0 ? 'Reprint' : 'Print'}</button></>}>
      <div className="space-y-3">
        <div className="p-3 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
          <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.from_branch_name} -&gt; {t.to_branch_name}</p>
          <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{t.product_name} - {t.quantity} {t.unit || 'units'} - Printed {Number(t.print_count || 0)} time(s)</p>
        </div>
        <iframe title="Delivery note preview" className="w-full h-[520px] rounded-lg border" style={{ borderColor: 'var(--border)' }} srcDoc={deliveryNoteHtml(t)} />
      </div>
    </Modal>
  )
}

function MismatchModal({ t, onClose, onDone }: { t: Transfer; onClose: () => void; onDone: () => void }) {
  const [received, setReceived] = useState(Math.max(0, t.received_quantity || 0))
  const [damaged, setDamaged] = useState(0)
  const [reason, setReason] = useState('Missing item')
  const [details, setDetails] = useState('')
  const [loading, setLoading] = useState(false)
  const missing = Math.max(0, t.quantity - received - damaged)
  const submit = async () => {
    if (!details.trim()) { toast.error('Detailed reason required'); return }
    setLoading(true)
    try {
      const res = await window.api.stocks.reportMismatch(t.id, {
        received_quantity: received,
        damaged_quantity: damaged,
        missing_quantity: missing,
        reason_category: reason,
        detailed_reason: details,
      })
      if (res.success) { toast.success('Mismatch reported for admin review'); onDone() }
      else toast.error(res.error || 'Failed')
    } catch (e: any) {
      toast.error(e?.message || 'Failed to report mismatch')
    } finally {
      setLoading(false)
    }
  }
  return (
    <Modal title="Report Transfer Mismatch" onClose={onClose}
      footer={<><button className="btn-secondary" onClick={onClose}>Cancel</button>
        <button className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm font-semibold disabled:opacity-50" onClick={submit} disabled={loading}>Submit Complaint</button></>}>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <Detail label="Sent Qty" value={`${t.quantity}`} />
          <div><label className="label">Received Qty</label><input className="input" type="number" min={0} value={received} onChange={e => setReceived(Number(e.target.value))} /></div>
          <div><label className="label">Damaged Qty</label><input className="input" type="number" min={0} value={damaged} onChange={e => setDamaged(Number(e.target.value))} /></div>
        </div>
        <div className="p-2 rounded-lg bg-yellow-500/10 text-yellow-600 text-xs">Missing quantity: <strong>{missing}</strong></div>
        <div>
          <label className="label">Reason Category</label>
          <select className="input" value={reason} onChange={e => setReason(e.target.value)}>
            {['Missing item','Extra item','Wrong product','Damaged product','Wrong serial number','Wrong unit','Other'].map(r => <option key={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="label">Detailed Reason *</label>
          <textarea className="input h-24 resize-none" value={details} onChange={e => setDetails(e.target.value)} placeholder="Explain what was received wrongly..." />
        </div>
      </div>
    </Modal>
  )
}

function TransferCard({ t, userId, isAdmin, myBranchId, canApproveRole, onRefresh, onModalToggle }: {
  t: Transfer; userId: string; isAdmin: boolean; myBranchId: string; canApproveRole: boolean; onRefresh: () => void
  onModalToggle?: (open: boolean) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const [modal, setModal] = useState<'approve' | 'reject' | 'dispatch' | 'receive' | 'print' | 'mismatch' | null>(null)

  // Tell the page to pause its 12s auto-refresh while a modal is open here
  useEffect(() => {
    onModalToggle?.(modal !== null)
    return () => onModalToggle?.(false)
  }, [modal, onModalToggle])
  const [history, setHistory] = useState<Record<string, unknown>[]>([])
  const [printing, setPrinting] = useState(false)

  useEffect(() => {
    if (expanded) {
      window.api.stocks.transferHistory(t.id).then((r: any) => {
        if (r.success) setHistory(r.data)
        else toast.error(r.error || 'Failed to load transfer history')
      }).catch((e: any) => toast.error(e?.message || 'Failed to load transfer history'))
    }
  }, [expanded, t.id, t.status])

  const handlePrint = async () => {
    setPrinting(true)
    try {
      const r = await window.api.printer.printTransfer(t as unknown as Record<string, unknown>)
      if (r?.success) toast.success('Transfer note sent to printer')
      else toast.error(r?.error || 'Print failed')
    } catch (e: any) {
      toast.error(e?.message || 'Print failed')
    } finally { setPrinting(false) }
  }

  const canApprove  = t.status === 'pending_approval' && t.initiated_by !== userId && canApproveRole && (isAdmin || t.from_branch_id === myBranchId)
  const canReject   = t.status === 'pending_approval' && canApproveRole && (isAdmin || t.from_branch_id === myBranchId)
  const canDispatch = ['approved', 'ready_for_dispatch'].includes(t.status) &&
    (isAdmin || t.from_branch_id === myBranchId)
  const canReceive  = ['approved', 'dispatched', 'in_transit'].includes(t.status) &&
    (isAdmin || t.to_branch_id === myBranchId)
  const canPrint    = ['dispatched', 'in_transit', 'received', 'partially_received', 'discrepancy', 'under_admin_review'].includes(t.status)
  const canMismatch = ['dispatched', 'in_transit'].includes(t.status) &&
    (isAdmin || t.to_branch_id === myBranchId)
  const isDone      = DONE.includes(t.status)

  const close = () => { setModal(null); onRefresh() }

  return (
    <>
      <div className="card mb-3">
        <div className="flex items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="text-xs font-mono font-bold text-brand-400">{t.transfer_number}</span>
              <StatusBadge status={t.status} />
            </div>
            <p className="font-semibold" style={{ color: 'var(--text-1)' }}>{t.product_name}</p>
            <p className="text-xs font-mono mt-0.5" style={{ color: 'var(--text-3)' }}>{t.sku}</p>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
                {t.from_branch_name}
              </span>
              <ArrowRightLeft size={12} style={{ color: 'var(--text-3)' }} />
              <span className="text-xs px-2 py-0.5 rounded font-medium" style={{ background: 'var(--bg-soft)', color: 'var(--text-2)' }}>
                {t.to_branch_name}
              </span>
              <span className="text-xs font-bold" style={{ color: 'var(--text-1)' }}>× {t.quantity} units</span>
            </div>
            <p className="text-xs mt-2" style={{ color: 'var(--text-3)' }}>
              Requested by <strong style={{ color: 'var(--text-2)' }}>{t.initiated_by_name || '—'}</strong> · {fmt(t.initiated_at)}
            </p>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {!isDone && (
              <div className="flex gap-1 flex-wrap justify-end">
                {canApprove && (
                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-600 hover:bg-green-500 text-white flex items-center gap-1"
                    onClick={() => setModal('approve')}>
                    <Check size={12} /> Approve
                  </button>
                )}
                {canReject && (
                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1"
                    onClick={() => setModal('reject')}>
                    <X size={12} /> Reject
                  </button>
                )}
                {canDispatch && (
                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-orange-600 hover:bg-orange-500 text-white flex items-center gap-1"
                    onClick={() => setModal('dispatch')}>
                    <Truck size={12} /> Dispatch
                  </button>
                )}
                {canReceive && (
                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-teal-600 hover:bg-teal-500 text-white flex items-center gap-1"
                    onClick={() => setModal('receive')}>
                    <CheckCircle size={12} /> Receive
                  </button>
                )}
                {canMismatch && (
                  <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-500 text-white flex items-center gap-1"
                    onClick={() => setModal('mismatch')}>
                    <AlertTriangle size={12} /> Mismatch
                  </button>
                )}
              </div>
            )}
            <div className="flex items-center gap-1">
              <button className="btn-ghost btn-sm p-1.5" onClick={handlePrint} disabled={printing}
                title="Print transfer note / hard copy (with tracking number)">
                <Printer size={14} />
              </button>
              <button className="btn-ghost btn-sm p-1.5" onClick={() => setExpanded(e => !e)}>
                {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
              </button>
            </div>
            {canPrint && (
              <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1"
                onClick={() => setModal('print')}>
                <Printer size={12} /> {Number(t.print_count || 0) > 0 ? 'Reprint Delivery Note' : 'Print Delivery Note'}
              </button>
            )}
            {canPrint && (
              <button className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1"
                onClick={() => setModal('print')}>
                <Printer size={12} /> {Number(t.print_count || 0) > 0 ? 'Reprint Delivery Note' : 'Print Delivery Note'}
              </button>
            )}
            <button className="btn-ghost btn-sm p-1.5" onClick={() => setExpanded(e => !e)}>
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        </div>

        {expanded && (
          <div className="mt-4 pt-4 border-t grid grid-cols-2 md:grid-cols-3 gap-4" style={{ borderColor: 'var(--border)' }}>
            <Detail label="Initiated By"     value={t.initiated_by_name || '—'} />
            <Detail label="Initiated At"     value={fmt(t.initiated_at)} />
            <Detail label="Approved By"      value={t.approved_by_name || '—'} />
            {t.driver_name && <>
              <Detail label="Driver"           value={t.driver_name} />
              <Detail label="Driver Phone"     value={t.driver_phone || '—'} />
              <Detail label="Vehicle"          value={t.vehicle_number || '—'} />
              <Detail label="Dispatched At"    value={fmt(t.dispatch_at)} />
              <Detail label="Expected Delivery" value={fmt(t.expected_delivery_at)} />
            </>}
            {['received', 'partially_received', 'discrepancy'].includes(t.status) && <>
              <Detail label="Received By"      value={t.received_by_name || '—'} />
              <Detail label="Received At"      value={fmt(t.actual_delivery_at)} />
              <Detail label="Received Qty"     value={String(t.received_quantity)} color="text-green-600" />
              {t.damaged_quantity > 0 && <Detail label="Damaged Qty" value={String(t.damaged_quantity)} color="text-red-500" />}
              {t.missing_quantity > 0 && <Detail label="Missing Qty" value={String(t.missing_quantity)} color="text-yellow-600" />}
            </>}
            {t.reject_reason    && <Detail label="Reject Reason"    value={t.reject_reason}    color="text-red-500" />}
            {t.discrepancy_note && <Detail label="Discrepancy Note" value={t.discrepancy_note} color="text-red-500" />}
            {t.notes            && <Detail label="Notes"            value={t.notes} />}
          </div>
        )}
        {expanded && history.length > 0 && (
          <div className="mt-4 pt-4 border-t" style={{ borderColor: 'var(--border)' }}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-3" style={{ color: 'var(--text-3)' }}>
              Handover Timeline
            </p>
            <div className="space-y-0">
              {history.map((h, i) => (
                <div key={String(h.id)} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2.5 h-2.5 rounded-full mt-1.5 ${i === history.length - 1 ? 'bg-brand-500' : ''}`}
                      style={i === history.length - 1 ? undefined : { background: 'var(--border-2)' }} />
                    {i < history.length - 1 && <div className="w-px flex-1 my-1" style={{ background: 'var(--border)' }} />}
                  </div>
                  <div className="pb-3">
                    <p className="text-sm font-medium capitalize" style={{ color: 'var(--text-1)' }}>{String(h.status)}</p>
                    <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                      <Clock size={10} className="inline mr-1" />
                      {fmt(String(h.created_at))}
                      {h.actor_name ? <> · by <strong style={{ color: 'var(--text-2)' }}>{String(h.actor_name)}</strong></> : null}
                    </p>
                    {h.notes ? <p className="text-xs mt-0.5" style={{ color: 'var(--text-2)' }}>{String(h.notes)}</p> : null}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {modal === 'approve'  && <ApproveModal  t={t} onClose={() => setModal(null)} onDone={close} />}
      {modal === 'reject'   && <RejectModal   t={t} onClose={() => setModal(null)} onDone={close} />}
      {modal === 'dispatch' && <DispatchModal t={t} onClose={() => setModal(null)} onDone={close} />}
      {modal === 'receive'  && <ReceiveModal  t={t} onClose={() => setModal(null)} onDone={close} />}
      {modal === 'print'    && <DeliveryNoteModal t={t} onClose={() => setModal(null)} onDone={close} />}
      {modal === 'mismatch' && <MismatchModal t={t} onClose={() => setModal(null)} onDone={close} />}
    </>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────
const STATUS_TABS = [
  { key: 'all',              label: 'All' },
  { key: 'pending_approval', label: 'Pending' },
  { key: 'approved',         label: 'Approved' },
  { key: 'dispatched',       label: 'Dispatched' },
  { key: 'received',         label: 'Received' },
  { key: 'rejected',         label: 'Rejected' },
]

export default function StockTransfersPage() {
  const { user } = useAuthStore()
  const u = user as unknown as Record<string, unknown>
  const perms = ((u?.role as Record<string, unknown>)?.permissions ?? u?.permissions ?? {}) as Record<string, unknown>
  const isAdmin     = Boolean(perms.all)
  // Only Admin or Branch Manager may approve/reject requests — cashiers cannot.
  const canApproveRole = Boolean(perms.all || perms.employees)
  const myBranchId  = String(u?.branch_id ?? '')
  const userId      = String(u?.id ?? '')

  const [transfers,    setTransfers]    = useState<Transfer[]>([])
  const [loading,      setLoading]      = useState(false)
  const [statusFilter, setStatusFilter] = useState('all')
  const [branchFilter, setBranchFilter] = useState('')
  const [search, setSearch] = useState('')
  const [direction,    setDirection]    = useState<'all' | 'outgoing' | 'incoming'>('all')
  const [branches,     setBranches]     = useState<Record<string, unknown>[]>([])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const filters: Record<string, unknown> = {}
      if (statusFilter !== 'all') filters.status = statusFilter
      if (!isAdmin) filters.branch_id = myBranchId
      else if (branchFilter) filters.branch_id = branchFilter

      const res = await window.api.stocks.listTransfers(filters)
      if (res.success) {
        let data = res.data as Transfer[]
        if (!isAdmin && direction !== 'all') {
          data = data.filter(t =>
            direction === 'outgoing' ? t.from_branch_id === myBranchId : t.to_branch_id === myBranchId
          )
        }
        setTransfers(data)
      } else {
        toast.error(res.error || 'Failed to load transfers')
      }
    } catch (e: any) {
      toast.error(e?.message || 'Failed to load transfers')
    } finally {
      setLoading(false)
    }
  }, [statusFilter, branchFilter, isAdmin, myBranchId, direction])

  // Pause the background auto-refresh while any card modal is open, so it doesn't
  // wipe the form / close the dialog mid-edit.
  const modalOpenRef = useRef(false)
  useEffect(() => { load() }, [load])
  useEffect(() => {
    const timer = window.setInterval(() => { if (!modalOpenRef.current) load() }, 12000)
    return () => window.clearInterval(timer)
  }, [load])
  useEffect(() => {
    window.api.admin.branches.list().then((r: any) => {
      if (r.success) setBranches(r.data)
      else toast.error(r.error || 'Failed to load branches')
    }).catch((e: any) => toast.error(e?.message || 'Failed to load branches'))
  }, [])

  const pending    = transfers.filter(t => t.status === 'pending_approval').length
  const inTransit  = transfers.filter(t => ['dispatched', 'in_transit'].includes(t.status)).length
  const received   = transfers.filter(t => ['received', 'partially_received'].includes(t.status)).length

  const q = search.trim().toLowerCase()
  const visible = q
    ? transfers.filter(t =>
        (t.transfer_number || '').toLowerCase().includes(q) ||
        (t.product_name || '').toLowerCase().includes(q) ||
        (t.sku || '').toLowerCase().includes(q))
    : transfers

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Stock Transfers"
        subtitle={`${transfers.length} transfer${transfers.length !== 1 ? 's' : ''}`}
        actions={
          <button onClick={load} disabled={loading} className="btn-secondary btn-sm flex items-center gap-1.5">
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        }
      />

      {/* Stats */}
      <div className="grid grid-cols-3 gap-4 px-6 pt-4 shrink-0">
        {[
          { label: 'Pending Approval', count: pending,   color: 'text-yellow-500' },
          { label: 'In Transit',        count: inTransit, color: 'text-orange-500' },
          { label: 'Received',          count: received,  color: 'text-green-500'  },
        ].map(s => (
          <div key={s.label} className="card text-center py-3">
            <p className={`text-2xl font-bold ${s.color}`}>{s.count}</p>
            <p className="text-xs mt-1" style={{ color: 'var(--text-3)' }}>{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="px-6 pt-4 shrink-0">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
            {STATUS_TABS.map(tab => (
              <button key={tab.key} onClick={() => setStatusFilter(tab.key)}
                className={`px-3 py-1 rounded text-xs font-semibold transition-colors ${
                  statusFilter === tab.key ? 'bg-brand-600 text-white' : ''
                }`}
                style={statusFilter !== tab.key ? { color: 'var(--text-2)' } : undefined}>
                {tab.label}
              </button>
            ))}
          </div>

          {!isAdmin && (
            <div className="flex gap-1 p-1 rounded-lg" style={{ background: 'var(--bg-soft)' }}>
              {(['all', 'outgoing', 'incoming'] as const).map(d => (
                <button key={d} onClick={() => setDirection(d)}
                  className={`px-3 py-1 rounded text-xs font-semibold capitalize transition-colors ${
                    direction === d ? 'bg-brand-600 text-white' : ''
                  }`}
                  style={direction !== d ? { color: 'var(--text-2)' } : undefined}>
                  {d}
                </button>
              ))}
            </div>
          )}

          {isAdmin && (
            <select className="input text-xs py-1.5 w-48"
              value={branchFilter} onChange={e => setBranchFilter(e.target.value)}>
              <option value="">All Branches</option>
              {branches.map(b => (
                <option key={String(b.id)} value={String(b.id)}>{String(b.name)}</option>
              ))}
            </select>
          )}

          <div className="relative ml-auto">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input
              className="input text-xs py-1.5 pl-8 w-56"
              placeholder="Track by number / product…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && (
          <div className="space-y-3">
            {[1, 2, 3].map(i => (
              <div key={i} className="card h-28 animate-pulse" style={{ background: 'var(--bg-soft)' }} />
            ))}
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64" style={{ color: 'var(--text-3)' }}>
            <ArrowRightLeft size={40} className="mb-3 opacity-30" />
            <p className="font-medium" style={{ color: 'var(--text-2)' }}>No transfers found</p>
            <p className="text-xs mt-1">{q ? 'No transfer matches your search' : 'Use Stock Lookup to request transfers between branches'}</p>
          </div>
        )}

        {!loading && visible.map(t => (
          <TransferCard
            key={t.id} t={t}
            userId={userId} isAdmin={isAdmin} myBranchId={myBranchId}
            canApproveRole={canApproveRole}
            onRefresh={load}
            onModalToggle={open => { modalOpenRef.current = open }}
          />
        ))}
      </div>
    </div>
  )
}

