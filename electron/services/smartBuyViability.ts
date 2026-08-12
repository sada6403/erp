// Kept local (not imported from ipc/chits.ts, which pulls in electron/
// electron-store/xlsx at module scope) so this stays a genuinely dependency-
// free pure module — same rounding as chits.ts's money().
function money(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100
}

// SmartBuy Scheme Viability Calculator — pure simulation engine, no DB
// access. Models the REAL, confirmed business rule: a monthly-draw winner's
// remaining balance is waived (chits:draws:conduct, unchanged by this
// module) — a winner's contribution at the time of winning is only
// `winCycle × monthlyPayment`, never the full product value. This is what
// makes "expected income" less than participants × monthlyPayment × duration
// whenever earlyWinners > 0 — the core distinction this engine exists to get
// right (see the plan's corrected worked example).
//
// earlyWinners here is a pure planning/projection input — it has no
// connection to, and does not read or write, chit_schemes.early_redemption_
// count or chit_members.is_early_redemption (the separate, join_order-based
// earlyRedeem mechanism, intentionally left untouched).

export interface ViabilityInputs {
  monthlyPayment: number
  duration: number
  productEntitlement: number
  participants: number
  earlyWinners: number
  avgProductCost: number
  commissionPct: number
  otherExpenses: number
  // Voucher-based redemption model: the company issues a full-value POS
  // voucher at win/settlement time (chits:draws:conduct), but only incurs
  // the real inventory cost once (and if) the customer actually spends it.
  // Defaults to 100 (fully redeemed) so callers that don't pass this see
  // identical figures to the pre-voucher model. Commission is NOT scaled by
  // this — it's paid on the voucher's face value at issuance regardless of
  // whether/when it's ever redeemed (matches chits:draws:conduct's actual
  // commission timing).
  voucherRedemptionRatePct?: number
  // Configurable classification thresholds — never hardcoded per-call.
  goodMarginPct?: number
  minMarginPct?: number
  cashRiskPct?: number
}

export interface CycleRow {
  cycle: number
  isFinal: boolean
  participantsPaying: number
  expectedCollection: number
  winnersThisCycle: number
  winnerContributionSoFar: number | null
  productValue: number
  productCost: number
  commission: number
  netCashFlow: number
  cumulativeCashFlow: number
}

export interface ViabilityTotals {
  expectedIncome: number
  productCost: number
  commission: number
  otherExpenses: number
  expectedProfit: number
  profitMarginPct: number
  totalRedemptions: number
  earlyRedemptions: number
  finalRedemptions: number
}

export interface ViabilityCashFlow {
  peakCashRequirement: number
  minimumCashBalance: number
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'
}

export interface ViabilityStatus {
  profitability: 'PROFITABLE' | 'LOW_PROFIT' | 'LOSS'
  label: string
}

export interface ViabilityResult {
  valid: boolean
  error?: string
  cycles: CycleRow[]
  totals: ViabilityTotals
  cashFlow: ViabilityCashFlow
  status: ViabilityStatus
}

const DEFAULT_GOOD_MARGIN_PCT = 15
const DEFAULT_MIN_MARGIN_PCT = 0
const DEFAULT_CASH_RISK_PCT = 10

function emptyResult(error: string): ViabilityResult {
  return {
    valid: false, error,
    cycles: [],
    totals: {
      expectedIncome: 0, productCost: 0, commission: 0, otherExpenses: 0,
      expectedProfit: 0, profitMarginPct: 0, totalRedemptions: 0, earlyRedemptions: 0, finalRedemptions: 0,
    },
    cashFlow: { peakCashRequirement: 0, minimumCashBalance: 0, riskLevel: 'LOW' },
    status: { profitability: 'LOSS', label: 'INVALID INPUTS' },
  }
}

// The maximum valid earlyWinners for a given duration/participants pair —
// the final cycle is always a batch settlement (no "selection"), so at most
// duration-1 cycles can produce an early winner; and there can never be more
// winners than participants.
export function maxEarlyWinners(duration: number, participants: number): number {
  return Math.max(0, Math.min(Math.floor(duration) - 1, Math.floor(participants)))
}

export function simulateSmartBuyScheme(inputs: ViabilityInputs): ViabilityResult {
  const {
    monthlyPayment, duration, productEntitlement, participants, earlyWinners,
    avgProductCost, commissionPct, otherExpenses,
  } = inputs
  const voucherRedemptionRatePct = inputs.voucherRedemptionRatePct ?? 100

  const errors: string[] = []
  if (!(monthlyPayment > 0)) errors.push('Monthly payment must be greater than 0')
  if (!Number.isFinite(duration) || duration < 1) errors.push('Duration must be at least 1 cycle')
  if (!(productEntitlement > 0)) errors.push('Product entitlement must be greater than 0')
  if (!Number.isFinite(participants) || participants < 1) errors.push('Participants must be at least 1')
  if (commissionPct < 0 || commissionPct > 100) errors.push('Commission % must be between 0 and 100')
  if (avgProductCost < 0) errors.push('Average product cost cannot be negative')
  if (otherExpenses < 0) errors.push('Other expenses cannot be negative')
  if (voucherRedemptionRatePct < 0 || voucherRedemptionRatePct > 100) errors.push('Voucher redemption rate must be between 0 and 100')
  const capEarlyWinners = errors.length === 0 ? maxEarlyWinners(duration, participants) : 0
  if (errors.length === 0 && (earlyWinners < 0 || earlyWinners > capEarlyWinners)) {
    errors.push(`Early winners must be between 0 and ${capEarlyWinners} for ${duration} cycle(s) / ${participants} participant(s)`)
  }
  if (errors.length) return emptyResult(errors.join('; '))

  const commissionPerRedemption = money(productEntitlement * (commissionPct / 100))
  const cycles: CycleRow[] = []
  let cumulative = 0
  let totalIncome = 0
  let totalProductCost = 0
  let totalCommission = 0
  let totalRedemptions = 0
  let earlyRedemptions = 0

  for (let cycle = 1; cycle <= duration; cycle++) {
    const isFinal = cycle === duration
    let participantsPaying: number
    let winnersThisCycle = 0
    let winnerContributionSoFar: number | null = null

    if (isFinal) {
      // Every remaining (non-early-winner) member is batch-settled together
      // — mirrors chits:draws:conduct's isFinalCycle path exactly: no
      // "selection" happens, everyone still active redeems.
      participantsPaying = Math.max(0, participants - earlyWinners)
      winnersThisCycle = participantsPaying
    } else if (cycle <= earlyWinners) {
      // One winner drawn this cycle. Confirmed waiver rule: this winner has
      // paid every cycle up to and including this one (cycle × monthlyPayment
      // cumulative), then their remaining balance is waived — they drop out
      // of the paying pool for every cycle after this one.
      participantsPaying = Math.max(0, participants - (cycle - 1))
      winnersThisCycle = participantsPaying > 0 ? 1 : 0
      winnerContributionSoFar = winnersThisCycle > 0 ? money(cycle * monthlyPayment) : null
    } else {
      // Gap cycle (only exists when duration > earlyWinners + 1): no draw,
      // every remaining non-winner member just keeps paying.
      participantsPaying = Math.max(0, participants - earlyWinners)
      winnersThisCycle = 0
    }

    const expectedCollection = money(participantsPaying * monthlyPayment)
    const productValue = money(winnersThisCycle * productEntitlement)
    // Only the estimated redeemed share of the voucher actually costs the
    // company inventory — an unredeemed voucher is a standing store-credit
    // obligation (§25), not a cost yet. Commission stays on the FULL
    // voucher value below, unaffected by redemption rate.
    const productCost = money(winnersThisCycle * avgProductCost * (voucherRedemptionRatePct / 100))
    const commission = money(winnersThisCycle * commissionPerRedemption)
    let netCashFlow = money(expectedCollection - productCost - commission)
    // Other scheme expenses (admin/marketing/delivery/...) are modeled as an
    // upfront cost at scheme start — the conservative assumption for a peak-
    // cash-requirement estimate, rather than spreading them (which would
    // understate the cash the company needs on hand early on).
    if (cycle === 1) netCashFlow = money(netCashFlow - otherExpenses)
    cumulative = money(cumulative + netCashFlow)

    totalIncome = money(totalIncome + expectedCollection)
    totalProductCost = money(totalProductCost + productCost)
    totalCommission = money(totalCommission + commission)
    totalRedemptions += winnersThisCycle
    if (!isFinal) earlyRedemptions += winnersThisCycle

    cycles.push({
      cycle, isFinal, participantsPaying, expectedCollection, winnersThisCycle,
      winnerContributionSoFar, productValue, productCost, commission, netCashFlow,
      cumulativeCashFlow: cumulative,
    })
  }

  const finalRedemptions = totalRedemptions - earlyRedemptions
  const expectedProfit = money(totalIncome - totalProductCost - totalCommission - otherExpenses)
  const profitMarginPct = totalIncome > 0 ? money((expectedProfit / totalIncome) * 100) : 0

  const cumulativeSeries = cycles.map(c => c.cumulativeCashFlow)
  const minCumulative = cumulativeSeries.length ? Math.min(...cumulativeSeries) : 0
  const peakCashRequirement = money(Math.max(0, -minCumulative))
  const minimumCashBalance = money(minCumulative)

  const cashRiskPct = inputs.cashRiskPct ?? DEFAULT_CASH_RISK_PCT
  const riskThresholdAmount = totalIncome * (cashRiskPct / 100)
  const riskLevel: ViabilityCashFlow['riskLevel'] =
    peakCashRequirement <= 0.01 ? 'LOW' : peakCashRequirement <= riskThresholdAmount ? 'MEDIUM' : 'HIGH'

  const goodMarginPct = inputs.goodMarginPct ?? DEFAULT_GOOD_MARGIN_PCT
  const minMarginPct = inputs.minMarginPct ?? DEFAULT_MIN_MARGIN_PCT
  let profitability: ViabilityStatus['profitability']
  let label: string
  if (expectedProfit < 0 || profitMarginPct < minMarginPct) {
    profitability = 'LOSS'; label = '🔴 LOSS / DO NOT START'
  } else if (profitMarginPct < goodMarginPct) {
    profitability = 'LOW_PROFIT'; label = '🟡 LOW PROFIT / REVIEW'
  } else {
    profitability = 'PROFITABLE'; label = '🟢 PROFITABLE / SAFE TO START'
  }

  return {
    valid: true,
    cycles,
    totals: {
      expectedIncome: totalIncome, productCost: totalProductCost, commission: totalCommission,
      otherExpenses: money(otherExpenses), expectedProfit, profitMarginPct,
      totalRedemptions, earlyRedemptions, finalRedemptions,
    },
    cashFlow: { peakCashRequirement, minimumCashBalance, riskLevel },
    status: { profitability, label },
  }
}

// Smallest participant count at which the scheme breaks even (Expected
// Profit >= 0), by actually simulating each candidate count — never a
// division shortcut. earlyWinners is capped per-candidate so a low N still
// produces a valid simulation instead of an invalid-input error.
export function findBreakEvenMembers(
  baseInputs: ViabilityInputs,
  options: { maxSearch?: number } = {}
): { minMembers: number | null; safetyBuffer: number | null; searchedUpTo: number } {
  const maxSearch = Math.max(1, Math.floor(options.maxSearch ?? Math.max(baseInputs.participants * 3, 200)))
  for (let n = 1; n <= maxSearch; n++) {
    const cappedEarlyWinners = Math.max(0, Math.min(baseInputs.earlyWinners, maxEarlyWinners(baseInputs.duration, n)))
    const result = simulateSmartBuyScheme({ ...baseInputs, participants: n, earlyWinners: cappedEarlyWinners })
    if (result.valid && result.totals.expectedProfit >= 0) {
      return { minMembers: n, safetyBuffer: money(baseInputs.participants - n), searchedUpTo: maxSearch }
    }
  }
  return { minMembers: null, safetyBuffer: null, searchedUpTo: maxSearch }
}
