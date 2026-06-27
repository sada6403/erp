import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import {
  CreditCard, AlertCircle, ChevronDown, ChevronUp, Phone,
  Calendar, CheckCircle2, Clock, XCircle, TrendingUp, Users, DollarSign
} from 'lucide-react'
import toast from 'react-hot-toast'

type Inst = Record<string, unknown>
type ScheduleSlot = {
  month: number; due_date: string; amount: number;
  status: 'paid' | 'overdue' | 'upcoming'
  paid_on: string | null; paid_amount: number | null; payment_id: string | null
}
type InstDetail = Inst & { schedule: ScheduleSlot[]; payments: Inst[]; computed_monthly: number }

const STATUS_COLORS: Record<string, string> = {
  active: 'badge-green', completed: 'badge-blue',
  overdue: 'badge-red',  defaulted: 'badge-gray',
}

const fmt = (n: unknown) => `Rs.${Number(n || 0).toLocaleString()}`
const dateFmt = (s: string | null | undefined) => s ? new Date(s).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const slotStatus = (s: ScheduleSlot) => {
  if (s.status === 'paid')    return { label: 'Paid',     cls: 'badge-green' }
  if (s.status === 'overdue') return { label: 'Overdue',  cls: 'badge-red'   }
  return                             { label: 'Upcoming', cls: 'badge-gray'  }
}

export default function InstallmentsPage() {
  const [installments, setInstallments] = useState<Inst[]>([])
  const [filter, setFilter]             = useState('')
  const [expanded, setExpanded]         = useState<string | null>(null)
  const [detail, setDetail]             = useState<InstDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [paying, setPaying]             = useState<Inst | null>(null)

  const load = useCallback(async () => {
    const res = await window.api.admin.installments.list(filter ? { status: filter } : {})
    if (res.success) setInstallments(res.data as Inst[])
  }, [filter])

  useEffect(() => { load() }, [load])

  const toggleDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return }
    setExpanded(id)
    setDetailLoading(true)
    const res = await window.api.admin.installments.get(id)
    setDetailLoading(false)
    if (res.success) setDetail(res.data as InstDetail)
    else toast.error(res.error || 'Failed to load details')
  }

  const active    = installments.filter(i => i.status === 'active').length
  const overdue   = installments.filter(i => i.status === 'overdue')
  const completed = installments.filter(i => i.status === 'completed').length
  const totalDue  = installments.reduce((s, i) => s + Number(i.due_amount || 0), 0)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Installment Plans" subtitle={`${installments.length} total plans`} />

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 px-6 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <StatTile icon={<Users size={16} />} label="Active Plans"  value={active}          color="text-green-500" />
        <StatTile icon={<AlertCircle size={16} />} label="Overdue" value={overdue.length}  color="text-red-500"   />
        <StatTile icon={<CheckCircle2 size={16} />} label="Completed" value={completed}    color="text-blue-500"  />
        <StatTile icon={<DollarSign size={16} />} label="Total Pending" value={fmt(totalDue)} color="text-orange-500" />
      </div>

      {overdue.length > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2.5">
          <AlertCircle size={14} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-400">
            <strong>{overdue.length}</strong> overdue installment{overdue.length > 1 ? 's' : ''} —{' '}
            {overdue.slice(0, 3).map(i => i.customer_name as string).join(', ')}
            {overdue.length > 3 ? ` +${overdue.length - 3} more` : ''}
          </p>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {['', 'active', 'overdue', 'completed', 'defaulted'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all
              ${filter === s ? 'bg-blue-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'}`}>
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
            <tr>
              {['Customer', 'Invoice', 'Down Paid', 'Monthly', 'Progress', 'Next Due', 'Outstanding', 'Status', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {installments.map(inst => {
              const isExp       = expanded === inst.id
              const monthlyAmt  = Number(inst.computed_monthly || inst.monthly_amount || 0)
              const paysMade    = Number(inst.payments_made || 0)
              const total       = Number(inst.installment_count || 1)
              const pct         = Math.min(100, Math.round((paysMade / total) * 100))

              return [
                <tr key={inst.id as string} className="table-row cursor-pointer" onClick={() => toggleDetail(inst.id as string)}>
                  <td className="table-cell">
                    <div className="font-medium" style={{ color: 'var(--text-1)' }}>{inst.customer_name as string}</div>
                    {(inst.customer_phone as string) && (
                      <div className="flex items-center gap-1 text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <Phone size={10} />{inst.customer_phone as string}
                      </div>
                    )}
                  </td>
                  <td className="table-cell font-mono text-xs text-blue-500">{inst.invoice_number as string}</td>
                  <td className="table-cell text-green-500 font-semibold">{fmt(inst.down_payment)}</td>
                  <td className="table-cell font-semibold" style={{ color: 'var(--text-2)' }}>{fmt(monthlyAmt)}</td>
                  <td className="table-cell min-w-[120px]">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-xs shrink-0" style={{ color: 'var(--text-3)' }}>{paysMade}/{total}</span>
                    </div>
                  </td>
                  <td className="table-cell">
                    {inst.next_due_date ? (
                      <div className="flex items-center gap-1 text-xs">
                        <Calendar size={11} className={inst.status === 'overdue' ? 'text-red-400' : 'text-blue-400'} />
                        <span className={inst.status === 'overdue' ? 'text-red-400 font-semibold' : ''} style={inst.status !== 'overdue' ? { color: 'var(--text-2)' } : {}}>
                          {dateFmt(inst.next_due_date as string)}
                        </span>
                      </div>
                    ) : <span style={{ color: 'var(--text-3)' }}>—</span>}
                  </td>
                  <td className="table-cell text-red-400 font-bold">{fmt(inst.due_amount)}</td>
                  <td className="table-cell">
                    <span className={STATUS_COLORS[inst.status as string] || 'badge-gray'}>
                      {inst.status as string}
                    </span>
                  </td>
                  <td className="table-cell">
                    <div className="flex items-center gap-2">
                      {(inst.status === 'active' || inst.status === 'overdue') && (
                        <button
                          onClick={e => { e.stopPropagation(); setPaying(inst) }}
                          className="btn-success btn-sm gap-1">
                          <CreditCard size={11} /> Pay
                        </button>
                      )}
                      {isExp ? <ChevronUp size={14} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={14} style={{ color: 'var(--text-3)' }} />}
                    </div>
                  </td>
                </tr>,

                isExp && (
                  <tr key={`${inst.id as string}-detail`}>
                    <td colSpan={9} className="p-0">
                      <div className="px-6 py-4 border-b" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
                        {detailLoading ? (
                          <p className="text-sm py-4 text-center" style={{ color: 'var(--text-3)' }}>Loading schedule…</p>
                        ) : detail ? (
                          <DetailPanel detail={detail} onPayNow={slot => setPaying({ ...inst, _slot: slot })} />
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>

        {installments.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-3)' }}>
            <TrendingUp size={40} className="opacity-30" />
            <p className="text-sm">No installment plans found</p>
          </div>
        )}
      </div>

      {paying && (
        <PaymentModal
          installment={paying}
          onClose={() => setPaying(null)}
          onSave={async () => {
            setPaying(null)
            await load()
            if (expanded) {
              setDetailLoading(true)
              const r = await window.api.admin.installments.get(expanded)
              setDetailLoading(false)
              if (r.success) setDetail(r.data as InstDetail)
            }
          }}
        />
      )}
    </div>
  )
}

// ─── Detail Panel ────────────────────────────────────────────────────────────
function DetailPanel({ detail, onPayNow }: { detail: InstDetail; onPayNow: (slot: ScheduleSlot) => void }) {
  const nextSlot = detail.schedule.find(s => s.status !== 'paid')

  return (
    <div className="grid grid-cols-3 gap-4">
      {/* Left: Plan Summary */}
      <div className="col-span-1 space-y-3">
        <h4 className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>Plan Summary</h4>
        <InfoRow label="Customer"     value={detail.customer_name as string} />
        <InfoRow label="Phone"        value={(detail.customer_phone as string) || '—'} />
        <InfoRow label="Invoice"      value={detail.invoice_number as string} />
        <InfoRow label="Start Date"   value={dateFmt(detail.start_date as string)} />
        <InfoRow label="Frequency"    value={String(detail.frequency || 'monthly').charAt(0).toUpperCase() + String(detail.frequency || 'monthly').slice(1)} />
        <InfoRow label="Down Payment" value={fmt(detail.down_payment)} className="text-green-500 font-semibold" />
        <InfoRow label="Monthly Amt"  value={fmt(detail.computed_monthly)} className="font-semibold" />
        <InfoRow label="Total Amount" value={fmt(detail.total_amount)} />
        <InfoRow label="Paid So Far"  value={fmt(detail.paid_amount)} className="text-green-500" />
        <InfoRow label="Outstanding"  value={fmt(detail.due_amount)}  className="text-red-400 font-bold" />
        {nextSlot && (
          <div className="rounded-lg p-3 border border-orange-500/30 bg-orange-500/10">
            <p className="text-xs font-semibold text-orange-400 flex items-center gap-1">
              <Clock size={11} /> Next Payment Due
            </p>
            <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-1)' }}>{dateFmt(nextSlot.due_date)}</p>
            <p className="text-xs text-orange-400">{fmt(nextSlot.amount)}</p>
            <button onClick={() => onPayNow(nextSlot)} className="btn-success btn-sm mt-2 w-full">
              <CreditCard size={11} /> Pay Now
            </button>
          </div>
        )}
      </div>

      {/* Right: Monthly Schedule */}
      <div className="col-span-2">
        <h4 className="text-xs font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>Payment Schedule</h4>
        <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-sm">
            <thead style={{ background: 'var(--bg-page)' }}>
              <tr>
                {['#', 'Due Date', 'Amount', 'Status', 'Paid On', 'Paid Amt'].map(h => (
                  <th key={h} className="table-header text-xs">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {detail.schedule.map(slot => {
                const { label, cls } = slotStatus(slot)
                return (
                  <tr key={slot.month} className="table-row">
                    <td className="table-cell text-xs font-mono" style={{ color: 'var(--text-3)' }}>{slot.month}</td>
                    <td className="table-cell text-xs">{dateFmt(slot.due_date)}</td>
                    <td className="table-cell font-semibold text-xs">{fmt(slot.amount)}</td>
                    <td className="table-cell">
                      <span className={`${cls} flex items-center gap-1 w-fit`}>
                        {slot.status === 'paid'    && <CheckCircle2 size={9} />}
                        {slot.status === 'overdue' && <XCircle size={9} />}
                        {slot.status === 'upcoming' && <Clock size={9} />}
                        {label}
                      </span>
                    </td>
                    <td className="table-cell text-xs" style={{ color: 'var(--text-3)' }}>
                      {slot.paid_on ? dateFmt(slot.paid_on) : '—'}
                    </td>
                    <td className="table-cell text-xs text-green-500">
                      {slot.paid_amount != null ? fmt(slot.paid_amount) : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function InfoRow({ label, value, className = '' }: { label: string; value: string; className?: string }) {
  return (
    <div className="flex justify-between items-baseline gap-2 text-xs">
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`font-medium text-right ${className}`} style={className ? {} : { color: 'var(--text-1)' }}>{value}</span>
    </div>
  )
}

function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className={`${color} opacity-80`}>{icon}</div>
      <div>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</p>
        <p className="font-bold text-base" style={{ color: 'var(--text-1)' }}>{value}</p>
      </div>
    </div>
  )
}

// ─── Payment Modal ───────────────────────────────────────────────────────────
function PaymentModal({ installment, onClose, onSave }: {
  installment: Inst; onClose: () => void; onSave: () => void
}) {
  const slot        = installment._slot as ScheduleSlot | undefined
  const monthly     = Number(installment.computed_monthly || installment.monthly_amount || 0) || Number(installment.due_amount)
  const defaultAmt  = slot?.amount ?? monthly
  const [amount, setAmount] = useState(defaultAmt)
  const [notes, setNotes]   = useState('')
  const [saving, setSaving] = useState(false)

  const save = async () => {
    if (amount <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    const res = await window.api.admin.installments.recordPayment(installment.id as string, { amount, notes })
    setSaving(false)
    if (res.success) { toast.success('Payment recorded'); onSave() }
    else toast.error(res.error || 'Failed')
  }

  return (
    <Modal
      title="Record Installment Payment"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-success">
            {saving ? 'Saving…' : 'Record Payment'}
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Customer</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{installment.customer_name as string}</p>
            {(installment.customer_phone as string) && (
              <p className="text-xs mt-0.5 flex items-center justify-center gap-1" style={{ color: 'var(--text-3)' }}>
                <Phone size={10} />{installment.customer_phone as string}
              </p>
            )}
          </div>
          <div className="card text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Monthly Amt</p>
            <p className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>{fmt(monthly)}</p>
          </div>
          <div className="card text-center">
            <p className="text-xs mb-1" style={{ color: 'var(--text-3)' }}>Total Due</p>
            <p className="text-lg font-bold text-red-400">{fmt(installment.due_amount)}</p>
          </div>
        </div>

        {slot && (
          <div className="rounded-lg px-3 py-2 text-xs border border-blue-500/30 bg-blue-500/10 text-blue-400 flex items-center gap-2">
            <Calendar size={12} />
            Payment for Month {slot.month} — Due {dateFmt(slot.due_date)}
          </div>
        )}

        <div>
          <label className="label">Payment Amount (Rs.)</label>
          <input
            type="number" value={amount}
            onChange={e => setAmount(parseFloat(e.target.value) || 0)}
            className="input text-xl font-bold text-center"
            min="1" max={Number(installment.due_amount)} />
        </div>
        <div>
          <label className="label">Notes</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="input" placeholder="Receipt no., notes…" />
        </div>
      </div>
    </Modal>
  )
}
