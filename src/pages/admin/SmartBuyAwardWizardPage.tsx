// SmartBuy Winner -> Product Awarding wizard.
//
// This is a guided UI wrapper around functionality that already exists and
// is already production-audited: chits:reports:winners (the winner list),
// chits:get (fresh per-member verification), products:list (the existing
// POS catalog/stock), and chits:members:recordRedemption (the single
// atomic award operation — re-verifies stock/branch/duplicate-award inside
// one DB transaction, creates the real invoice, decrements stock, computes
// commission, writes the audit log). Nothing here re-implements any of
// that; every "verification" step below is a fresh read of the same data
// recordRedemption itself re-checks at confirm time.
import { useEffect, useMemo, useRef, useState } from 'react'
import NumberInput from '@/components/shared/NumberInput'
import { useNavigate } from 'react-router-dom'
import PageHeader from '@/components/shared/PageHeader'
import Modal from '@/components/shared/Modal'
import InvoiceDetailModal from '@/components/shared/InvoiceDetailModal'
import {
  ArrowLeft, Search, CheckCircle2, AlertTriangle, Gift, Package, PartyPopper,
  ChevronRight, Wallet, ShieldCheck, RefreshCw, Ticket,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
type Step = 'scheme' | 'winner' | 'verify' | 'product' | 'confirm' | 'done'

const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// A draw/final-batch winner now receives their full entitlement as a POS
// voucher immediately (chits:draws:conduct) — nothing left for this wizard
// to do for them. Only a member who genuinely still needs a specific
// product picked against their balance (earlyRedeem, pre-voucher-model) —
// no invoice AND no voucher yet — belongs on this "pending" list.
function needsProductPick(w: Row): boolean {
  return !w.redemption_invoice_id && !w.voucher_code
}

function maskPhone(phone: unknown): string {
  const s = String(phone || '')
  if (s.length < 7) return s
  return `${s.slice(0, 3)} XXX ${s.slice(-3)}`
}

function maskNic(nic: unknown): string {
  const s = String(nic || '')
  if (s.length <= 4) return s
  return `${s.slice(0, 2)}${'X'.repeat(s.length - 4)}${s.slice(-2)}`
}

const STEPS: { key: Step; label: string }[] = [
  { key: 'scheme', label: 'Scheme' },
  { key: 'winner', label: 'Winner' },
  { key: 'verify', label: 'Verify' },
  { key: 'product', label: 'Product' },
  { key: 'confirm', label: 'Confirm' },
  { key: 'done', label: 'Complete' },
]

export default function SmartBuyAwardWizardPage() {
  const navigate = useNavigate()
  const [step, setStep] = useState<Step>('scheme')
  const [loading, setLoading] = useState(true)
  const [winners, setWinners] = useState<Row[]>([])
  const [roundKey, setRoundKey] = useState<string | null>(null)
  const [winnerSearch, setWinnerSearch] = useState('')
  const [selectedWinner, setSelectedWinner] = useState<Row | null>(null)

  // Step 3 — fresh, uncached backend read (not the Step 1/2 list data).
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState<string | null>(null)
  const [verifiedMember, setVerifiedMember] = useState<Row | null>(null)
  const [verifiedScheme, setVerifiedScheme] = useState<Row | null>(null)

  // Step 4 — product selection
  const [products, setProducts] = useState<Row[]>([])
  const [productSearch, setProductSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [selectedProductId, setSelectedProductId] = useState('')
  const [qty, setQty] = useState(1)
  const [substitutionReason, setSubstitutionReason] = useState('')
  const [customerAccepted, setCustomerAccepted] = useState(false)
  const [upgradePaymentMethod, setUpgradePaymentMethod] = useState('cash')

  const [confirmOpen, setConfirmOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [awardResult, setAwardResult] = useState<Row | null>(null)
  const [viewingInvoice, setViewingInvoice] = useState(false)
  const submittingRef = useRef(false)

  useEffect(() => { loadWinners() }, [])

  async function loadWinners() {
    setLoading(true)
    try {
      const res = await window.api.chits.reportsWinners({})
      if (res.success) setWinners(res.data || [])
      else toast.error(String(res.error || 'Failed to load winners'))
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load winners')
    } finally {
      setLoading(false)
    }
  }

  // Step 1 — group the winners report into scheme/round cards.
  const rounds = useMemo(() => {
    const map = new Map<string, Row & { total: number; pending: number; awarded: number }>()
    for (const w of winners) {
      const key = `${w.scheme_id}__${w.cycle_no}`
      let g = map.get(key)
      if (!g) {
        g = {
          key, scheme_id: w.scheme_id, scheme_name: w.scheme_name, scheme_number: w.scheme_number,
          branch_name: w.branch_name, cycle_no: w.cycle_no, draw_date: w.draw_date, chit_value: w.chit_value,
          total: 0, pending: 0, awarded: 0,
        }
        map.set(key, g)
      }
      g.total += 1
      if (needsProductPick(w)) g.pending += 1
      else g.awarded += 1
    }
    return Array.from(map.values()).sort((a, b) => String(b.draw_date || '').localeCompare(String(a.draw_date || '')))
  }, [winners])

  const roundWinners = useMemo(() => {
    if (!roundKey) return []
    const list = winners.filter(w => `${w.scheme_id}__${w.cycle_no}` === roundKey)
    if (!winnerSearch.trim()) return list
    const q = winnerSearch.trim().toLowerCase()
    return list.filter(w => String(w.winner_name || '').toLowerCase().includes(q) || String(w.winner_phone || '').includes(q))
  }, [winners, roundKey, winnerSearch])

  const selectedRound = rounds.find(r => r.key === roundKey) || null

  function goToWinnerStep(key: string) {
    setRoundKey(key)
    setWinnerSearch('')
    setStep('winner')
  }

  async function selectWinner(w: Row) {
    setSelectedWinner(w)
    setStep('verify')
    setVerifyError(null)
    setVerifiedMember(null)
    setVerifiedScheme(null)
    await runVerification(w)
  }

  // Step 3 — a fresh chits:get read (never the Step 1/2 report data), the
  // same endpoint the scheme detail page itself uses, so this can never
  // drift from what recordRedemption will re-check a moment later.
  async function runVerification(w: Row) {
    setVerifying(true)
    setVerifyError(null)
    try {
      const res = await window.api.chits.get(String(w.scheme_id))
      if (!res.success) { setVerifyError(String(res.error || 'Could not verify this winner')); return }
      const scheme = res.data?.scheme
      const member = (res.data?.members || []).find((m: Row) => m.id === w.member_id)
      if (!member) { setVerifyError('This member could not be found — they may have been removed.'); return }
      if (member.redemption_invoice_id) { setVerifyError('This member has already received an award for this round.'); return }
      if (member.voucher_code) { setVerifyError(`This member already received a full SmartBuy Voucher (${member.voucher_code}) — no product selection is needed.`); return }
      if (!member.redemption_type) { setVerifyError('This member is not currently a winner awaiting a product.'); return }
      setVerifiedMember(member)
      setVerifiedScheme(scheme)
    } catch (err: any) {
      setVerifyError(err?.message || 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  async function continueToProducts() {
    setStep('product')
    if (products.length === 0) {
      try {
        const res = await window.api.products.list({ is_active: true })
        if (res.success) setProducts(res.data || [])
        else toast.error(String(res.error || 'Failed to load products'))
      } catch (err: any) {
        toast.error(err?.message || 'Failed to load products')
      }
    }
  }

  const entitlementValue = Number(verifiedMember?.entitlement_value ?? verifiedScheme?.chit_value ?? 0)
  const schemeProductId = verifiedScheme?.product_id ? String(verifiedScheme.product_id) : ''

  const categories = useMemo(() => {
    const set = new Set<string>()
    for (const p of products) if (p.category_name) set.add(String(p.category_name))
    return Array.from(set).sort()
  }, [products])

  const scoredProducts = useMemo(() => {
    return products.map(p => {
      const unitPrice = Number(p.selling_price || 0)
      const taxRate = Number(p.tax_rate || 0)
      const total = Math.round(unitPrice * (1 + taxRate / 100) * 100) / 100
      const inStock = Number(p.stock || 0) > 0
      const diff = Math.round((total - entitlementValue) * 100) / 100
      return { ...p, _total: total, _inStock: inStock, _diff: diff } as Row & { _total: number; _inStock: boolean; _diff: number }
    })
  }, [products, entitlementValue])

  const filteredProducts = useMemo(() => {
    let list = scoredProducts
    if (categoryFilter) list = list.filter(p => p.category_name === categoryFilter)
    if (productSearch.trim()) {
      const q = productSearch.trim().toLowerCase()
      list = list.filter(p => String(p.name || '').toLowerCase().includes(q) || String(p.sku || '').toLowerCase().includes(q) || String(p.barcode || '').includes(q))
    }
    return list
  }, [scoredProducts, categoryFilter, productSearch])

  const recommendedProducts = useMemo(() => {
    return [...scoredProducts]
      .filter(p => p._inStock && p.is_active)
      .sort((a, b) => Math.abs(a._diff) - Math.abs(b._diff))
      .slice(0, 6)
  }, [scoredProducts])

  const selectedProduct = products.find(p => p.id === selectedProductId)
  const unitPrice = Number(selectedProduct?.selling_price || 0)
  const taxRate = Number(selectedProduct?.tax_rate || 0)
  const productTotal = Math.round(unitPrice * qty * (1 + taxRate / 100) * 100) / 100
  const isSubstitution = Boolean(schemeProductId && selectedProductId && schemeProductId !== selectedProductId)
  const upgradeAmount = Math.max(0, Math.round((productTotal - entitlementValue) * 100) / 100)
  const walletCreditAmount = Math.max(0, Math.round((entitlementValue - productTotal) * 100) / 100)

  function pickProduct(id: string) {
    setSelectedProductId(id)
    setQty(1)
    setSubstitutionReason('')
    setCustomerAccepted(false)
    setUpgradePaymentMethod('cash')
    setStep('confirm')
  }

  const canConfirm = Boolean(selectedProductId)
    && (!isSubstitution || (substitutionReason.trim() && customerAccepted))
    && (upgradeAmount === 0 || Boolean(upgradePaymentMethod))

  async function submitAward() {
    if (submittingRef.current || !verifiedMember) return
    submittingRef.current = true
    setSaving(true)
    try {
      const res = await window.api.chits.members.recordRedemption(String(verifiedMember.id), {
        product_id: selectedProductId, qty,
        ...(isSubstitution ? { substitution_reason: substitutionReason.trim(), customer_accepted: customerAccepted } : {}),
        ...(upgradeAmount > 0 ? { upgrade_payment_method: upgradePaymentMethod } : {}),
      })
      if (res.success) {
        setAwardResult(res.data)
        setConfirmOpen(false)
        setStep('done')
        toast.success('Product awarded successfully')
      } else {
        toast.error(String(res.error || 'Failed to record the award'))
        setConfirmOpen(false)
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to record the award')
      setConfirmOpen(false)
    } finally {
      submittingRef.current = false
      setSaving(false)
    }
  }

  function startOver() {
    setStep('scheme')
    setRoundKey(null)
    setSelectedWinner(null)
    setVerifiedMember(null)
    setVerifiedScheme(null)
    setSelectedProductId('')
    setAwardResult(null)
    loadWinners()
  }

  const stepIndex = STEPS.findIndex(s => s.key === step)

  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Award Product to Winner"
        subtitle="Scheme → Winner → Verify → Product → Confirm → Complete"
        actions={step !== 'scheme' && step !== 'done' ? (
          <button onClick={() => navigate('/admin/smart-buy')} className="btn-ghost btn-sm">Cancel</button>
        ) : undefined}
      />

      {/* Step indicator */}
      <div className="flex items-center gap-1 px-5 py-3 flex-shrink-0 overflow-x-auto" style={{ borderBottom: '1px solid var(--border)' }}>
        {STEPS.map((s, i) => (
          <div key={s.key} className="flex items-center gap-1 flex-shrink-0">
            <div
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium"
              style={{
                background: i === stepIndex ? 'var(--brand-primary)' : i < stepIndex ? 'color-mix(in srgb, var(--brand-primary) 18%, transparent)' : 'var(--bg-elevated)',
                color: i === stepIndex ? '#fff' : i < stepIndex ? 'var(--brand-primary)' : 'var(--text-3)',
              }}
            >
              <span className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]" style={{ background: 'rgba(255,255,255,0.2)' }}>
                {i < stepIndex ? '✓' : i + 1}
              </span>
              {s.label}
            </div>
            {i < STEPS.length - 1 && <ChevronRight size={14} style={{ color: 'var(--text-3)' }} />}
          </div>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {/* STEP 1 — Scheme / Round */}
        {step === 'scheme' && (
          <div className="space-y-4 max-w-4xl mx-auto">
            <p className="text-sm" style={{ color: 'var(--text-2)' }}>Select a scheme round with winners awaiting a product.</p>
            {loading ? (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--text-3)' }}>Loading winners...</div>
            ) : rounds.length === 0 ? (
              <div className="text-center py-16 text-sm" style={{ color: 'var(--text-3)' }}>No winners found. Conduct a draw first.</div>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                {rounds.map(r => (
                  <button
                    key={r.key as string}
                    onClick={() => goToWinnerStep(r.key as string)}
                    disabled={r.pending === 0}
                    className="text-left rounded-xl p-4 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}
                  >
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold" style={{ color: 'var(--text-1)' }}>{String(r.scheme_name)}</span>
                      <span className="text-xs" style={{ color: 'var(--text-3)' }}>{String(r.scheme_number)}</span>
                    </div>
                    <div className="text-xs mb-2" style={{ color: 'var(--text-2)' }}>Round #{String(r.cycle_no)} · {String(r.branch_name || '—')}</div>
                    <div className="flex items-center justify-between text-sm">
                      <span style={{ color: 'var(--text-2)' }}>Prize Value: <strong style={{ color: 'var(--text-1)' }}>Rs.{money(r.chit_value)}</strong></span>
                      <span
                        className="px-2 py-0.5 rounded-full text-xs font-medium"
                        style={{
                          background: r.pending > 0 ? 'color-mix(in srgb, #f59e0b 18%, transparent)' : 'color-mix(in srgb, #22c55e 18%, transparent)',
                          color: r.pending > 0 ? '#f59e0b' : '#22c55e',
                        }}
                      >
                        {r.pending > 0 ? `${r.pending} awaiting product` : 'All awarded'}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* STEP 2 — Select Winner */}
        {step === 'winner' && selectedRound && (
          <div className="max-w-3xl mx-auto space-y-4">
            <button onClick={() => setStep('scheme')} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}><ArrowLeft size={13} /> Back to schemes</button>
            <div>
              <div className="font-semibold" style={{ color: 'var(--text-1)' }}>{String(selectedRound.scheme_name)} — Round #{String(selectedRound.cycle_no)}</div>
              <div className="text-xs" style={{ color: 'var(--text-3)' }}>Prize Value: Rs.{money(selectedRound.chit_value)}</div>
            </div>
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
              <input value={winnerSearch} onChange={e => setWinnerSearch(e.target.value)} placeholder="Search member..." className="input pl-9" />
            </div>
            <div className="space-y-2">
              {roundWinners.map((w, i) => {
                const alreadyAwarded = !needsProductPick(w)
                return (
                  <div key={String(w.member_id || i)} className="flex items-center justify-between rounded-lg p-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                    <div className="min-w-0">
                      <div className="font-medium text-sm" style={{ color: 'var(--text-1)' }}>{String(w.winner_name || '—')}</div>
                      <div className="text-xs" style={{ color: 'var(--text-3)' }}>{maskPhone(w.winner_phone)} · {String(w.branch_name || '—')}</div>
                    </div>
                    {alreadyAwarded ? (
                      <span className="text-xs px-2.5 py-1 rounded-full font-medium" style={{ background: 'color-mix(in srgb, #22c55e 18%, transparent)', color: '#22c55e' }}>
                        {w.voucher_code ? `✓ Voucher Issued (${String(w.voucher_code)})` : '✓ Already Awarded'}
                      </span>
                    ) : (
                      <button onClick={() => selectWinner(w)} className="btn-primary btn-sm">Select Winner</button>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* STEP 3 — Verify Winner */}
        {step === 'verify' && selectedWinner && (
          <div className="max-w-lg mx-auto space-y-4">
            {verifying ? (
              <div className="text-center py-16 text-sm flex flex-col items-center gap-2" style={{ color: 'var(--text-3)' }}>
                <RefreshCw size={20} className="animate-spin" />
                Verifying winner against live records...
              </div>
            ) : verifyError ? (
              <div className="rounded-xl p-5 text-center space-y-3" style={{ background: 'color-mix(in srgb, #ef4444 10%, transparent)', border: '1px solid #ef4444' }}>
                <AlertTriangle size={28} className="mx-auto" style={{ color: '#ef4444' }} />
                <p className="text-sm" style={{ color: 'var(--text-1)' }}>{verifyError}</p>
                <div className="flex justify-center gap-2">
                  <button onClick={() => setStep('winner')} className="btn-secondary btn-sm">Back</button>
                  <button onClick={() => runVerification(selectedWinner)} className="btn-primary btn-sm">Retry</button>
                </div>
              </div>
            ) : verifiedMember && verifiedScheme ? (
              <div className="rounded-xl p-5 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: '#22c55e' }}><ShieldCheck size={18} /> Winner Verified</div>
                <dl className="text-sm space-y-2">
                  <Row2 label="Member" value={String(verifiedMember.customer_name || '—')} />
                  <Row2 label="Phone" value={maskPhone(verifiedMember.customer_phone)} />
                  <Row2 label="Scheme" value={String(verifiedScheme.name)} />
                  <Row2 label="Round" value={`#${String(verifiedMember.won_cycle_no ?? '—')}`} />
                  <Row2 label="Prize Value" value={`Rs.${money(entitlementValue)}`} />
                  <Row2 label="Branch" value={String(verifiedMember.enrolled_branch_name || '—')} />
                  <Row2 label="Eligibility" value="✓ Verified" good />
                  <Row2 label="Payment Status" value="✓ Fully settled (a precondition of winning)" good />
                </dl>
                <div className="flex justify-between gap-2 pt-2">
                  <button onClick={() => setStep('winner')} className="btn-secondary btn-sm">Back</button>
                  <button onClick={continueToProducts} className="btn-primary btn-sm">Continue to Product Selection</button>
                </div>
              </div>
            ) : null}
          </div>
        )}

        {/* STEP 4 — Product Selection */}
        {step === 'product' && verifiedMember && (
          <div className="max-w-5xl mx-auto space-y-4">
            <button onClick={() => setStep('verify')} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}><ArrowLeft size={13} /> Back</button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-sm" style={{ color: 'var(--text-2)' }}>Winner: <strong style={{ color: 'var(--text-1)' }}>{String(verifiedMember.customer_name)}</strong></div>
                <div className="text-sm" style={{ color: 'var(--text-2)' }}>Prize Value: <strong style={{ color: 'var(--text-1)' }}>Rs.{money(entitlementValue)}</strong></div>
              </div>
              <div className="flex gap-2">
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--text-3)' }} />
                  <input value={productSearch} onChange={e => setProductSearch(e.target.value)} placeholder="Search product..." className="input pl-9 w-48" />
                </div>
                <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)} className="input w-40">
                  <option value="">All Categories</option>
                  {categories.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            {!productSearch && !categoryFilter && recommendedProducts.length > 0 && (
              <div>
                <div className="flex items-center gap-1.5 text-xs font-semibold mb-2" style={{ color: '#f59e0b' }}><Gift size={14} /> RECOMMENDED PRODUCTS</div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {recommendedProducts.map(p => <ProductCard key={String(p.id)} p={p} onSelect={() => pickProduct(String(p.id))} />)}
                </div>
              </div>
            )}

            <div>
              <div className="text-xs font-semibold mb-2" style={{ color: 'var(--text-3)' }}>ALL AVAILABLE PRODUCTS</div>
              {filteredProducts.length === 0 ? (
                <div className="text-center py-10 text-sm" style={{ color: 'var(--text-3)' }}>No products match.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {filteredProducts.map(p => <ProductCard key={String(p.id)} p={p} onSelect={() => pickProduct(String(p.id))} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* STEP 5 — Confirm Award */}
        {step === 'confirm' && verifiedMember && verifiedScheme && selectedProduct && (
          <div className="max-w-lg mx-auto space-y-4">
            <button onClick={() => setStep('product')} className="flex items-center gap-1 text-xs" style={{ color: 'var(--text-3)' }}><ArrowLeft size={13} /> Back</button>
            <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <div className="text-sm font-semibold" style={{ color: 'var(--text-1)' }}>Award Summary</div>
              <dl className="text-sm space-y-2">
                <Row2 label="Winner" value={`${String(verifiedMember.customer_name)}`} />
                <Row2 label="Scheme" value={`${String(verifiedScheme.name)} — Round #${String(verifiedMember.won_cycle_no ?? '—')}`} />
                <Row2 label="Product" value={String(selectedProduct.name)} />
              </dl>
              <div className="pt-2 border-t" style={{ borderColor: 'var(--border)' }}>
                <div className="flex justify-between text-sm py-1"><span style={{ color: 'var(--text-2)' }}>Prize Value</span><span style={{ color: 'var(--text-1)' }}>Rs.{money(entitlementValue)}</span></div>
                <div className="flex justify-between text-sm py-1"><span style={{ color: 'var(--text-2)' }}>Product Value ({qty}x)</span><span style={{ color: 'var(--text-1)' }}>Rs.{money(productTotal)}</span></div>
                <div className="flex justify-between text-sm py-1 font-semibold"><span style={{ color: 'var(--text-2)' }}>Difference</span><span style={{ color: 'var(--text-1)' }}>Rs.{money(Math.abs(productTotal - entitlementValue))}</span></div>
              </div>
              <div><label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-3)' }}>Quantity</label><NumberInput min={1} value={qty} onChange={e => setQty(Math.max(1, parseInt(e.target.value) || 1))} className="input w-24" /></div>
              {upgradeAmount > 0 && (
                <div className="rounded-lg border p-3 text-xs space-y-2" style={{ borderColor: '#f59e0b', background: 'color-mix(in srgb, #f59e0b 10%, transparent)' }}>
                  <p style={{ color: 'var(--text-1)' }}>⚠ Additional Rs.{money(upgradeAmount)} required — collected now as part of this same award (not a loan/installment).</p>
                  <div>
                    <label className="block font-medium mb-1" style={{ color: 'var(--text-3)' }}>Upgrade payment method *</label>
                    <select value={upgradePaymentMethod} onChange={e => setUpgradePaymentMethod(e.target.value)} className="input">
                      <option value="cash">Cash</option>
                      <option value="card">Card</option>
                      <option value="bank_transfer">Bank Transfer</option>
                    </select>
                  </div>
                </div>
              )}
              {walletCreditAmount > 0 && (
                <div className="rounded-lg border p-3 text-xs flex gap-2" style={{ borderColor: 'var(--brand-primary)', background: 'color-mix(in srgb, var(--brand-primary) 8%, transparent)' }}>
                  <Ticket size={16} className="flex-shrink-0" style={{ color: 'var(--brand-primary)' }} />
                  <p style={{ color: 'var(--text-1)' }}>Rs.{money(walletCreditAmount)} is within the prize value — the remainder is auto-issued to the customer as a SmartBuy Voucher.</p>
                </div>
              )}
              {isSubstitution && (
                <div className="rounded-lg border p-3 text-xs space-y-2" style={{ borderColor: '#ef4444', background: 'color-mix(in srgb, #ef4444 8%, transparent)' }}>
                  <p style={{ color: 'var(--text-1)' }}>This differs from the scheme's own product — a reason and customer acceptance are required.</p>
                  <textarea value={substitutionReason} onChange={e => setSubstitutionReason(e.target.value)} className="input h-16 resize-none" placeholder="e.g. original product out of stock" />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={customerAccepted} onChange={e => setCustomerAccepted(e.target.checked)} className="w-4 h-4" />
                    <span style={{ color: 'var(--text-2)' }}>Customer has accepted this substituted product</span>
                  </label>
                </div>
              )}
              <ul className="text-xs space-y-1" style={{ color: '#22c55e' }}>
                <li>✓ Winner verified</li><li>✓ Eligibility verified</li><li>✓ Product available</li><li>✓ Branch verified</li>
              </ul>
              <button onClick={() => setConfirmOpen(true)} disabled={!canConfirm} className="btn-primary w-full">Confirm Product Award</button>
            </div>
          </div>
        )}

        {/* STEP 6 — Success */}
        {step === 'done' && awardResult && verifiedMember && selectedProduct && (
          <div className="max-w-md mx-auto text-center space-y-4 py-8">
            <PartyPopper size={40} className="mx-auto" style={{ color: '#22c55e' }} />
            <div className="text-lg font-bold" style={{ color: 'var(--text-1)' }}>Product Awarded Successfully</div>
            <div className="rounded-xl p-4 text-left text-sm space-y-2" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
              <Row2 label="Winner" value={String(verifiedMember.customer_name)} />
              <Row2 label="Product" value={String(selectedProduct.name)} />
              <Row2 label="Scheme" value={String(verifiedScheme?.name || '—')} />
              <Row2 label="Award Reference" value={String(awardResult.invoiceNumber || '—')} />
            </div>
            {Boolean(awardResult.voucherCode) && (
              <div className="rounded-xl p-4 text-left text-sm space-y-1.5" style={{ background: 'color-mix(in srgb, var(--brand-primary) 10%, transparent)', border: '1px solid var(--brand-primary)' }}>
                <div className="flex items-center gap-2 font-semibold" style={{ color: 'var(--text-1)' }}>
                  <Ticket size={16} style={{ color: 'var(--brand-primary)' }} />
                  ✓ Rs.{money(awardResult.voucherBalance)} SmartBuy Voucher Created
                </div>
                <Row2 label="Voucher Number" value={String(awardResult.voucherCode)} />
                <Row2 label="Voucher Balance" value={`Rs.${money(awardResult.voucherBalance)}`} />
              </div>
            )}
            <div className="flex flex-col gap-2">
              <button onClick={() => setViewingInvoice(true)} className="btn-primary flex items-center justify-center gap-1.5"><Package size={14} /> View Award / Print Receipt</button>
              <button onClick={startOver} className="btn-secondary">Award Another Winner</button>
              <button onClick={() => navigate('/admin/smart-buy')} className="btn-ghost">Back to SmartBuy</button>
            </div>
          </div>
        )}
      </div>

      {confirmOpen && selectedProduct && verifiedMember && (
        <Modal
          title="Confirm Product Award?"
          onClose={() => !saving && setConfirmOpen(false)}
          footer={<>
            <button onClick={() => setConfirmOpen(false)} disabled={saving} className="btn-secondary">Cancel</button>
            <button onClick={submitAward} disabled={saving} className="btn-primary">{saving ? 'Awarding...' : 'Confirm Award'}</button>
          </>}
        >
          <p className="text-sm" style={{ color: 'var(--text-2)' }}>
            You are about to assign <strong style={{ color: 'var(--text-1)' }}>{String(selectedProduct.name)}</strong> to{' '}
            <strong style={{ color: 'var(--text-1)' }}>{String(verifiedMember.customer_name)}</strong>. This creates an invoice and updates stock — it cannot be undone from here (Super Admin can reverse it afterward if needed).
          </p>
        </Modal>
      )}

      {viewingInvoice && Boolean(awardResult?.invoiceId) && (
        <InvoiceDetailModal invoiceId={String(awardResult?.invoiceId)} onClose={() => setViewingInvoice(false)} />
      )}
    </div>
  )
}

function Row2({ label, value, good }: { label: string; value: string; good?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: 'var(--text-3)' }}>{label}</dt>
      <dd className="text-right font-medium" style={{ color: good ? '#22c55e' : 'var(--text-1)' }}>{value}</dd>
    </div>
  )
}

function ProductCard({ p, onSelect }: { p: Row & { _total: number; _inStock: boolean; _diff: number }; onSelect: () => void }) {
  return (
    <div className="rounded-lg p-3 space-y-1.5" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
      <div className="font-medium text-sm truncate" style={{ color: 'var(--text-1)' }}>{String(p.name)}</div>
      <div className="text-sm" style={{ color: 'var(--text-1)' }}>Rs.{money(p._total)}</div>
      <div className="flex items-center gap-1.5 text-xs">
        {p._inStock
          ? <span style={{ color: '#22c55e' }}>✓ In Stock ({Number(p.stock)})</span>
          : <span style={{ color: '#ef4444' }}>✕ Out of Stock</span>}
      </div>
      <div className="text-xs" style={{ color: p._diff > 0 ? '#f59e0b' : 'var(--text-3)' }}>
        {p._diff > 0 ? `Additional Rs.${money(p._diff)} required` : p._diff < 0 ? `Rs.${money(Math.abs(p._diff))} to Wallet credit` : 'Exact match'}
      </div>
      <button onClick={onSelect} disabled={!p._inStock} className="btn-primary btn-sm w-full mt-1 disabled:opacity-50 disabled:cursor-not-allowed">Select</button>
    </div>
  )
}
