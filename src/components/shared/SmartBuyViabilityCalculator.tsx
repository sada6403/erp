import { useState } from 'react'
import NumberInput from '@/components/shared/NumberInput'
import { Calculator, AlertTriangle, TrendingUp, TrendingDown, Minus } from 'lucide-react'
import toast from 'react-hot-toast'

type Row = Record<string, unknown>
const money = (v: unknown) => Number(v || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export interface ViabilityCalculatorInitialValues {
  monthlyPayment?: number
  duration?: number
  productEntitlement?: number
  participants?: number
  earlyWinners?: number
  avgProductCost?: number
  commissionPct?: number
  otherExpenses?: number
  voucherRedemptionRatePct?: number
}

const RISK_LABEL: Record<string, string> = { LOW: '🟢 CASH FLOW RISK: LOW', MEDIUM: '🟡 CASH FLOW RISK: MEDIUM', HIGH: '🔴 CASH FLOW RISK: HIGH' }
const RISK_COLOR: Record<string, string> = { LOW: '#22c55e', MEDIUM: '#f59e0b', HIGH: '#ef4444' }
const PROFIT_COLOR: Record<string, string> = { PROFITABLE: '#22c55e', LOW_PROFIT: '#f59e0b', LOSS: '#ef4444' }

// The SmartBuy Scheme Viability Calculator — simulates the real cycle-by-
// cycle waiver-model economics (see electron/services/smartBuyViability.ts)
// before a scheme is ever created. Reused in two places: embedded inside
// ChitSchemeForm's New Scheme flow (pre-filled, with a "Use Values & Create
// Scheme" callback that only hands values back — it never creates a scheme
// itself) and standalone on its own page for ad-hoc exploration.
export default function SmartBuyViabilityCalculator({ initialValues, onUseValues }: {
  initialValues?: ViabilityCalculatorInitialValues
  onUseValues?: (values: { earlyWinners: number; avgProductCost: number; otherExpenses: number }) => void
}) {
  const [form, setForm] = useState({
    monthlyPayment: initialValues?.monthlyPayment ?? 5000,
    duration: initialValues?.duration ?? 12,
    productEntitlement: initialValues?.productEntitlement ?? 60000,
    participants: initialValues?.participants ?? 50,
    earlyWinners: initialValues?.earlyWinners ?? 11,
    avgProductCost: initialValues?.avgProductCost ?? 0,
    commissionPct: initialValues?.commissionPct ?? 0,
    otherExpenses: initialValues?.otherExpenses ?? 0,
    voucherRedemptionRatePct: initialValues?.voucherRedemptionRatePct ?? 100,
  })
  const [calculating, setCalculating] = useState(false)
  const [result, setResult] = useState<Row | null>(null)
  const [showTable, setShowTable] = useState(false)

  const num = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [k]: parseFloat(e.target.value) || 0 }))

  const naiveTotal = form.participants * form.monthlyPayment * form.duration

  const calculate = async () => {
    setCalculating(true)
    setResult(null)
    try {
      const res = await window.api.chits.viability.calculate(form)
      if (res.success) setResult(res.data)
      else toast.error(String(res.error || 'Could not calculate viability'))
    } catch (err) {
      toast.error((err as Error)?.message || 'Could not calculate viability')
    } finally {
      setCalculating(false)
    }
  }

  const simulation = result?.simulation as Row | undefined
  const breakEven = result?.breakEven as Row | undefined
  const totals = simulation?.totals as Row | undefined
  const cashFlow = simulation?.cashFlow as Row | undefined
  const status = simulation?.status as Row | undefined
  const cycles = (simulation?.cycles || []) as Row[]

  return (
    <div className="space-y-4">
      <div className="rounded-xl p-4 space-y-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--text-1)' }}>
          <Calculator size={16} /> SmartBuy Scheme Viability Calculator
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Field label="Monthly Payment (Rs.)" value={form.monthlyPayment} onChange={num('monthlyPayment')} min={1} />
          <Field label="Duration (cycles)" value={form.duration} onChange={num('duration')} min={1} />
          <Field label="Product Entitlement (Rs.)" value={form.productEntitlement} onChange={num('productEntitlement')} min={1} />
          <Field label="Expected Participants" value={form.participants} onChange={num('participants')} min={1} />
          <Field label="Early Winners" value={form.earlyWinners} onChange={num('earlyWinners')} min={0} />
          <Field label="Avg. Product Cost (Rs.)" value={form.avgProductCost} onChange={num('avgProductCost')} min={0} />
          <Field label="Agent Commission %" value={form.commissionPct} onChange={num('commissionPct')} min={0} max={100} step="0.01" />
          <Field label="Other Scheme Expenses (Rs.)" value={form.otherExpenses} onChange={num('otherExpenses')} min={0} />
          <Field label="Est. Voucher Redemption Rate %" value={form.voucherRedemptionRatePct} onChange={num('voucherRedemptionRatePct')} min={0} max={100} step="0.1" />
        </div>
        <p className="text-xs" style={{ color: 'var(--text-3)' }}>
          Winners receive a full-value POS voucher immediately — the company only incurs the actual product/inventory cost once a voucher is spent. A rate below 100% projects some vouchers staying unredeemed (still a real outstanding store-credit obligation, just not yet a cost) — use real historical voucher redemption data when available.
        </p>
        {form.monthlyPayment * form.duration !== form.productEntitlement && (
          <div className="rounded-lg p-2.5 flex items-start gap-2 text-xs" style={{ background: 'color-mix(in srgb, #f59e0b 10%, transparent)', border: '1px solid #f59e0b' }}>
            <AlertTriangle size={14} className="flex-shrink-0 mt-0.5" style={{ color: '#f59e0b' }} />
            <span style={{ color: 'var(--text-1)' }}>
              ⚠ VALUE MISMATCH — Monthly Payment × Duration = Rs.{money(form.monthlyPayment * form.duration)}, but Product Entitlement = Rs.{money(form.productEntitlement)}. Please review before creating the scheme.
            </span>
          </div>
        )}
        <button onClick={calculate} disabled={calculating} className="btn-primary btn-sm gap-1.5">
          <Calculator size={14} /> {calculating ? 'Calculating...' : 'Calculate Viability'}
        </button>
      </div>

      {result && !simulation?.valid ? (
        <div className="rounded-xl p-4 text-sm" style={{ background: 'color-mix(in srgb, #ef4444 10%, transparent)', border: '1px solid #ef4444', color: '#b91c1c' }}>
          {String(simulation?.error || 'Invalid inputs')}
        </div>
      ) : null}

      {result && simulation?.valid && totals && cashFlow && status ? (
        <div className="rounded-xl p-5 space-y-4" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)' }}>
          <div className="text-sm font-semibold uppercase tracking-wide" style={{ color: 'var(--text-3)' }}>SmartBuy Scheme Viability</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
            <Stat label="Expected Income" value={`Rs.${money(totals.expectedIncome)}`} />
            <Stat label="Expected Product Cost" value={`Rs.${money(totals.productCost)}`} />
            <Stat label="Expected Commission" value={`Rs.${money(totals.commission)}`} />
            <Stat label="Other Expenses" value={`Rs.${money(totals.otherExpenses)}`} />
          </div>
          <div className="pt-3 border-t grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm" style={{ borderColor: 'var(--border)' }}>
            <Stat label="Expected Profit" value={`Rs.${money(totals.expectedProfit)}`} color={PROFIT_COLOR[String(status.profitability)]} icon={Number(totals.expectedProfit) >= 0 ? TrendingUp : TrendingDown} />
            <Stat label="Profit Margin" value={`${Number(totals.profitMarginPct).toFixed(2)}%`} />
            <Stat label="Minimum Members (Break-even)" value={breakEven?.minMembers != null ? String(breakEven.minMembers) : 'Not found in range'} />
            <Stat label="Safety Buffer" value={breakEven?.safetyBuffer != null ? `${breakEven.safetyBuffer} members` : '—'} />
          </div>
          <div className="pt-3 border-t grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm" style={{ borderColor: 'var(--border)' }}>
            <Stat label="Expected Members" value={String(form.participants)} />
            <Stat label="Peak Cash Requirement" value={`Rs.${money(cashFlow.peakCashRequirement)}`} />
            <Stat label="Minimum Cash Balance" value={`Rs.${money(cashFlow.minimumCashBalance)}`} />
          </div>
          <div className="pt-3 border-t flex flex-wrap items-center gap-3" style={{ borderColor: 'var(--border)' }}>
            <span className="text-base font-bold" style={{ color: PROFIT_COLOR[String(status.profitability)] }}>{String(status.label)}</span>
            <span className="text-sm font-semibold" style={{ color: RISK_COLOR[String(cashFlow.riskLevel)] }}>{RISK_LABEL[String(cashFlow.riskLevel)]}</span>
          </div>
          <p className="text-xs" style={{ color: 'var(--text-3)' }}>
            {Number(totals.totalRedemptions)} total product redemptions ({Number(totals.earlyRedemptions)} early + {Number(totals.finalRedemptions)} final) — the naive Participants × Monthly × Duration figure would show Rs.{money(naiveTotal)}; this simulation's real expected income accounts for early winners paying less before their balance is waived.
          </p>

          <div className="pt-2">
            <button onClick={() => setShowTable(s => !s)} className="btn-secondary btn-sm">
              {showTable ? 'Hide' : 'Show'} Monthly Cash Flow ({cycles.length} cycles)
            </button>
          </div>

          {showTable && (
            <div className="overflow-x-auto rounded-lg" style={{ border: '1px solid var(--border)' }}>
              <table className="w-full text-xs">
                <thead>
                  <tr style={{ background: 'var(--bg-elevated)' }}>
                    {['Cycle', 'Participants Paying', 'Expected Collection', 'Winner', 'Winner Paid So Far', 'Product Value', 'Product Cost', 'Commission', 'Net Cash Flow', 'Cumulative'].map(h => (
                      <th key={h} className="px-2.5 py-2 text-left font-medium whitespace-nowrap" style={{ color: 'var(--text-3)' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {cycles.map(c => (
                    <tr key={String(c.cycle)} className="border-t" style={{ borderColor: 'var(--border)' }}>
                      <td className="px-2.5 py-1.5">{String(c.cycle)}{c.isFinal ? ' (Final)' : ''}</td>
                      <td className="px-2.5 py-1.5">{String(c.participantsPaying)}</td>
                      <td className="px-2.5 py-1.5">Rs.{money(c.expectedCollection)}</td>
                      <td className="px-2.5 py-1.5">
                        {c.isFinal ? `Final Settlement (${c.winnersThisCycle})` : Number(c.winnersThisCycle) > 0 ? `Winner ${c.cycle}` : '—'}
                      </td>
                      <td className="px-2.5 py-1.5">{c.winnerContributionSoFar != null ? `Rs.${money(c.winnerContributionSoFar)}` : '—'}</td>
                      <td className="px-2.5 py-1.5">{Number(c.productValue) > 0 ? `Rs.${money(c.productValue)}` : '—'}</td>
                      <td className="px-2.5 py-1.5">{Number(c.productCost) > 0 ? `Rs.${money(c.productCost)}` : '—'}</td>
                      <td className="px-2.5 py-1.5">{Number(c.commission) > 0 ? `Rs.${money(c.commission)}` : '—'}</td>
                      <td className="px-2.5 py-1.5" style={{ color: Number(c.netCashFlow) < 0 ? '#ef4444' : 'var(--text-1)' }}>Rs.{money(c.netCashFlow)}</td>
                      <td className="px-2.5 py-1.5 font-medium" style={{ color: Number(c.cumulativeCashFlow) < 0 ? '#ef4444' : 'var(--text-1)' }}>Rs.{money(c.cumulativeCashFlow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {onUseValues && (
            <div className="pt-2">
              <button
                onClick={() => onUseValues({ earlyWinners: form.earlyWinners, avgProductCost: form.avgProductCost, otherExpenses: form.otherExpenses })}
                className="btn-primary w-full"
              >
                Use Values &amp; Create Scheme
              </button>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function Field({ label, value, onChange, min, max, step }: {
  label: string; value: number; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; min?: number; max?: number; step?: string
}) {
  return (
    <div>
      <label className="block text-xs font-medium text-slate-400 mb-1">{label}</label>
      <NumberInput value={value} onChange={onChange} className="input" min={min} max={max} step={step} />
    </div>
  )
}

function Stat({ label, value, color, icon: Icon }: { label: string; value: string; color?: string; icon?: typeof Minus }) {
  return (
    <div>
      <div className="text-xs" style={{ color: 'var(--text-3)' }}>{label}</div>
      <div className="text-base font-semibold flex items-center gap-1" style={{ color: color || 'var(--text-1)' }}>
        {Icon && <Icon size={14} />} {value}
      </div>
    </div>
  )
}
