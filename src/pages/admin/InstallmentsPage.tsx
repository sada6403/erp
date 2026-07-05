// Complete Installment Management Module
// Tabs: Accounts · New Sale · Plans · Bank Transfers · Reports
import { useState, useEffect, useCallback, useRef } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import {
  CreditCard, AlertCircle, ChevronDown, ChevronUp, Phone, Calendar,
  CheckCircle2, Clock, XCircle, TrendingUp, Users, DollarSign, Plus,
  Settings, Search, BarChart3, Printer, RefreshCw, BanknoteIcon,
  Building2, Wallet, Edit3, FileText, AlertTriangle, Star
} from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Types ───────────────────────────────────────────────────────────────────
type Tab = 'accounts' | 'new-sale' | 'plans' | 'transfers' | 'reports'
type Inst = Record<string, unknown>
type Plan = {
  id: string; name: string; months: number
  interest_type: string; interest_rate: number
  min_down_payment_pct: number; late_fee: number
  grace_period_days: number; is_promotion: number; is_active: number
}
type ProductRow = { id: string; name: string; sku: string; selling_price: number }
type CustomerRow = { id: string; name: string; phone: string; email: string; nic: string; address: string }
type ScheduleRow = {
  id: string; installment_no: number; due_date: string
  principal: number; interest: number; penalty: number
  total_due: number; paid_amount: number; status: string; paid_at: string | null
}
type Calc = {
  cash_price: number; down_payment: number; financed_amount: number
  interest_type: string; interest_rate: number; interest_amount: number
  total_payable: number; monthly_amount: number; months: number
}
type ReceiptData = {
  receipt_number: string; contract_number: string; customer_name: string
  customer_phone: string; amount: number; method: string
  paid_at: string; cashier: string; status: string
}

// ─── Constants ───────────────────────────────────────────────────────────────
const MONTHS_OPTIONS = [3, 6, 12, 18, 24, 36]
const PAYMENT_METHODS = [
  { value: 'cash',          label: 'Cash',            icon: '💵' },
  { value: 'card',          label: 'Card',            icon: '💳' },
  { value: 'bank_transfer', label: 'Bank Transfer',   icon: '🏦' },
  { value: 'online',        label: 'Online Payment',  icon: '📱' },
]
const STATUS_COLORS: Record<string, string> = {
  active: 'badge-green', completed: 'badge-blue', overdue: 'badge-red', defaulted: 'badge-gray',
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
const fmt = (n: unknown) =>
  `Rs.${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

const dateFmt = (s: string | null | undefined) =>
  s ? new Date(s).toLocaleDateString('en-US', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const today = () => new Date().toISOString().slice(0, 10)

function overdueBorder(days: number) {
  if (days <= 0) return ''
  if (days <= 7)  return 'border-l-2 border-yellow-500 bg-yellow-500/5'
  if (days <= 15) return 'border-l-2 border-orange-500 bg-orange-500/5'
  return 'border-l-2 border-red-500 bg-red-500/5'
}

function overdueChip(days: number) {
  if (days <= 0) return null
  const cls = days <= 7
    ? 'text-yellow-400 bg-yellow-500/10'
    : days <= 15
    ? 'text-orange-400 bg-orange-500/10'
    : 'text-red-400 bg-red-500/10'
  return (
    <span className={`ml-1 text-[10px] px-1.5 py-0.5 rounded font-bold ${cls}`}>
      {days}d overdue
    </span>
  )
}

function printReceiptWindow(data: ReceiptData) {
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body { font-family: 'Courier New', monospace; padding: 24px; font-size: 13px; color: #111; }
    .center { text-align: center; } .bold { font-weight: bold; }
    .line { border-top: 1px dashed #666; margin: 8px 0; }
    .row { display: flex; justify-content: space-between; margin: 3px 0; }
    h2 { margin: 4px 0; font-size: 18px; }
    .status { display: inline-block; padding: 2px 8px; border-radius: 4px;
      background: ${data.status === 'approved' ? '#d1fae5' : '#fef9c3'};
      color: ${data.status === 'approved' ? '#065f46' : '#713f12'};
      font-weight: bold; font-size: 12px; }
  </style></head><body>
    <div class="center">
      <h2>INSTALLMENT RECEIPT</h2>
      <p style="margin:2px 0; font-size:11px">Payment Confirmation</p>
    </div>
    <div class="line"></div>
    <div class="row"><span>Receipt No:</span><span class="bold">${data.receipt_number}</span></div>
    <div class="row"><span>Contract:</span><span class="bold">${data.contract_number}</span></div>
    <div class="line"></div>
    <div class="row"><span>Customer:</span><span class="bold">${data.customer_name}</span></div>
    <div class="row"><span>Phone:</span><span>${data.customer_phone || '—'}</span></div>
    <div class="line"></div>
    <div class="row"><span>Amount:</span><span class="bold" style="font-size:15px">${fmt(data.amount)}</span></div>
    <div class="row"><span>Method:</span><span>${data.method.replace('_', ' ').toUpperCase()}</span></div>
    <div class="row"><span>Status:</span><span class="status">${data.status === 'approved' ? 'APPROVED' : 'PENDING VERIFICATION'}</span></div>
    <div class="row"><span>Date:</span><span>${dateFmt(data.paid_at)}</span></div>
    <div class="row"><span>Collected By:</span><span>${data.cashier}</span></div>
    <div class="line"></div>
    <div class="center" style="font-size:11px; color:#666; margin-top: 12px;">
      ${data.status === 'pending_verification'
        ? '<p>⏳ Bank transfer pending verification</p><p>Please retain this receipt</p>'
        : '<p>Thank you for your payment</p>'}
      <p style="margin-top: 8px; font-size: 10px;">Powered by Enterprise POS ERP</p>
    </div>
  </body></html>`
  // Print via a hidden iframe — window.open('') fails inside Electron (about: link).
  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open(); doc.write(html); doc.close()
  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* ignore */ } }, 1500)
  }, 300)
}

// ─── Passbook Print ──────────────────────────────────────────────────────────
function printPassbookWindow(detail: Inst) {
  const schedule = (detail.schedule as ScheduleRow[]) || []
  const payments = (detail.payments as Inst[]) || []
  const monthly = Number(detail.computed_monthly || detail.monthly_amount || 0)

  const blank = `<div class="blank-line"></div>`

  const rows = schedule.map(s => {
    const isPaid   = s.status === 'paid' || s.paid_amount > 0
    const isOverdue = s.status === 'overdue'

    let matched: Inst | null = null
    if (isPaid && s.paid_at) {
      const d = new Date(s.paid_at).toDateString()
      matched = payments.find(p => p.paid_at && new Date(p.paid_at as string).toDateString() === d) || null
    }

    const mark = isPaid
      ? `<span style="color:#16a34a;font-weight:700;"> ✓</span>`
      : isOverdue
      ? `<span style="color:#dc2626;font-weight:700;"> !</span>`
      : ''

    return `<tr class="${isPaid ? 'paid' : 'unpaid'}">
      <td style="font-weight:700;">${s.installment_no}${mark}</td>
      <td>${dateFmt(s.due_date)}</td>
      <td style="font-weight:600;">${fmt(s.total_due)}${s.penalty > 0 ? `<br><small style="color:#dc2626;">+${fmt(s.penalty)} penalty</small>` : ''}</td>
      <td>${isPaid && s.paid_at ? dateFmt(s.paid_at) : blank}</td>
      <td>${isPaid && s.paid_amount > 0 ? fmt(s.paid_amount) : blank}</td>
      <td>${matched ? String(matched.method || '').replace(/_/g, ' ').toUpperCase() : blank}</td>
      <td style="font-family:monospace;font-size:9px;">${matched?.receipt_number ? String(matched.receipt_number) : blank}</td>
      <td>${blank}</td>
      <td>${blank}</td>
    </tr>`
  }).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Passbook — ${detail.contract_number as string}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;padding:18px;color:#1a1a1a;background:#fff;font-size:12px}
  .hdr{background:linear-gradient(135deg,#14532d,#15803d);color:#fff;padding:16px 20px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
  .co{font-size:19px;font-weight:700;letter-spacing:.8px}
  .co-sub{font-size:9.5px;opacity:.75;margin-top:2px}
  .cnt-lbl{font-size:8.5px;opacity:.8;text-transform:uppercase;letter-spacing:.8px;text-align:right}
  .cnt-val{font-family:monospace;font-size:17px;font-weight:700;background:rgba(255,255,255,.2);padding:5px 13px;border-radius:6px;margin-top:4px;display:inline-block}
  .info-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:9px;margin-bottom:11px}
  .ibox{border:1px solid #e2e8f0;border-radius:7px;padding:7px 11px}
  .ilbl{font-size:8px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:.4px}
  .ival{font-size:13px;font-weight:700;color:#1e293b;margin-top:2px}
  .fin{display:grid;grid-template-columns:repeat(5,1fr);background:#f1f5f9;border-radius:8px;padding:11px 15px;margin-bottom:13px;gap:6px}
  .fi{text-align:center}
  .fl{font-size:8px;text-transform:uppercase;color:#64748b;font-weight:700;letter-spacing:.3px}
  .fv{font-size:13px;font-weight:700;margin-top:3px}
  .g{color:#16a34a}.b{color:#1d4ed8}.r{color:#dc2626}.d{color:#1e293b}
  .sec{font-size:9.5px;font-weight:800;text-transform:uppercase;letter-spacing:.7px;color:#334155;margin-bottom:7px;padding-bottom:5px;border-bottom:2px solid #14532d}
  table{width:100%;border-collapse:collapse;font-size:10px}
  thead tr{background:#14532d;color:#fff}
  th{padding:7px 7px;text-align:center;font-weight:600;font-size:9px;letter-spacing:.2px}
  td{padding:7px 6px;border-bottom:1px solid #e2e8f0;text-align:center;vertical-align:middle}
  tr.paid{background:#f0fdf4}
  tr.unpaid{background:#fff}
  .blank-line{border-bottom:1px solid #b0bec5;height:15px;margin:0 6px}
  .foot{margin-top:13px;display:flex;justify-content:space-between;align-items:flex-end;border-top:1px solid #e2e8f0;padding-top:9px}
  .fn{font-size:8px;color:#94a3b8;max-width:68%;line-height:1.5}
  .sig-area{text-align:right}
  .sig-line{border-bottom:1px solid #475569;width:130px;height:22px;margin:0 0 3px auto}
  .sig-lbl{font-size:8px;color:#475569}
  @media print{body{padding:8px}@page{margin:7mm 9mm;size:A4 portrait}}
</style></head><body>

<div class="hdr">
  <div>
    <div class="co">🌿 Nature Plantation</div>
    <div class="co-sub">Installment Payment Passbook</div>
  </div>
  <div>
    <div class="cnt-lbl">Contract Number</div>
    <div class="cnt-val">${detail.contract_number as string}</div>
  </div>
</div>

<div class="info-grid">
  <div class="ibox">
    <div class="ilbl">Customer Name</div>
    <div class="ival">${detail.customer_name as string}</div>
  </div>
  <div class="ibox">
    <div class="ilbl">Phone</div>
    <div class="ival">${(detail.customer_phone as string) || '—'}</div>
  </div>
  <div class="ibox">
    <div class="ilbl">Branch</div>
    <div class="ival">${(detail.branch_name as string) || '—'}</div>
  </div>
  <div class="ibox">
    <div class="ilbl">Start Date</div>
    <div class="ival">${dateFmt(detail.start_date as string)}</div>
  </div>
</div>

<div class="fin">
  <div class="fi"><div class="fl">Cash Price</div><div class="fv d">${fmt(detail.cash_price)}</div></div>
  <div class="fi"><div class="fl">Down Payment</div><div class="fv g">${fmt(detail.down_payment)}</div></div>
  <div class="fi"><div class="fl">Financed Amount</div><div class="fv d">${fmt(detail.financed_amount)}</div></div>
  <div class="fi"><div class="fl">Monthly EMI × ${detail.installment_count}</div><div class="fv b">${fmt(monthly)}</div></div>
  <div class="fi"><div class="fl">Total Payable</div><div class="fv r">${fmt(detail.total_amount)}</div></div>
</div>

<div class="sec">Payment Schedule &amp; Record</div>
<table>
  <thead>
    <tr>
      <th style="width:30px">#</th>
      <th>Due Date</th>
      <th>Amount Due</th>
      <th>Date Paid</th>
      <th>Amount Paid</th>
      <th>Method</th>
      <th>Receipt No.</th>
      <th style="width:95px">Staff Signature</th>
      <th style="width:95px">Customer Signature</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>

<div class="foot">
  <div class="fn">
    &#9432; This passbook is the official payment record for your installment agreement with Nature Plantation.<br>
    Please bring this passbook on every payment visit. Keep it safe &mdash; lost passbooks will not be replaced.<br>
    Interest: ${detail.interest_type as string} @ ${detail.interest_rate}% &nbsp;|&nbsp; Duration: ${detail.installment_count} months
  </div>
  <div class="sig-area">
    <div class="sig-line"></div>
    <div class="sig-lbl">Authorised Signature</div>
    <div style="margin-top:5px;font-size:7px;color:#94a3b8;">Printed: ${new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
  </div>
</div>

</body></html>`

  const iframe = document.createElement('iframe')
  iframe.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0'
  document.body.appendChild(iframe)
  const doc = iframe.contentWindow?.document
  if (!doc) { document.body.removeChild(iframe); return }
  doc.open(); doc.write(html); doc.close()
  setTimeout(() => {
    iframe.contentWindow?.focus()
    iframe.contentWindow?.print()
    setTimeout(() => { try { document.body.removeChild(iframe) } catch { /* ignore */ } }, 1500)
  }, 300)
}

// ─── Main Page ───────────────────────────────────────────────────────────────
export default function InstallmentsPage() {
  const [tab, setTab]       = useState<Tab>('accounts')
  const [paying, setPaying] = useState<Inst | null>(null)
  const [receipt, setReceipt] = useState<ReceiptData | null>(null)
  const [summaryStats, setSummaryStats] = useState({ active: 0, overdue: 0, completed: 0, totalDue: 0 })

  const loadStats = useCallback(async () => {
    const res = await window.api.admin.installments.list({})
    if (!res.success) return
    const list = res.data as Inst[]
    setSummaryStats({
      active:    list.filter(i => i.status === 'active').length,
      overdue:   list.filter(i => i.status === 'overdue').length,
      completed: list.filter(i => i.status === 'completed').length,
      totalDue:  list.reduce((s, i) => s + Number(i.due_amount || 0), 0),
    })
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  const handlePaymentSaved = (data: ReceiptData) => {
    setPaying(null)
    setReceipt(data)
    loadStats()
  }

  const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'accounts',  label: 'Accounts',       icon: <Users size={14} /> },
    { id: 'new-sale',  label: 'New Sale',        icon: <Plus size={14} /> },
    { id: 'plans',     label: 'Plans & Config',  icon: <Settings size={14} /> },
    { id: 'transfers', label: 'Bank Transfers',  icon: <BanknoteIcon size={14} /> },
    { id: 'reports',   label: 'Reports',         icon: <BarChart3 size={14} /> },
  ]

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="Installment Management" subtitle="Full installment lifecycle management" />

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-3 px-6 py-3 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <StatTile icon={<Users size={15} />}       label="Active Plans"   value={summaryStats.active}        color="text-green-500" />
        <StatTile icon={<AlertCircle size={15} />} label="Overdue"        value={summaryStats.overdue}       color="text-red-500"   />
        <StatTile icon={<CheckCircle2 size={15} />}label="Completed"      value={summaryStats.completed}     color="text-blue-500"  />
        <StatTile icon={<DollarSign size={15} />}  label="Total Outstanding" value={fmt(summaryStats.totalDue)} color="text-orange-500" />
      </div>

      {/* Tab bar */}
      <div className="flex gap-0.5 px-6 pt-2 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        {TABS.map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            className={`flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-t-lg border-b-2 transition-colors
              ${tab === t.id
                ? 'border-blue-500 text-blue-500 bg-blue-500/5'
                : 'border-transparent hover:text-blue-400'}`}
            style={tab !== t.id ? { color: 'var(--text-3)' } : {}}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'accounts'  && <AccountsTab  onPay={setPaying} onStatsChange={loadStats} />}
      {tab === 'new-sale'  && <NewSaleTab   onSuccess={() => { setTab('accounts'); loadStats() }} />}
      {tab === 'plans'     && <PlansTab />}
      {tab === 'transfers' && <BankTransfersTab onStatsChange={loadStats} />}
      {tab === 'reports'   && <ReportsTab />}

      {/* Payment modal */}
      {paying && (
        <PaymentModal
          installment={paying}
          onClose={() => setPaying(null)}
          onSave={handlePaymentSaved}
        />
      )}

      {/* Receipt modal */}
      {receipt && (
        <ReceiptModal receipt={receipt} onClose={() => setReceipt(null)} />
      )}
    </div>
  )
}

// ─── Stat Tile ───────────────────────────────────────────────────────────────
function StatTile({ icon, label, value, color }: { icon: React.ReactNode; label: string; value: string | number; color: string }) {
  return (
    <div className="card flex items-center gap-3">
      <div className={`${color} opacity-80`}>{icon}</div>
      <div>
        <p className="text-[11px]" style={{ color: 'var(--text-3)' }}>{label}</p>
        <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{value}</p>
      </div>
    </div>
  )
}

// ─── Accounts Tab ────────────────────────────────────────────────────────────
function AccountsTab({ onPay, onStatsChange }: { onPay: (i: Inst) => void; onStatsChange: () => void }) {
  const [list, setList]           = useState<Inst[]>([])
  const [filter, setFilter]       = useState('')
  const [search, setSearch]       = useState('')
  const [expanded, setExpanded]   = useState<string | null>(null)
  const [detail, setDetail]       = useState<Inst | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const load = useCallback(async () => {
    const res = await window.api.admin.installments.list(
      Object.assign(filter ? { status: filter } : {}, search ? { search } : {})
    )
    if (res.success) setList(res.data as Inst[])
  }, [filter, search])

  useEffect(() => { load() }, [load])

  const toggleDetail = async (id: string) => {
    if (expanded === id) { setExpanded(null); setDetail(null); return }
    setExpanded(id)
    setDetailLoading(true)
    const res = await window.api.admin.installments.get(id)
    setDetailLoading(false)
    if (res.success) setDetail(res.data as Inst)
    else toast.error(res.error || 'Failed to load details')
  }

  const overdueList = list.filter(i => i.status === 'overdue')

  return (
    <div className="flex flex-col flex-1 overflow-hidden">
      {overdueList.length > 0 && (
        <div className="mx-6 mt-3 flex items-center gap-2 bg-red-500/10 border border-red-500/30 rounded-xl px-4 py-2 shrink-0">
          <AlertCircle size={13} className="text-red-400 shrink-0" />
          <p className="text-xs text-red-400">
            <strong>{overdueList.length}</strong> overdue —{' '}
            {overdueList.slice(0, 3).map(i => i.customer_name as string).join(', ')}
            {overdueList.length > 3 ? ` +${overdueList.length - 3} more` : ''}
          </p>
        </div>
      )}

      <div className="flex items-center gap-2 px-6 py-2 shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
        <div className="relative flex-1 max-w-xs">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search customer, contract…"
            className="input pl-8 py-1.5 text-xs w-full" />
        </div>
        {['', 'active', 'overdue', 'completed', 'defaulted'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all
              ${filter === s ? 'bg-blue-600 text-white' : 'bg-surface-800 text-slate-400 hover:text-white'}`}>
            {s || 'All'}
          </button>
        ))}
        <button onClick={load} className="p-1.5 rounded-lg hover:bg-[var(--bg-soft)] transition-colors" style={{ color: 'var(--text-3)' }}>
          <RefreshCw size={13} />
        </button>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 z-10" style={{ background: 'var(--bg-page)' }}>
            <tr>
              {['Customer', 'Contract / Invoice', 'Down Paid', 'Monthly EMI', 'Progress', 'Next Due', 'Outstanding', 'Status', ''].map(h => (
                <th key={h} className="table-header">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {list.map(inst => {
              const isExp      = expanded === inst.id
              const monthly    = Number(inst.computed_monthly || inst.monthly_amount || 0)
              const paysMade   = Number(inst.payments_made || 0)
              const total      = Number(inst.installment_count || 1)
              const pct        = Math.min(100, Math.round((paysMade / total) * 100))
              const overdueDays = Number(inst.overdue_days || 0)

              return [
                <tr key={inst.id as string}
                  className={`table-row cursor-pointer ${overdueBorder(overdueDays)}`}
                  onClick={() => toggleDetail(inst.id as string)}>
                  <td className="table-cell">
                    <div className="flex items-center gap-1 flex-wrap">
                      <span className="font-medium" style={{ color: 'var(--text-1)' }}>{inst.customer_name as string}</span>
                      {overdueChip(overdueDays)}
                    </div>
                    {(inst.customer_phone as string) && (
                      <div className="flex items-center gap-1 text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <Phone size={9} />{inst.customer_phone as string}
                      </div>
                    )}
                  </td>
                  <td className="table-cell">
                    <div className="font-mono text-xs text-blue-500">{inst.contract_number as string}</div>
                    <div className="text-[10px] mt-0.5" style={{ color: 'var(--text-3)' }}>{inst.invoice_number as string}</div>
                  </td>
                  <td className="table-cell text-green-500 font-semibold text-sm">{fmt(inst.down_payment)}</td>
                  <td className="table-cell font-semibold text-sm" style={{ color: 'var(--text-2)' }}>{fmt(monthly)}</td>
                  <td className="table-cell min-w-[120px]">
                    <div className="flex items-center gap-1.5">
                      <div className="flex-1 rounded-full h-1.5 overflow-hidden" style={{ background: 'var(--border)' }}>
                        <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[10px] shrink-0" style={{ color: 'var(--text-3)' }}>{paysMade}/{total}</span>
                    </div>
                  </td>
                  <td className="table-cell">
                    {inst.next_due_date ? (
                      <div className="flex items-center gap-1 text-xs">
                        <Calendar size={10} className={overdueDays > 0 ? 'text-red-400' : 'text-blue-400'} />
                        <span className={overdueDays > 0 ? 'text-red-400 font-bold' : ''} style={overdueDays <= 0 ? { color: 'var(--text-2)' } : {}}>
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
                    <div className="flex items-center gap-1.5">
                      {(inst.status === 'active' || inst.status === 'overdue') && (
                        <button
                          onClick={e => { e.stopPropagation(); onPay(inst) }}
                          className="btn-success btn-sm gap-1">
                          <CreditCard size={10} /> Pay
                        </button>
                      )}
                      {(inst.status === 'active' || inst.status === 'overdue') && (
                        <button
                          title="Send reminder via Email/SMS"
                          onClick={e => {
                            e.stopPropagation()
                            window.api.comm.sendInstallmentReminder(inst.id as string).then((r: { success: boolean; error?: string }) => {
                              if (r.success) toast.success('Reminder sent!')
                              else toast.error(r.error || 'Failed to send reminder')
                            })
                          }}
                          className="btn-ghost btn-sm gap-1 text-yellow-400 hover:text-yellow-300">
                          <Phone size={10} /> Remind
                        </button>
                      )}
                      {isExp ? <ChevronUp size={13} style={{ color: 'var(--text-3)' }} /> : <ChevronDown size={13} style={{ color: 'var(--text-3)' }} />}
                    </div>
                  </td>
                </tr>,

                isExp && (
                  <tr key={`${inst.id as string}-det`}>
                    <td colSpan={9} className="p-0">
                      <div className="px-6 py-4 border-b" style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
                        {detailLoading
                          ? <p className="text-sm py-6 text-center" style={{ color: 'var(--text-3)' }}>Loading…</p>
                          : detail
                          ? <DetailPanel detail={detail} onPayNow={() => onPay(inst)} onRefresh={async () => {
                              const r = await window.api.admin.installments.get(inst.id as string)
                              if (r.success) setDetail(r.data as Inst)
                              await load()
                              onStatsChange()
                            }} />
                          : null}
                      </div>
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>

        {list.length === 0 && (
          <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-3)' }}>
            <TrendingUp size={40} className="opacity-30" />
            <p className="text-sm">No installment accounts found</p>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Detail Panel ────────────────────────────────────────────────────────────
function DetailPanel({ detail, onPayNow, onRefresh }: {
  detail: Inst; onPayNow: () => void; onRefresh: () => void
}) {
  const schedule = detail.schedule as ScheduleRow[]
  const payments = detail.payments as Inst[]
  const nextSlot = schedule.find(s => s.status !== 'paid')
  const overdueAmt = Number(detail.overdue_amount || 0)

  const scheduleStatusBadge = (s: ScheduleRow) => {
    if (s.status === 'paid')    return { label: 'Paid',     cls: 'badge-green' }
    if (s.status === 'overdue') return { label: 'Overdue',  cls: 'badge-red'   }
    if (s.status === 'partial') return { label: 'Partial',  cls: 'badge-yellow'}
    return                             { label: 'Upcoming', cls: 'badge-gray'  }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-[10px] font-bold uppercase tracking-wider" style={{ color: 'var(--text-3)' }}>Account Details</h4>
        <button
          onClick={() => printPassbookWindow(detail)}
          className="btn-secondary btn-sm gap-1.5 text-xs">
          <Printer size={12} /> Print Passbook
        </button>
      </div>
    <div className="grid grid-cols-3 gap-5">
      {/* Left: Summary */}
      <div className="col-span-1 space-y-2">
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-3" style={{ color: 'var(--text-3)' }}>Plan Summary</h4>
        <InfoRow label="Contract"     value={detail.contract_number as string} mono />
        <InfoRow label="Customer"     value={detail.customer_name as string} />
        <InfoRow label="Phone"        value={(detail.customer_phone as string) || '—'} />
        <InfoRow label="Branch"       value={(detail.branch_name as string) || '—'} />
        <InfoRow label="Start Date"   value={dateFmt(detail.start_date as string)} />
        <InfoRow label="Interest"     value={`${detail.interest_type} @ ${detail.interest_rate}%`} />
        <InfoRow label="Months"       value={`${detail.installment_count}`} />
        <div className="my-1 border-t" style={{ borderColor: 'var(--border)' }} />
        <InfoRow label="Cash Price"   value={fmt(detail.cash_price)} />
        <InfoRow label="Down Payment" value={fmt(detail.down_payment)} cls="text-green-500 font-semibold" />
        <InfoRow label="Financed"     value={fmt(detail.financed_amount)} />
        <InfoRow label="Interest Amt" value={fmt(detail.interest_amount)} />
        <InfoRow label="Total Payable" value={fmt(detail.total_amount)} cls="font-bold" />
        <InfoRow label="Paid So Far"  value={fmt(detail.paid_amount)} cls="text-green-500" />
        {(detail.penalty_amount as number) > 0 && (
          <InfoRow label="Penalties"  value={fmt(detail.penalty_amount)} cls="text-orange-400" />
        )}
        <InfoRow label="Outstanding"  value={fmt(detail.due_amount)} cls="text-red-400 font-bold" />
        {overdueAmt > 0 && (
          <InfoRow label="Overdue Now" value={fmt(overdueAmt)} cls="text-red-500 font-bold" />
        )}

        {nextSlot && (
          <div className="rounded-lg p-3 border border-orange-500/30 bg-orange-500/10 mt-2">
            <p className="text-[10px] font-bold text-orange-400 flex items-center gap-1">
              <Clock size={10} /> Next Payment Due
            </p>
            <p className="text-sm font-bold mt-1" style={{ color: 'var(--text-1)' }}>{dateFmt(nextSlot.due_date)}</p>
            <p className="text-xs text-orange-400">{fmt(nextSlot.total_due - nextSlot.paid_amount)}</p>
            {nextSlot.penalty > 0 && (
              <p className="text-[10px] text-red-400 mt-0.5">Incl. Rs.{nextSlot.penalty.toFixed(2)} penalty</p>
            )}
            <button onClick={onPayNow} className="btn-success btn-sm mt-2 w-full gap-1">
              <CreditCard size={10} /> Pay Now
            </button>
          </div>
        )}
      </div>

      {/* Centre: Schedule */}
      <div className="col-span-1">
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Payment Schedule</h4>
        <div className="rounded-lg border overflow-auto max-h-72" style={{ borderColor: 'var(--border)' }}>
          <table className="w-full text-xs">
            <thead style={{ background: 'var(--bg-page)' }}>
              <tr>{['#', 'Due Date', 'Amount', 'Penalty', 'Status'].map(h => (
                <th key={h} className="table-header text-[10px]">{h}</th>
              ))}</tr>
            </thead>
            <tbody>
              {schedule.map(s => {
                const { label, cls } = scheduleStatusBadge(s)
                return (
                  <tr key={s.id} className="table-row">
                    <td className="table-cell font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{s.installment_no}</td>
                    <td className="table-cell text-[10px]">{dateFmt(s.due_date)}</td>
                    <td className="table-cell font-semibold text-[10px]">{fmt(s.total_due)}</td>
                    <td className="table-cell text-[10px] text-red-400">{s.penalty > 0 ? fmt(s.penalty) : '—'}</td>
                    <td className="table-cell">
                      <span className={`${cls} flex items-center gap-0.5 w-fit text-[10px]`}>
                        {s.status === 'paid'    && <CheckCircle2 size={8} />}
                        {s.status === 'overdue' && <XCircle size={8} />}
                        {s.status === 'upcoming' || s.status === 'pending' ? <Clock size={8} /> : null}
                        {label}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Right: Payment History */}
      <div className="col-span-1">
        <h4 className="text-[10px] font-bold uppercase tracking-wider mb-2" style={{ color: 'var(--text-3)' }}>Payment History</h4>
        <div className="rounded-lg border overflow-auto max-h-72" style={{ borderColor: 'var(--border)' }}>
          {payments.length === 0 ? (
            <div className="flex items-center justify-center py-8" style={{ color: 'var(--text-3)' }}>
              <p className="text-xs">No payments yet</p>
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--bg-page)' }}>
                <tr>{['Date', 'Amount', 'Method', 'Receipt', 'Status', 'By'].map(h => (
                  <th key={h} className="table-header text-[10px]">{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {payments.map(p => (
                  <tr key={p.id as string} className="table-row">
                    <td className="table-cell text-[10px]">{dateFmt(p.paid_at as string)}</td>
                    <td className="table-cell font-semibold text-[10px] text-green-500">{fmt(p.amount)}</td>
                    <td className="table-cell text-[10px]">{String(p.method || '').replace('_', ' ')}</td>
                    <td className="table-cell font-mono text-[10px]" style={{ color: 'var(--text-3)' }}>{p.receipt_number as string || '—'}</td>
                    <td className="table-cell">
                      {p.status === 'approved'
                        ? <span className="badge-green text-[9px]">Approved</span>
                        : p.status === 'rejected'
                        ? <span className="badge-red text-[9px]">Rejected</span>
                        : <span className="badge-yellow text-[9px]">Pending</span>}
                    </td>
                    <td className="table-cell text-[10px]" style={{ color: 'var(--text-3)' }}>{p.received_by_name as string || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
    </div>
  )
}

// ─── New Sale Tab ────────────────────────────────────────────────────────────
function NewSaleTab({ onSuccess }: { onSuccess: () => void }) {
  // Customer
  const [custQuery, setCustQuery]   = useState('')
  const [custResults, setCustResults] = useState<CustomerRow[]>([])
  const [customer, setCustomer]     = useState<CustomerRow | null>(null)
  const [isNewCust, setIsNewCust]   = useState(false)
  const [newCust, setNewCust]       = useState({ name: '', phone: '', email: '', nic: '', address: '' })

  // Products
  const [prodQuery, setProdQuery]   = useState('')
  const [prodResults, setProdResults] = useState<ProductRow[]>([])
  const [items, setItems]           = useState<Array<{ product: ProductRow; qty: number; price: number }>>([])

  // Plan & Finance
  const [plans, setPlans]           = useState<Plan[]>([])
  const [planId, setPlanId]         = useState('')
  const [months, setMonths]         = useState(12)
  const [iType, setIType]           = useState('flat')
  const [iRate, setIRate]           = useState(0)
  const [downPmt, setDownPmt]       = useState(0)
  const [downMethod, setDownMethod] = useState('cash')
  const [startDate, setStartDate]   = useState(today())
  const [notes, setNotes]           = useState('')

  // Computed
  const [calc, setCalc]     = useState<Calc | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const cashPrice = items.reduce((s, i) => s + i.qty * i.price, 0)

  useEffect(() => {
    window.api.admin.installments.plans().then((r: { success: boolean; data?: unknown }) => {
      if (r.success) setPlans(r.data as Plan[])
    })
  }, [])

  // Customer search
  const searchCust = useCallback(async (q: string) => {
    if (!q.trim()) { setCustResults([]); return }
    const r = await window.api.customers.search(q)
    if (r.success) setCustResults(r.data as CustomerRow[])
  }, [])
  const custTimer = useRef<ReturnType<typeof setTimeout>>()
  const onCustQuery = (q: string) => {
    setCustQuery(q)
    clearTimeout(custTimer.current)
    custTimer.current = setTimeout(() => searchCust(q), 300)
  }

  // Product search
  const searchProd = useCallback(async (q: string) => {
    if (!q.trim()) { setProdResults([]); return }
    const r = await window.api.products.search(q)
    if (r.success) setProdResults(r.data as ProductRow[])
  }, [])
  const prodTimer = useRef<ReturnType<typeof setTimeout>>()
  const onProdQuery = (q: string) => {
    setProdQuery(q)
    clearTimeout(prodTimer.current)
    prodTimer.current = setTimeout(() => searchProd(q), 300)
  }

  const addItem = (prod: ProductRow) => {
    setItems(prev => {
      const existing = prev.find(i => i.product.id === prod.id)
      if (existing) return prev.map(i => i.product.id === prod.id ? { ...i, qty: i.qty + 1 } : i)
      return [...prev, { product: prod, qty: 1, price: prod.selling_price }]
    })
    setProdQuery(''); setProdResults([])
  }

  const selectPlan = (id: string) => {
    setPlanId(id)
    const p = plans.find(pl => pl.id === id)
    if (p) {
      setMonths(p.months)
      setIType(p.interest_type)
      setIRate(p.interest_rate)
      const minDown = Math.ceil(cashPrice * p.min_down_payment_pct / 100)
      setDownPmt(Math.max(downPmt, minDown))
    }
  }

  // Recalculate on any finance change
  const calcTimer = useRef<ReturnType<typeof setTimeout>>()
  useEffect(() => {
    clearTimeout(calcTimer.current)
    if (cashPrice <= 0 || months <= 0) { setCalc(null); return }
    calcTimer.current = setTimeout(async () => {
      const r = await window.api.admin.installments.calculate({ cash_price: cashPrice, down_payment: downPmt, months, interest_type: iType, interest_rate: iRate })
      if (r.success) setCalc(r.data as Calc)
    }, 250)
  }, [cashPrice, downPmt, months, iType, iRate])

  const selectedPlan = plans.find(p => p.id === planId)
  const minDown = selectedPlan ? Math.ceil(cashPrice * selectedPlan.min_down_payment_pct / 100) : 0

  const submit = async () => {
    const custName = isNewCust ? newCust.name : customer?.name
    if (!custName) { toast.error('Select or enter a customer'); return }
    if (items.length === 0) { toast.error('Add at least one product'); return }
    if (!calc) { toast.error('Please wait for EMI calculation'); return }
    if (downPmt < minDown) { toast.error(`Minimum down payment is ${fmt(minDown)}`); return }

    setSubmitting(true)
    const payload = {
      customer_id:      isNewCust ? '' : (customer?.id || ''),
      customer_name:    custName,
      customer_phone:   isNewCust ? newCust.phone : (customer?.phone || ''),
      customer_email:   isNewCust ? newCust.email : (customer?.email || ''),
      customer_nic:     isNewCust ? newCust.nic   : (customer?.nic   || ''),
      customer_address: isNewCust ? newCust.address : (customer?.address || ''),
      items: items.map(i => ({ product_id: i.product.id, quantity: i.qty, unit_price: i.price })),
      cash_price:     cashPrice,
      down_payment:   downPmt,
      months, interest_type: iType, interest_rate: iRate,
      start_date:     startDate,
      down_payment_method: downMethod,
      notes,
    }
    const r = await window.api.admin.installments.createSale(payload)
    setSubmitting(false)
    if (r.success) {
      const data = r.data as { contract_number: string }
      toast.success(`✅ Account ${data.contract_number} created successfully!`)
      // Reset
      setCustomer(null); setIsNewCust(false); setNewCust({ name: '', phone: '', email: '', nic: '', address: '' })
      setItems([]); setCalc(null); setDownPmt(0); setNotes(''); setPlanId(''); setCustQuery('')
      onSuccess()
    } else {
      toast.error(r.error || 'Failed to create installment account')
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <div className="grid grid-cols-3 gap-5 max-w-6xl mx-auto">

        {/* Col 1: Customer */}
        <div className="space-y-3">
          <SectionHead icon={<Users size={14} />} title="Customer" />

          <div className="flex gap-2 mb-2">
            <button onClick={() => { setIsNewCust(false); setCustomer(null) }}
              className={`flex-1 btn-sm text-xs ${!isNewCust ? 'btn-primary' : 'btn-secondary'}`}>
              Existing Customer
            </button>
            <button onClick={() => { setIsNewCust(true); setCustomer(null) }}
              className={`flex-1 btn-sm text-xs ${isNewCust ? 'btn-primary' : 'btn-secondary'}`}>
              New Customer
            </button>
          </div>

          {!isNewCust ? (
            <div className="relative">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                <input value={custQuery} onChange={e => onCustQuery(e.target.value)}
                  placeholder="Search by name or phone…" className="input pl-8 w-full text-xs" />
              </div>
              {custResults.length > 0 && (
                <div className="absolute z-20 w-full mt-1 rounded-lg border shadow-lg overflow-hidden"
                  style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
                  {custResults.map(c => (
                    <button key={c.id} onClick={() => { setCustomer(c); setCustQuery(c.name); setCustResults([]) }}
                      className="w-full text-left px-3 py-2 text-xs hover:bg-blue-500/10 transition-colors">
                      <div className="font-semibold" style={{ color: 'var(--text-1)' }}>{c.name}</div>
                      <div style={{ color: 'var(--text-3)' }}>{c.phone} {c.nic ? `· NIC: ${c.nic}` : ''}</div>
                    </button>
                  ))}
                </div>
              )}
              {customer && (
                <div className="mt-2 rounded-lg p-3 border border-green-500/30 bg-green-500/10">
                  <p className="text-xs font-bold text-green-400">{customer.name}</p>
                  <p className="text-[10px] mt-0.5 text-green-400/70">{customer.phone} {customer.email ? `· ${customer.email}` : ''}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {[
                { field: 'name', label: 'Full Name *', placeholder: 'Customer name' },
                { field: 'phone', label: 'Phone', placeholder: '+94 xxx xxx xxx' },
                { field: 'email', label: 'Email', placeholder: 'email@example.com' },
                { field: 'nic', label: 'NIC / ID', placeholder: 'National ID number' },
                { field: 'address', label: 'Address', placeholder: 'Address' },
              ].map(({ field, label, placeholder }) => (
                <div key={field}>
                  <label className="label">{label}</label>
                  <input value={newCust[field as keyof typeof newCust]}
                    onChange={e => setNewCust(prev => ({ ...prev, [field]: e.target.value }))}
                    placeholder={placeholder} className="input text-xs w-full" />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Col 2: Products */}
        <div className="space-y-3">
          <SectionHead icon={<FileText size={14} />} title="Products" />

          <div className="relative">
            <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
            <input value={prodQuery} onChange={e => onProdQuery(e.target.value)}
              placeholder="Search product by name or SKU…" className="input pl-8 w-full text-xs" />
            {prodResults.length > 0 && (
              <div className="absolute z-20 w-full mt-1 rounded-lg border shadow-lg overflow-hidden max-h-48 overflow-y-auto"
                style={{ background: 'var(--bg-soft)', borderColor: 'var(--border)' }}>
                {prodResults.map(p => (
                  <button key={p.id} onClick={() => addItem(p)}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-blue-500/10 transition-colors flex justify-between">
                    <div>
                      <div className="font-semibold" style={{ color: 'var(--text-1)' }}>{p.name}</div>
                      <div style={{ color: 'var(--text-3)' }}>SKU: {p.sku}</div>
                    </div>
                    <div className="text-blue-400 font-bold shrink-0">{fmt(p.selling_price)}</div>
                  </button>
                ))}
              </div>
            )}
          </div>

          {items.length > 0 ? (
            <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
              <table className="w-full text-xs">
                <thead style={{ background: 'var(--bg-page)' }}>
                  <tr>{['Product', 'Qty', 'Price', 'Total', ''].map(h => (
                    <th key={h} className="table-header text-[10px] py-1.5">{h}</th>
                  ))}</tr>
                </thead>
                <tbody>
                  {items.map((item, idx) => (
                    <tr key={idx} className="table-row">
                      <td className="table-cell" style={{ color: 'var(--text-1)' }}>{item.product.name}</td>
                      <td className="table-cell">
                        <input type="number" min={1} value={item.qty}
                          onChange={e => setItems(prev => prev.map((i, j) => j === idx ? { ...i, qty: Math.max(1, Number(e.target.value)) } : i))}
                          className="input text-center w-14 py-0.5 text-xs" />
                      </td>
                      <td className="table-cell">
                        <input type="number" min={0} step={0.01} value={item.price}
                          onChange={e => setItems(prev => prev.map((i, j) => j === idx ? { ...i, price: Number(e.target.value) } : i))}
                          className="input text-right w-20 py-0.5 text-xs" />
                      </td>
                      <td className="table-cell font-semibold text-blue-400">{fmt(item.qty * item.price)}</td>
                      <td className="table-cell">
                        <button onClick={() => setItems(prev => prev.filter((_, j) => j !== idx))}
                          className="text-red-400 hover:text-red-300 transition-colors">
                          <XCircle size={13} />
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 border-t flex justify-between items-center" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                <span className="text-xs font-bold" style={{ color: 'var(--text-3)' }}>Cash Price</span>
                <span className="text-base font-bold text-blue-400">{fmt(cashPrice)}</span>
              </div>
            </div>
          ) : (
            <div className="rounded-lg border border-dashed p-6 flex flex-col items-center gap-2" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
              <Package size={28} className="opacity-30" />
              <p className="text-xs">Search and add products above</p>
            </div>
          )}
        </div>

        {/* Col 3: Plan & EMI */}
        <div className="space-y-3">
          <SectionHead icon={<CreditCard size={14} />} title="Installment Plan & EMI" />

          <div>
            <label className="label">Select Plan</label>
            <select value={planId} onChange={e => selectPlan(e.target.value)} className="input text-xs w-full">
              <option value="">— Custom / Manual —</option>
              {plans.map(p => (
                <option key={p.id} value={p.id}>
                  {p.name} ({p.months}M @ {p.interest_rate}% {p.interest_type}){p.is_promotion ? ' ⭐ Promo' : ''}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Months</label>
              <select value={months} onChange={e => setMonths(Number(e.target.value))} className="input text-xs w-full">
                {MONTHS_OPTIONS.map(m => <option key={m} value={m}>{m} months</option>)}
              </select>
            </div>
            <div>
              <label className="label">Interest Type</label>
              <select value={iType} onChange={e => setIType(e.target.value)} className="input text-xs w-full">
                <option value="no_interest">No Interest (0%)</option>
                <option value="flat">Flat Rate</option>
                <option value="reducing">Reducing Balance</option>
              </select>
            </div>
          </div>

          {iType !== 'no_interest' && (
            <div>
              <label className="label">Interest Rate (%)</label>
              <input type="number" min={0} step={0.1} value={iRate}
                onChange={e => setIRate(Number(e.target.value))}
                className="input text-xs w-full" placeholder="e.g. 12" />
            </div>
          )}

          <div>
            <label className="label">
              Down Payment (Rs.)
              {minDown > 0 && <span className="ml-2 text-[10px] text-orange-400">Min: {fmt(minDown)}</span>}
            </label>
            <input type="number" min={0} step={100} value={downPmt}
              onChange={e => setDownPmt(Number(e.target.value))}
              className="input text-xs w-full" />
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label">Down Payment Method</label>
              <select value={downMethod} onChange={e => setDownMethod(e.target.value)} className="input text-xs w-full">
                {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.icon} {m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Start Date</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input text-xs w-full" />
            </div>
          </div>

          {/* EMI Calculation Summary */}
          {calc ? (
            <div className="rounded-xl border p-3 space-y-1.5" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
              <p className="text-[10px] font-bold uppercase tracking-wide mb-2" style={{ color: 'var(--text-3)' }}>EMI Calculation</p>
              <EmiRow label="Cash Price"       value={fmt(calc.cash_price)} />
              <EmiRow label="Down Payment"     value={fmt(calc.down_payment)} cls="text-green-500" />
              <EmiRow label="Financed Amount"  value={fmt(calc.financed_amount)} />
              <EmiRow label={`Interest (${calc.interest_rate}% ${calc.interest_type})`} value={fmt(calc.interest_amount)} cls="text-orange-400" />
              <div className="border-t pt-1.5" style={{ borderColor: 'var(--border)' }}>
                <EmiRow label="Total Payable"  value={fmt(calc.total_payable)} cls="font-bold" />
                <div className="mt-2 p-2 rounded-lg bg-blue-500/10 border border-blue-500/30 flex items-center justify-between">
                  <span className="text-xs font-bold text-blue-400">Monthly EMI</span>
                  <span className="text-lg font-black text-blue-400">{fmt(calc.monthly_amount)}</span>
                </div>
                <p className="text-[10px] text-center mt-1" style={{ color: 'var(--text-3)' }}>
                  {calc.months} payments starting {dateFmt(new Date(new Date(startDate).setMonth(new Date(startDate).getMonth() + 1)).toISOString())}
                </p>
              </div>
            </div>
          ) : cashPrice > 0 ? (
            <div className="rounded-lg border border-dashed p-4 text-center" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
              <p className="text-xs">Calculating EMI…</p>
            </div>
          ) : null}

          <div>
            <label className="label">Notes</label>
            <textarea value={notes} onChange={e => setNotes(e.target.value)}
              className="input text-xs w-full resize-none" rows={2} placeholder="Contract notes, remarks…" />
          </div>

          <button onClick={submit} disabled={submitting || !calc}
            className="btn-primary w-full gap-2 py-3 font-bold">
            {submitting ? <><RefreshCw size={13} className="animate-spin" /> Creating…</>
              : <><CheckCircle2 size={13} /> Create Installment Account</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Plans Tab ───────────────────────────────────────────────────────────────
function PlansTab() {
  const [plans, setPlans]       = useState<Plan[]>([])
  const [editing, setEditing]   = useState<Partial<Plan> | null>(null)
  const [applying, setApplying] = useState(false)

  const load = useCallback(async () => {
    const r = await window.api.admin.installments.plans()
    if (r.success) setPlans(r.data as Plan[])
  }, [])

  useEffect(() => { load() }, [load])

  const handleApplyPenalties = async () => {
    setApplying(true)
    const r = await window.api.admin.installments.applyPenalties()
    setApplying(false)
    if (r.success) toast.success(`Penalties applied to ${r.data?.applied ?? 0} schedule slots`)
    else toast.error(r.error || 'Failed')
  }

  const initPlan = (): Partial<Plan> => ({
    name: '', months: 12, interest_type: 'flat', interest_rate: 0,
    min_down_payment_pct: 0, late_fee: 0, grace_period_days: 0, is_promotion: 0, is_active: 1
  })

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Installment Plans & Configuration</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>Manage plans, interest rates, penalties and grace periods</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleApplyPenalties} disabled={applying}
            className="btn-secondary gap-1.5 text-xs">
            {applying ? <RefreshCw size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
            Apply Pending Penalties
          </button>
          <button onClick={() => setEditing(initPlan())} className="btn-primary gap-1.5 text-xs">
            <Plus size={13} /> New Plan
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {plans.map(plan => (
          <div key={plan.id} className="card space-y-2 relative">
            {plan.is_promotion === 1 && (
              <span className="absolute top-3 right-3 flex items-center gap-1 text-[10px] text-yellow-400 font-bold">
                <Star size={10} /> PROMO
              </span>
            )}
            <div className="flex items-start justify-between">
              <div>
                <p className="font-bold text-sm" style={{ color: 'var(--text-1)' }}>{plan.name}</p>
                <p className="text-xs mt-0.5 text-blue-400">{plan.months} months</p>
              </div>
              <button onClick={() => setEditing({ ...plan })} className="p-1 rounded hover:bg-[var(--bg-soft)]" style={{ color: 'var(--text-3)' }}>
                <Edit3 size={12} />
              </button>
            </div>
            <div className="space-y-1 text-xs">
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Interest</span>
                <span style={{ color: 'var(--text-2)' }}>
                  {plan.interest_type === 'no_interest' ? 'No Interest' : `${plan.interest_rate}% ${plan.interest_type}`}
                </span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Min Down Payment</span>
                <span style={{ color: 'var(--text-2)' }}>{plan.min_down_payment_pct}%</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Late Fee</span>
                <span className="text-red-400">{plan.late_fee > 0 ? fmt(plan.late_fee) : '—'}</span>
              </div>
              <div className="flex justify-between">
                <span style={{ color: 'var(--text-3)' }}>Grace Period</span>
                <span style={{ color: 'var(--text-2)' }}>{plan.grace_period_days > 0 ? `${plan.grace_period_days} days` : '—'}</span>
              </div>
            </div>
            <div className="flex items-center justify-between pt-1 border-t" style={{ borderColor: 'var(--border)' }}>
              <span className={plan.is_active ? 'badge-green' : 'badge-gray'}>{plan.is_active ? 'Active' : 'Inactive'}</span>
              <button
                onClick={async () => {
                  await window.api.admin.installments.savePlan({ ...plan, is_active: plan.is_active ? 0 : 1 })
                  load()
                }}
                className="text-xs" style={{ color: 'var(--text-3)' }}>
                {plan.is_active ? 'Deactivate' : 'Activate'}
              </button>
            </div>
          </div>
        ))}

        {plans.length === 0 && (
          <div className="col-span-3 flex flex-col items-center justify-center py-16 gap-3" style={{ color: 'var(--text-3)' }}>
            <Settings size={36} className="opacity-30" />
            <p className="text-sm">No plans configured yet. Create your first plan.</p>
          </div>
        )}
      </div>

      {editing && (
        <PlanFormModal
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (data) => {
            const r = await window.api.admin.installments.savePlan(data)
            if (r.success) { toast.success('Plan saved'); setEditing(null); load() }
            else toast.error(r.error || 'Failed')
          }}
        />
      )}
    </div>
  )
}

// ─── Plan Form Modal ─────────────────────────────────────────────────────────
function PlanFormModal({ initial, onClose, onSave }: {
  initial: Partial<Plan>; onClose: () => void; onSave: (data: Partial<Plan>) => void
}) {
  const [form, setForm] = useState(initial)
  const set = (k: string, v: unknown) => setForm(prev => ({ ...prev, [k]: v }))

  return (
    <Modal title={form.id ? 'Edit Installment Plan' : 'New Installment Plan'} onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={() => onSave(form)} className="btn-primary">Save Plan</button>
        </>
      }>
      <div className="grid grid-cols-2 gap-3">
        <div className="col-span-2">
          <label className="label">Plan Name</label>
          <input value={form.name || ''} onChange={e => set('name', e.target.value)} className="input w-full" placeholder="e.g. 12 Month Standard" />
        </div>
        <div>
          <label className="label">Duration (Months)</label>
          <select value={form.months || 12} onChange={e => set('months', Number(e.target.value))} className="input w-full">
            {MONTHS_OPTIONS.map(m => <option key={m} value={m}>{m} months</option>)}
          </select>
        </div>
        <div>
          <label className="label">Interest Type</label>
          <select value={form.interest_type || 'flat'} onChange={e => set('interest_type', e.target.value)} className="input w-full">
            <option value="no_interest">No Interest (Promotion)</option>
            <option value="flat">Flat Rate</option>
            <option value="reducing">Reducing Balance</option>
          </select>
        </div>
        {form.interest_type !== 'no_interest' && (
          <div>
            <label className="label">Interest Rate (%)</label>
            <input type="number" min={0} step={0.1} value={form.interest_rate || 0}
              onChange={e => set('interest_rate', Number(e.target.value))} className="input w-full" />
          </div>
        )}
        <div>
          <label className="label">Min Down Payment (%)</label>
          <input type="number" min={0} max={100} step={1} value={form.min_down_payment_pct || 0}
            onChange={e => set('min_down_payment_pct', Number(e.target.value))} className="input w-full" />
        </div>
        <div>
          <label className="label">Late Fee (Rs.)</label>
          <input type="number" min={0} step={100} value={form.late_fee || 0}
            onChange={e => set('late_fee', Number(e.target.value))} className="input w-full" placeholder="0 = no fee" />
        </div>
        <div>
          <label className="label">Grace Period (Days)</label>
          <input type="number" min={0} step={1} value={form.grace_period_days || 0}
            onChange={e => set('grace_period_days', Number(e.target.value))} className="input w-full" />
        </div>
        <div className="col-span-2 flex items-center gap-3">
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={Boolean(form.is_promotion)} onChange={e => set('is_promotion', e.target.checked ? 1 : 0)} className="w-4 h-4" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Mark as Promotional Plan</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={form.is_active !== 0} onChange={e => set('is_active', e.target.checked ? 1 : 0)} className="w-4 h-4" />
            <span className="text-sm" style={{ color: 'var(--text-2)' }}>Active</span>
          </label>
        </div>
      </div>
    </Modal>
  )
}

// ─── Bank Transfers Tab ──────────────────────────────────────────────────────
function BankTransfersTab({ onStatsChange }: { onStatsChange: () => void }) {
  const [transfers, setTransfers] = useState<Inst[]>([])
  const [verifying, setVerifying] = useState<{ id: string; action: 'approve' | 'reject' } | null>(null)
  const [notes, setNotes]         = useState('')

  const load = useCallback(async () => {
    const r = await window.api.admin.installments.pendingTransfers()
    if (r.success) setTransfers(r.data as Inst[])
  }, [])

  useEffect(() => { load() }, [load])

  const verify = async () => {
    if (!verifying) return
    const r = await window.api.admin.installments.verifyPayment(verifying.id, verifying.action, notes)
    if (r.success) {
      toast.success(verifying.action === 'approve' ? 'Payment approved ✅' : 'Payment rejected')
      setVerifying(null); setNotes('')
      load(); onStatsChange()
    } else {
      toast.error(r.error || 'Failed')
    }
  }

  return (
    <div className="flex-1 overflow-auto px-6 py-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>Pending Bank Transfer Verification</p>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-3)' }}>
            {transfers.length} payment{transfers.length !== 1 ? 's' : ''} awaiting admin approval
          </p>
        </div>
        <button onClick={load} className="btn-secondary gap-1.5 text-xs"><RefreshCw size={12} /> Refresh</button>
      </div>

      {transfers.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3" style={{ color: 'var(--text-3)' }}>
          <CheckCircle2 size={40} className="opacity-30 text-green-500" />
          <p className="text-sm">No pending bank transfers</p>
        </div>
      ) : (
        <div className="space-y-3">
          {transfers.map(t => (
            <div key={t.id as string} className="card">
              <div className="flex items-start gap-4">
                <div className="flex-1 grid grid-cols-5 gap-3">
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Customer</p>
                    <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{t.customer_name as string}</p>
                    {(t.customer_phone as string) && (
                      <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <Phone size={9} />{t.customer_phone as string}
                      </p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Contract</p>
                    <p className="text-xs font-mono text-blue-400">{t.contract_number as string}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Amount</p>
                    <p className="text-base font-black text-green-500">{fmt(t.amount)}</p>
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Date Submitted</p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>{dateFmt(t.paid_at as string)}</p>
                    {(t.reference as string) && (
                      <p className="text-[10px] mt-0.5 font-mono" style={{ color: 'var(--text-3)' }}>Ref: {t.reference as string}</p>
                    )}
                  </div>
                  <div>
                    <p className="text-[10px]" style={{ color: 'var(--text-3)' }}>Received By</p>
                    <p className="text-xs" style={{ color: 'var(--text-2)' }}>{t.received_by_name as string || '—'}</p>
                    {(t.branch_name as string) && (
                      <p className="text-[10px] flex items-center gap-1 mt-0.5" style={{ color: 'var(--text-3)' }}>
                        <Building2 size={9} />{t.branch_name as string}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex flex-col gap-2 shrink-0">
                  <button
                    onClick={() => { setVerifying({ id: t.id as string, action: 'approve' }); setNotes('') }}
                    className="btn-success btn-sm gap-1 text-xs px-3">
                    <CheckCircle2 size={12} /> Approve
                  </button>
                  <button
                    onClick={() => { setVerifying({ id: t.id as string, action: 'reject' }); setNotes('') }}
                    className="btn-danger btn-sm gap-1 text-xs px-3">
                    <XCircle size={12} /> Reject
                  </button>
                </div>
              </div>
              {(t.notes as string) && (
                <div className="mt-2 pt-2 border-t text-xs" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                  Note: {t.notes as string}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {verifying && (
        <Modal
          title={verifying.action === 'approve' ? 'Approve Bank Transfer' : 'Reject Bank Transfer'}
          onClose={() => setVerifying(null)}
          footer={
            <>
              <button onClick={() => setVerifying(null)} className="btn-secondary">Cancel</button>
              <button onClick={verify} className={verifying.action === 'approve' ? 'btn-success' : 'btn-danger'}>
                {verifying.action === 'approve' ? 'Confirm Approval' : 'Confirm Rejection'}
              </button>
            </>
          }>
          <div className="space-y-3">
            <div className={`rounded-lg p-3 text-sm flex items-center gap-2 ${verifying.action === 'approve' ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>
              {verifying.action === 'approve'
                ? <><CheckCircle2 size={14} /> This payment will be <strong>approved</strong> and applied to the installment account.</>
                : <><XCircle size={14} /> This payment will be <strong>rejected</strong>. The customer will need to resubmit.</>}
            </div>
            <div>
              <label className="label">Notes / Reason {verifying.action === 'reject' ? '(Required)' : '(Optional)'}</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="input w-full resize-none" rows={3}
                placeholder={verifying.action === 'reject' ? 'Reason for rejection…' : 'Optional approval notes…'} />
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

// ─── Reports Tab ─────────────────────────────────────────────────────────────
function ReportsTab() {
  const [data, setData] = useState<Record<string, unknown> | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    window.api.admin.installments.reports({}).then((r: { success: boolean; data?: unknown }) => {
      if (r.success) setData(r.data as Record<string, unknown>)
      setLoading(false)
    })
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center flex-1">
      <RefreshCw size={20} className="animate-spin" style={{ color: 'var(--text-3)' }} />
    </div>
  )

  if (!data) return null

  const overdue   = data.overdue   as { count: number; amount: number }
  const collections = data.collections as { month: string; amount: number; count: number }[]
  const performance = data.performance as { branch_name: string; cashier_name: string; collected: number; payments: number }[]

  return (
    <div className="flex-1 overflow-auto px-6 py-4 space-y-5">
      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Active Accounts</p>
          <p className="text-3xl font-black mt-1 text-green-500">{data.active as number}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Overdue Accounts</p>
          <p className="text-3xl font-black mt-1 text-red-500">{overdue.count}</p>
          <p className="text-xs text-red-400 mt-0.5">Total: {fmt(overdue.amount)}</p>
        </div>
        <div className="card">
          <p className="text-xs font-semibold" style={{ color: 'var(--text-3)' }}>Total Outstanding</p>
          <p className="text-3xl font-black mt-1 text-orange-500">{fmt(data.outstanding)}</p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-5">
        {/* Monthly Collections */}
        <div>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>Monthly Collections (Last 12 Months)</p>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--bg-page)' }}>
                <tr>
                  <th className="table-header">Month</th>
                  <th className="table-header">Payments</th>
                  <th className="table-header">Total Collected</th>
                </tr>
              </thead>
              <tbody>
                {collections.length === 0 ? (
                  <tr><td colSpan={3} className="table-cell text-center py-8" style={{ color: 'var(--text-3)' }}>No collection data yet</td></tr>
                ) : collections.map(row => (
                  <tr key={row.month} className="table-row">
                    <td className="table-cell font-mono">{row.month}</td>
                    <td className="table-cell">{row.count}</td>
                    <td className="table-cell font-bold text-green-500">{fmt(row.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Performance */}
        <div>
          <p className="text-sm font-bold mb-3" style={{ color: 'var(--text-1)' }}>Collection Performance (by Cashier & Branch)</p>
          <div className="rounded-lg border overflow-hidden" style={{ borderColor: 'var(--border)' }}>
            <table className="w-full text-xs">
              <thead style={{ background: 'var(--bg-page)' }}>
                <tr>
                  <th className="table-header">Branch</th>
                  <th className="table-header">Cashier</th>
                  <th className="table-header">Payments</th>
                  <th className="table-header">Collected</th>
                </tr>
              </thead>
              <tbody>
                {performance.length === 0 ? (
                  <tr><td colSpan={4} className="table-cell text-center py-8" style={{ color: 'var(--text-3)' }}>No performance data yet</td></tr>
                ) : performance.map((row, i) => (
                  <tr key={i} className="table-row">
                    <td className="table-cell">
                      <div className="flex items-center gap-1">
                        <Building2 size={10} style={{ color: 'var(--text-3)' }} />
                        {row.branch_name || '—'}
                      </div>
                    </td>
                    <td className="table-cell">{row.cashier_name || '—'}</td>
                    <td className="table-cell">{row.payments}</td>
                    <td className="table-cell font-bold text-green-500">{fmt(row.collected)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="rounded-xl border p-4" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
        <p className="text-xs font-bold mb-2 flex items-center gap-2 text-blue-400"><AlertCircle size={13} /> Notification Reminders</p>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          SMS, Email and WhatsApp reminders are auto-scheduled at 7 days, 3 days, and on the due date for each installment.
          Connect your SMS gateway or email provider in <strong>Admin → Settings → Notifications</strong> to activate delivery.
          The reminder queue is stored in <code className="text-blue-400">installment_reminders</code> and syncs to the VPS backend.
        </p>
      </div>
    </div>
  )
}

// ─── Payment Modal ────────────────────────────────────────────────────────────
function PaymentModal({ installment, onClose, onSave }: {
  installment: Inst
  onClose: () => void
  onSave: (receipt: ReceiptData) => void
}) {
  const monthly   = Number(installment.computed_monthly || installment.monthly_amount || 0)
  const maxAmt    = Number(installment.due_amount || monthly)
  const [amount, setAmount]     = useState(Math.min(monthly, maxAmt))
  const [method, setMethod]     = useState('cash')
  const [reference, setRef]     = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [notes, setNotes]       = useState('')
  const [saving, setSaving]     = useState(false)

  const isBankTransfer = method === 'bank_transfer'

  const save = async () => {
    if (amount <= 0) { toast.error('Enter a valid amount'); return }
    if (amount > maxAmt + 0.01) { toast.error(`Max payable: ${fmt(maxAmt)}`); return }
    setSaving(true)
    const res = await window.api.admin.installments.recordPayment(installment.id as string, {
      amount,
      method,
      reference: reference || null,
      receipt_image_url: proofUrl || null,
      notes: notes || null,
    })
    setSaving(false)
    if (res.success) {
      const d = res.data as { receipt_number: string; status: string }
      toast.success(isBankTransfer ? 'Bank transfer submitted — pending verification' : 'Payment recorded ✅')
      onSave({
        receipt_number:   d.receipt_number,
        contract_number:  installment.contract_number as string,
        customer_name:    installment.customer_name as string,
        customer_phone:   installment.customer_phone as string || '',
        amount,
        method,
        paid_at:          new Date().toISOString(),
        cashier:          'Current User',
        status:           d.status,
      })
    } else {
      toast.error(res.error || 'Failed to record payment')
    }
  }

  return (
    <Modal
      title="Record Installment Payment"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Cancel</button>
          <button onClick={save} disabled={saving} className="btn-success gap-1.5">
            {saving ? <RefreshCw size={13} className="animate-spin" /> : <CreditCard size={13} />}
            {saving ? 'Processing…' : 'Record Payment'}
          </button>
        </>
      }>
      <div className="space-y-4">
        {/* Customer + Account info */}
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center py-3">
            <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Customer</p>
            <p className="text-sm font-bold" style={{ color: 'var(--text-1)' }}>{installment.customer_name as string}</p>
            {(installment.customer_phone as string) && (
              <p className="text-[10px] mt-0.5 flex items-center justify-center gap-1" style={{ color: 'var(--text-3)' }}>
                <Phone size={9} />{installment.customer_phone as string}
              </p>
            )}
          </div>
          <div className="card text-center py-3">
            <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Monthly EMI</p>
            <p className="text-lg font-bold text-blue-400">{fmt(monthly)}</p>
          </div>
          <div className="card text-center py-3">
            <p className="text-[10px] mb-1" style={{ color: 'var(--text-3)' }}>Total Outstanding</p>
            <p className="text-lg font-bold text-red-400">{fmt(maxAmt)}</p>
          </div>
        </div>

        {/* Payment method */}
        <div>
          <label className="label">Payment Method</label>
          <div className="grid grid-cols-4 gap-2">
            {PAYMENT_METHODS.map(m => (
              <button key={m.value} onClick={() => setMethod(m.value)}
                className={`flex flex-col items-center gap-1 p-2.5 rounded-xl border text-xs font-medium transition-all ${
                  method === m.value
                    ? 'border-blue-500 bg-blue-500/10 text-blue-400'
                    : 'hover:border-blue-400/40'
                }`}
                style={method !== m.value ? { borderColor: 'var(--border)', color: 'var(--text-3)' } : {}}>
                <span className="text-base">{m.icon}</span>
                <span>{m.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="label">Payment Amount (Rs.)</label>
          <input type="number" value={amount} min={1} step={0.01} max={maxAmt}
            onChange={e => setAmount(parseFloat(e.target.value) || 0)}
            className="input text-2xl font-bold text-center py-3 w-full" />
          <div className="flex gap-2 mt-1.5">
            {[monthly, maxAmt].filter((v, i, a) => a.indexOf(v) === i && v > 0).map(v => (
              <button key={v} onClick={() => setAmount(v)}
                className="text-[10px] px-2 py-0.5 rounded border text-blue-400 border-blue-500/30 bg-blue-500/5">
                {v === monthly ? `EMI: ${fmt(v)}` : `Full: ${fmt(v)}`}
              </button>
            ))}
          </div>
        </div>

        {(method === 'bank_transfer' || method === 'card') && (
          <div>
            <label className="label">Reference / Transaction ID</label>
            <input value={reference} onChange={e => setRef(e.target.value)} className="input w-full"
              placeholder={method === 'bank_transfer' ? 'Bank transaction reference number…' : 'Card approval code…'} />
          </div>
        )}

        {(method === 'bank_transfer' || method === 'card') && (
          <div>
            <label className="label">Payment Proof URL / File Path</label>
            <input
              value={proofUrl}
              onChange={e => setProofUrl(e.target.value)}
              className="input w-full"
              placeholder="Bank slip image URL or local file path"
            />
          </div>
        )}

        <div>
          <label className="label">Notes (Optional)</label>
          <input value={notes} onChange={e => setNotes(e.target.value)} className="input w-full"
            placeholder="Receipt no., remarks…" />
        </div>

        {isBankTransfer && (
          <div className="rounded-lg p-3 bg-yellow-500/10 border border-yellow-500/30 flex gap-2">
            <AlertCircle size={14} className="text-yellow-400 shrink-0 mt-0.5" />
            <p className="text-xs text-yellow-400">
              Bank transfers are placed in <strong>Pending Verification</strong> status.
              An admin must approve the payment in the <strong>Bank Transfers</strong> tab before it is applied to the account.
            </p>
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Receipt Modal ────────────────────────────────────────────────────────────
function ReceiptModal({ receipt, onClose }: { receipt: ReceiptData; onClose: () => void }) {
  const isPending = receipt.status === 'pending_verification'

  return (
    <Modal
      title="Payment Receipt"
      onClose={onClose}
      footer={
        <>
          <button onClick={onClose} className="btn-secondary">Close</button>
          <button onClick={() => printReceiptWindow(receipt)} className="btn-primary gap-1.5">
            <Printer size={13} /> Print Receipt
          </button>
        </>
      }>
      <div className="space-y-4">
        <div className={`rounded-xl p-4 text-center ${isPending ? 'bg-yellow-500/10 border border-yellow-500/30' : 'bg-green-500/10 border border-green-500/30'}`}>
          <div className={`text-3xl font-black ${isPending ? 'text-yellow-400' : 'text-green-400'}`}>{fmt(receipt.amount)}</div>
          <div className={`text-xs font-bold mt-1 flex items-center justify-center gap-1 ${isPending ? 'text-yellow-400' : 'text-green-400'}`}>
            {isPending ? <><Clock size={11} /> PENDING VERIFICATION</> : <><CheckCircle2 size={11} /> PAYMENT APPROVED</>}
          </div>
        </div>

        <div className="space-y-2 text-sm">
          <ReceiptRow label="Receipt No."   value={receipt.receipt_number} mono />
          <ReceiptRow label="Contract"      value={receipt.contract_number} mono />
          <ReceiptRow label="Customer"      value={receipt.customer_name} />
          {receipt.customer_phone && <ReceiptRow label="Phone" value={receipt.customer_phone} />}
          <ReceiptRow label="Method"        value={receipt.method.replace('_', ' ').toUpperCase()} />
          <ReceiptRow label="Date"          value={dateFmt(receipt.paid_at)} />
        </div>

        {isPending && (
          <div className="text-xs text-center p-2 rounded-lg border border-yellow-500/20 text-yellow-400">
            Please ask the customer to retain this receipt until the bank transfer is verified.
          </div>
        )}
      </div>
    </Modal>
  )
}

// ─── Small helpers ────────────────────────────────────────────────────────────
function SectionHead({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 pb-1 border-b" style={{ borderColor: 'var(--border)' }}>
      <span style={{ color: 'var(--text-3)' }}>{icon}</span>
      <p className="text-xs font-bold uppercase tracking-wide" style={{ color: 'var(--text-2)' }}>{title}</p>
    </div>
  )
}

function InfoRow({ label, value, cls = '', mono = false }: { label: string; value: string; cls?: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-baseline gap-2 text-xs">
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`font-medium text-right truncate max-w-[55%] ${mono ? 'font-mono' : ''} ${cls}`}
        style={cls ? {} : { color: 'var(--text-1)' }}>
        {value}
      </span>
    </div>
  )
}

function EmiRow({ label, value, cls = '' }: { label: string; value: string; cls?: string }) {
  return (
    <div className="flex justify-between items-baseline text-xs">
      <span style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={cls || ''} style={cls ? {} : { color: 'var(--text-2)' }}>{value}</span>
    </div>
  )
}

function ReceiptRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between border-b py-1.5" style={{ borderColor: 'var(--border)' }}>
      <span className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</span>
      <span className={`text-xs font-semibold ${mono ? 'font-mono text-blue-400' : ''}`} style={mono ? {} : { color: 'var(--text-1)' }}>
        {value}
      </span>
    </div>
  )
}

// Missing import alias for Package icon (used in NewSaleTab empty state)
function Package({ size, className }: { size: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
      strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="16.5" y1="9.4" x2="7.5" y2="4.21" />
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
      <polyline points="3.27 6.96 12 12.01 20.73 6.96" />
      <line x1="12" y1="22.08" x2="12" y2="12" />
    </svg>
  )
}
