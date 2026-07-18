import { useState, useEffect, useCallback } from 'react'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import { Plus, Ticket, Search, Printer, Ban, Eye, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useAuthStore } from '@/store/authStore'

type Coupon = Record<string, unknown>

const STATUS_BADGE: Record<string, string> = {
  active:  'badge-green',
  used_up: 'badge-blue',
  expired: 'badge-yellow',
  void:    'badge-red',
}

const STATUS_LABEL: Record<string, string> = {
  active:  'Active',
  used_up: 'Fully Used',
  expired: 'Expired',
  void:    'Voided',
}

const money = (n: unknown) => `Rs.${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export default function CouponsPage() {
  const { user } = useAuthStore()
  const perms = (user?.role?.permissions || {}) as Record<string, unknown>
  const canCreate = Boolean(perms.all || perms.coupons_create)
  const canVoid   = Boolean(perms.all || perms.coupons_void || perms.coupons_create)

  const [coupons, setCoupons]       = useState<Coupon[]>([])
  const [search, setSearch]         = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [detail, setDetail]         = useState<Coupon | null>(null)
  const [loading, setLoading]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await window.api.coupons.list({ search, status: statusFilter || undefined })
      if (res.success) setCoupons(res.data as Coupon[])
      else toast.error(String(res.error || 'Failed to load coupons'))
    } finally { setLoading(false) }
  }, [search, statusFilter])

  useEffect(() => { load() }, [load])

  const openDetail = async (idOrCode: string) => {
    try {
      const res = await window.api.coupons.get(idOrCode)
      if (res.success) setDetail(res.data as Coupon)
      else toast.error(String(res.error || 'Coupon not found'))
    } catch {
      toast.error('Failed to load coupon')
    }
  }

  const printCard = async (coupon: Coupon) => {
    try {
      const res = await window.api.printer.printCoupon(coupon)
      if ((res as { success: boolean }).success) toast.success('Coupon card printed')
      else toast.error('Print failed')
    } catch {
      toast.error('Print failed')
    }
  }

  const voidCoupon = async (coupon: Coupon) => {
    const reason = prompt(`Void coupon ${coupon.code}? The remaining balance (${money(coupon.balance)}) will be forfeited.\n\nReason:`)
    if (reason === null) return
    try {
      const res = await window.api.coupons.void(String(coupon.id), reason || undefined)
      if (res.success) { toast.success('Coupon voided'); setDetail(null); load() }
      else toast.error(String(res.error || 'Failed'))
    } catch {
      toast.error('Failed to void coupon')
    }
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="Gift Coupons"
        subtitle={`${coupons.length} coupon(s)`}
        actions={canCreate ? (
          <button onClick={() => setShowCreate(true)} className="btn-primary btn-sm gap-1.5">
            <Plus size={14} /> Issue Coupon
          </button>
        ) : null}
      />

      <div className="flex items-center gap-3 px-6 py-3 border-b flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="relative w-72">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-8"
            placeholder="Search code / name / customer…"
          />
        </div>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input w-40">
          <option value="">All statuses</option>
          <option value="active">Active</option>
          <option value="used_up">Fully Used</option>
          <option value="expired">Expired</option>
          <option value="void">Voided</option>
        </select>
      </div>

      <div className="flex-1 overflow-auto">
        <table className="w-full">
          <thead className="sticky top-0 bg-surface-900 z-10">
            <tr>
              {['Code', 'Name', 'Customer', 'Value', 'Balance', 'Status', 'Valid Until', 'Uses', 'Actions'].map(h =>
                <th key={h} className="table-header px-4 py-3 text-left">{h}</th>
              )}
            </tr>
          </thead>
          <tbody>
            {coupons.map(c => (
              <tr key={String(c.id)} className="table-row">
                <td className="table-cell font-mono text-xs">{String(c.code)}</td>
                <td className="table-cell">{String(c.name)}</td>
                <td className="table-cell text-slate-400">{String(c.customer_name || 'Bearer')}</td>
                <td className="table-cell">{money(c.initial_value)}</td>
                <td className="table-cell font-semibold">{money(c.balance)}</td>
                <td className="table-cell">
                  <span className={STATUS_BADGE[String(c.status)] || 'badge-gray'}>
                    {STATUS_LABEL[String(c.status)] || String(c.status)}
                  </span>
                </td>
                <td className="table-cell text-xs text-slate-400">
                  {c.valid_until ? String(c.valid_until).slice(0, 10) : 'No expiry'}
                </td>
                <td className="table-cell text-slate-400">{String(c.redemption_count || 0)}</td>
                <td className="table-cell">
                  <div className="flex items-center gap-1">
                    <button onClick={() => openDetail(String(c.id))} className="btn-ghost btn-sm p-1.5" title="View history">
                      <Eye size={13} />
                    </button>
                    <button onClick={() => printCard(c)} className="btn-ghost btn-sm p-1.5 text-brand-400" title="Print card">
                      <Printer size={13} />
                    </button>
                    {canVoid && c.status === 'active' && (
                      <button onClick={() => voidCoupon(c)} className="btn-ghost btn-sm p-1.5 text-red-400" title="Void coupon">
                        <Ban size={13} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {coupons.length === 0 && !loading && (
              <tr><td colSpan={9} className="text-center py-16 text-slate-500">
                <Ticket size={28} className="mx-auto mb-2 opacity-40" />
                No coupons yet{canCreate ? ' — issue the first one' : ''}
              </td></tr>
            )}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <CreateCouponModal
          onClose={() => setShowCreate(false)}
          onDone={() => { setShowCreate(false); load() }}
        />
      )}

      {detail && (
        <CouponDetailModal
          coupon={detail}
          canVoid={canVoid}
          onPrint={() => printCard(detail)}
          onVoid={() => voidCoupon(detail)}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}

// ── Create / issue coupon (designer) ──────────────────────────────────────────
function CreateCouponModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [customers, setCustomers] = useState<Record<string, unknown>[]>([])
  const [form, setForm] = useState({
    name: '', customer_id: '', initial_value: '',
    valid_from: new Date().toISOString().slice(0, 10),
    duration: '365', valid_until: '', notes: '',
  })
  const [saving, setSaving]   = useState(false)
  const [created, setCreated] = useState<Record<string, unknown> | null>(null)

  useEffect(() => {
    window.api.customers.list().then((r: { success: boolean; data?: Record<string, unknown>[]; error?: string }) => {
      if (r.success && r.data) setCustomers(r.data)
      else if (!r.success) toast.error(r.error || 'Failed to load customers')
    }).catch(() => toast.error('Failed to load customers'))
  }, [])

  const save = async () => {
    if (!form.name.trim()) { toast.error('Coupon name is required'); return }
    if (!(Number(form.initial_value) > 0)) { toast.error('Enter a coupon value'); return }
    setSaving(true)
    try {
      const res = await window.api.coupons.create({
        name: form.name.trim(),
        customer_id: form.customer_id || undefined,
        initial_value: Number(form.initial_value),
        valid_from: form.valid_from,
        valid_until: form.duration === 'custom' ? (form.valid_until || undefined) : undefined,
        duration_days: form.duration !== 'custom' && form.duration !== 'none' ? Number(form.duration) : undefined,
        notes: form.notes.trim() || undefined,
      })
      if (!res.success) { toast.error(String(res.error || 'Failed to create coupon')); return }
      setCreated(res.data as Record<string, unknown>)
      toast.success('Coupon issued')
    } finally { setSaving(false) }
  }

  const printCard = async () => {
    if (!created) return
    const customer = customers.find(c => String(c.id) === String(created.customer_id))
    try {
      const res = await window.api.printer.printCoupon({ ...created, customer_name: customer?.name || 'Bearer' })
      if ((res as { success: boolean }).success) toast.success('Coupon card printed')
      else toast.error('Print failed')
    } catch {
      toast.error('Print failed')
    }
  }

  // Success screen: show the generated code + print
  if (created) {
    return (
      <Modal title="Coupon Issued" onClose={onDone} footer={
        <>
          <button onClick={printCard} className="btn-secondary gap-1.5"><Printer size={14} /> Print Card</button>
          <button onClick={onDone} className="btn-primary">Done</button>
        </>
      }>
        <div className="text-center space-y-3 py-2">
          <div className="w-14 h-14 rounded-full bg-green-500/20 flex items-center justify-center mx-auto">
            <CheckCircle2 size={28} className="text-green-400" />
          </div>
          <p className="text-sm" style={{ color: 'var(--text-3)' }}>Coupon code</p>
          <p className="font-mono text-2xl font-bold tracking-wide" style={{ color: 'var(--text-1)' }}>{String(created.code)}</p>
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            {String(created.name)} — {money(created.initial_value)}
            {created.valid_until ? ` · valid till ${String(created.valid_until).slice(0, 10)}` : ''}
          </p>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            Print the card and hand it to the customer. The QR scans directly at any branch POS.
          </p>
        </div>
      </Modal>
    )
  }

  return (
    <Modal title="Issue Gift Coupon" onClose={onClose} footer={
      <>
        <button onClick={onClose} className="btn-secondary">Cancel</button>
        <button onClick={save} disabled={saving} className="btn-primary">{saving ? 'Issuing…' : 'Issue Coupon'}</button>
      </>
    }>
      <div className="space-y-4">
        <div>
          <label className="label">Coupon Name *</label>
          <input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
            className="input" placeholder="e.g. New Year Gift Voucher" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Value (Rs.) *</label>
            <input type="number" value={form.initial_value}
              onChange={e => setForm(p => ({ ...p, initial_value: e.target.value }))}
              className="input font-bold" placeholder="5000" min={0} step="0.01" />
          </div>
          <div>
            <label className="label">Customer (optional)</label>
            <select value={form.customer_id} onChange={e => setForm(p => ({ ...p, customer_id: e.target.value }))} className="input">
              <option value="">Bearer (anyone can use)</option>
              {customers.map(c => (
                <option key={String(c.id)} value={String(c.id)}>
                  {String(c.name)}{c.phone ? ` · ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Valid From</label>
            <input type="date" value={form.valid_from}
              onChange={e => setForm(p => ({ ...p, valid_from: e.target.value }))} className="input" />
          </div>
          <div>
            <label className="label">Validity</label>
            <select value={form.duration} onChange={e => setForm(p => ({ ...p, duration: e.target.value }))} className="input">
              <option value="30">1 month</option>
              <option value="90">3 months</option>
              <option value="180">6 months</option>
              <option value="365">1 year</option>
              <option value="custom">Custom date…</option>
              <option value="none">No expiry</option>
            </select>
          </div>
        </div>
        {form.duration === 'custom' && (
          <div>
            <label className="label">Valid Until</label>
            <input type="date" value={form.valid_until} min={form.valid_from}
              onChange={e => setForm(p => ({ ...p, valid_until: e.target.value }))} className="input" />
          </div>
        )}
        <div>
          <label className="label">Notes</label>
          <textarea value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
            className="input h-16 resize-none" placeholder="Optional internal notes" />
        </div>
      </div>
    </Modal>
  )
}

// ── Detail / lookup modal with full redemption history ────────────────────────
function CouponDetailModal({ coupon, canVoid, onPrint, onVoid, onClose }: {
  coupon: Record<string, unknown>
  canVoid: boolean
  onPrint: () => void
  onVoid: () => void
  onClose: () => void
}) {
  const redemptions = (coupon.redemptions as Record<string, unknown>[]) || []

  return (
    <Modal title={`Coupon ${coupon.code}`} onClose={onClose} size="lg" footer={
      <>
        <button onClick={onPrint} className="btn-secondary gap-1.5"><Printer size={14} /> Reprint Card</button>
        {canVoid && coupon.status === 'active' && (
          <button onClick={onVoid} className="btn-secondary gap-1.5 text-red-400"><Ban size={14} /> Void</button>
        )}
        <button onClick={onClose} className="btn-primary">Close</button>
      </>
    }>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-soft)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Issued To</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{String(coupon.customer_name || 'Bearer')}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-soft)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Value</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>{money(coupon.initial_value)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-soft)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Balance</p>
            <p className="text-sm font-bold text-green-400">{money(coupon.balance)}</p>
          </div>
          <div className="rounded-lg p-3" style={{ background: 'var(--bg-soft)' }}>
            <p className="text-xs" style={{ color: 'var(--text-3)' }}>Status / Expiry</p>
            <p className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
              <span className={STATUS_BADGE[String(coupon.status)] || 'badge-gray'}>{STATUS_LABEL[String(coupon.status)] || String(coupon.status)}</span>
              <span className="text-xs ml-1" style={{ color: 'var(--text-3)' }}>
                {coupon.valid_until ? String(coupon.valid_until).slice(0, 10) : 'No expiry'}
              </span>
            </p>
          </div>
        </div>

        <div>
          <h3 className="font-semibold text-sm mb-2" style={{ color: 'var(--text-1)' }}>Redemption History</h3>
          {redemptions.length === 0 ? (
            <p className="text-sm text-center py-6" style={{ color: 'var(--text-3)' }}>No redemptions yet</p>
          ) : (
            <div className="space-y-2 max-h-72 overflow-y-auto">
              {redemptions.map(r => (
                <div key={String(r.id)} className="rounded-lg border p-3" style={{ borderColor: 'var(--border)', background: 'var(--bg-soft)' }}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-mono text-xs" style={{ color: 'var(--text-2)' }}>
                      {String(r.invoice_number || '—')}
                      <span className="ml-2 text-slate-500">{String(r.created_at || '').slice(0, 16).replace('T', ' ')}</span>
                    </span>
                    <span className={`font-bold ${r.type === 'reversal' ? 'text-amber-400' : 'text-red-400'}`}>
                      {r.type === 'reversal' ? '+' : '−'}{money(Math.abs(Number(r.amount || 0)))}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs mt-1" style={{ color: 'var(--text-3)' }}>
                    <span>{String(r.branch_name || '')}{r.redeemed_by_name ? ` · ${r.redeemed_by_name}` : ''}{r.type === 'reversal' ? ' · reversal (invoice cancelled)' : ''}</span>
                    <span>Balance after: {money(r.balance_after)}</span>
                  </div>
                  {Array.isArray(r.items) && (r.items as unknown[]).length > 0 && (
                    <div className="mt-2 pt-2 border-t text-xs space-y-0.5" style={{ borderColor: 'var(--border)', color: 'var(--text-3)' }}>
                      {(r.items as Record<string, unknown>[]).map((it, i) => (
                        <div key={i} className="flex justify-between">
                          <span>{String(it.product_name || it.sku || 'Item')} × {String(it.quantity)}</span>
                          <span>{money(it.line_total)}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Modal>
  )
}
