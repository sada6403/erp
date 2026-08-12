import { describe, it, expect } from 'vitest'
import { simulateSmartBuyScheme, findBreakEvenMembers, maxEarlyWinners, type ViabilityInputs } from './smartBuyViability'

// The corrected worked example (plan doc) — the user's original spec assumed
// all 50 members eventually pay the full Rs.60,000, which contradicts the
// confirmed draw-winner waiver rule (chits:draws:conduct, unchanged). This
// is the real, waiver-accurate version every figure below must match.
const BASE: ViabilityInputs = {
  monthlyPayment: 5000,
  duration: 12,
  productEntitlement: 60000,
  participants: 50,
  earlyWinners: 11,
  avgProductCost: 45000,
  commissionPct: 5,
  otherExpenses: 50000,
}

describe('simulateSmartBuyScheme — corrected 50-member / 11-early-winner example', () => {
  const result = simulateSmartBuyScheme(BASE)

  it('is valid', () => {
    expect(result.valid).toBe(true)
  })

  it('produces exactly 11 early winners and 39 final members (50 total redemptions)', () => {
    expect(result.totals.earlyRedemptions).toBe(11)
    expect(result.totals.finalRedemptions).toBe(39)
    expect(result.totals.totalRedemptions).toBe(50)
  })

  it('winner 1 paid Rs.5,000, winner 2 Rs.10,000, ... winner 11 Rs.55,000 before winning', () => {
    for (let i = 1; i <= 11; i++) {
      const row = result.cycles[i - 1]
      expect(row.winnersThisCycle).toBe(1)
      expect(row.winnerContributionSoFar).toBe(i * 5000)
    }
  })

  it('cycle 12 is the final batch settlement for the 39 remaining members', () => {
    const final = result.cycles[11]
    expect(final.isFinal).toBe(true)
    expect(final.winnersThisCycle).toBe(39)
    expect(final.participantsPaying).toBe(39)
  })

  it('expected income is Rs.2,670,000 (not the naive Rs.3,000,000)', () => {
    expect(result.totals.expectedIncome).toBe(2670000)
  })

  it('product cost is Rs.2,250,000 (50 × Rs.45,000)', () => {
    expect(result.totals.productCost).toBe(2250000)
  })

  it('commission is Rs.150,000 (50 × 5% × Rs.60,000)', () => {
    expect(result.totals.commission).toBe(150000)
  })

  it('expected profit is Rs.220,000', () => {
    expect(result.totals.expectedProfit).toBe(220000)
  })

  it('profit margin is ~8.24%', () => {
    expect(result.totals.profitMarginPct).toBeCloseTo(8.24, 1)
  })

  it('cumulative cash flow never dips negative in this example (peak cash requirement = 0, LOW risk)', () => {
    expect(result.cashFlow.peakCashRequirement).toBe(0)
    expect(result.cashFlow.riskLevel).toBe('LOW')
  })

  it('classifies as LOW_PROFIT under default thresholds (8.24% < default 15% good-margin bar)', () => {
    expect(result.status.profitability).toBe('LOW_PROFIT')
  })
})

describe('simulateSmartBuyScheme — cash flow risk when the company must front money', () => {
  it('flags HIGH risk when few members must cover an expensive early product', () => {
    const result = simulateSmartBuyScheme({
      monthlyPayment: 2000, duration: 12, productEntitlement: 24000,
      participants: 5, earlyWinners: 4, avgProductCost: 20000, commissionPct: 5, otherExpenses: 0,
    })
    expect(result.valid).toBe(true)
    // Cycle 1: 5 members pay 2000 each = 10,000 in; product cost 20,000 + 1,200 commission out.
    expect(result.cycles[0].expectedCollection).toBe(10000)
    expect(result.cycles[0].netCashFlow).toBeLessThan(0)
    expect(result.cashFlow.peakCashRequirement).toBeGreaterThan(0)
    expect(result.cashFlow.riskLevel).not.toBe('LOW')
  })

  it('a scheme can be profitable overall yet still carry cash flow risk (profitability and risk are independent signals)', () => {
    // 9 participants, 2 early winners, Rs.45,000 cost against a Rs.60,000
    // entitlement: cycles 1-2 dip cash-negative (few payers vs. the cost of
    // the early product given out), but the scheme still nets a small
    // overall profit once the 7 final members' full-term payments land.
    const result = simulateSmartBuyScheme({
      monthlyPayment: 5000, duration: 12, productEntitlement: 60000,
      participants: 9, earlyWinners: 2, avgProductCost: 45000, commissionPct: 5, otherExpenses: 0,
    })
    expect(result.valid).toBe(true)
    expect(result.totals.expectedProfit).toBe(3000)
    expect(result.cashFlow.peakCashRequirement).toBe(11000)
    expect(result.cashFlow.riskLevel).not.toBe('LOW')
  })
})

describe('simulateSmartBuyScheme — input validation', () => {
  it('rejects earlyWinners exceeding duration-1', () => {
    const result = simulateSmartBuyScheme({ ...BASE, duration: 5, earlyWinners: 5 })
    expect(result.valid).toBe(false)
    expect(result.error).toMatch(/early winners/i)
  })

  it('rejects earlyWinners exceeding participants', () => {
    const result = simulateSmartBuyScheme({ ...BASE, participants: 3, earlyWinners: 10 })
    expect(result.valid).toBe(false)
  })

  it('rejects a non-positive monthly payment', () => {
    expect(simulateSmartBuyScheme({ ...BASE, monthlyPayment: 0 }).valid).toBe(false)
  })

  it('rejects commission % outside 0-100', () => {
    expect(simulateSmartBuyScheme({ ...BASE, commissionPct: 150 }).valid).toBe(false)
    expect(simulateSmartBuyScheme({ ...BASE, commissionPct: -1 }).valid).toBe(false)
  })

  it('accepts earlyWinners = 0 (pure final-batch scheme, no early winners at all)', () => {
    const result = simulateSmartBuyScheme({ ...BASE, earlyWinners: 0 })
    expect(result.valid).toBe(true)
    expect(result.totals.earlyRedemptions).toBe(0)
    expect(result.totals.finalRedemptions).toBe(50)
    expect(result.totals.expectedIncome).toBe(50 * 5000 * 12)
  })

  it('maxEarlyWinners caps at duration-1 and at participants', () => {
    expect(maxEarlyWinners(12, 50)).toBe(11)
    expect(maxEarlyWinners(12, 5)).toBe(5)
    expect(maxEarlyWinners(1, 50)).toBe(0)
  })
})

describe('simulateSmartBuyScheme — participant sweep (30/40/50/60/70)', () => {
  it.each([30, 40, 50, 60, 70])('produces a valid, internally consistent result for %i participants', (n) => {
    const earlyWinners = Math.min(11, maxEarlyWinners(12, n))
    const result = simulateSmartBuyScheme({ ...BASE, participants: n, earlyWinners })
    expect(result.valid).toBe(true)
    expect(result.totals.totalRedemptions).toBe(n)
    expect(result.totals.earlyRedemptions).toBe(earlyWinners)
    expect(result.totals.finalRedemptions).toBe(n - earlyWinners)
    // Income must exactly equal the closed-form sum the user's own spec
    // describes (early winners' cumulative-at-win + final members' full term).
    const earlySum = Array.from({ length: earlyWinners }, (_, i) => (i + 1) * BASE.monthlyPayment).reduce((a, b) => a + b, 0)
    const finalSum = (n - earlyWinners) * BASE.duration * BASE.monthlyPayment
    expect(result.totals.expectedIncome).toBeCloseTo(earlySum + finalSum, 2)
  })
})

describe('simulateSmartBuyScheme — profitable / break-even / loss classification', () => {
  it('a scheme with cheap products and many members is clearly PROFITABLE', () => {
    const result = simulateSmartBuyScheme({
      monthlyPayment: 5000, duration: 12, productEntitlement: 60000,
      participants: 100, earlyWinners: 11, avgProductCost: 30000, commissionPct: 5, otherExpenses: 50000,
    })
    expect(result.status.profitability).toBe('PROFITABLE')
    expect(result.totals.expectedProfit).toBeGreaterThan(0)
  })

  it('a scheme priced exactly at cost lands at exactly zero profit — LOW_PROFIT, not LOSS (0% is not < the default 0% floor)', () => {
    // With avgProductCost == productEntitlement and no commission/expenses,
    // every redemption is an exact wash — profit is exactly 0.
    const result = simulateSmartBuyScheme({
      monthlyPayment: 5000, duration: 12, productEntitlement: 60000,
      participants: 50, earlyWinners: 0, avgProductCost: 60000, commissionPct: 0, otherExpenses: 0,
    })
    expect(result.totals.expectedProfit).toBe(0)
    expect(result.status.profitability).toBe('LOW_PROFIT')
  })

  it('a scheme priced even slightly above cost is a LOSS', () => {
    const result = simulateSmartBuyScheme({
      monthlyPayment: 5000, duration: 12, productEntitlement: 60000,
      participants: 50, earlyWinners: 0, avgProductCost: 60001, commissionPct: 0, otherExpenses: 0,
    })
    expect(result.totals.expectedProfit).toBeLessThan(0)
    expect(result.status.profitability).toBe('LOSS')
  })

  it('a scheme with expensive products relative to entitlement is a clear LOSS', () => {
    const result = simulateSmartBuyScheme({
      monthlyPayment: 5000, duration: 12, productEntitlement: 60000,
      participants: 50, earlyWinners: 11, avgProductCost: 65000, commissionPct: 10, otherExpenses: 200000,
    })
    expect(result.status.profitability).toBe('LOSS')
    expect(result.totals.expectedProfit).toBeLessThan(0)
  })
})

describe('simulateSmartBuyScheme — parameter variation sweeps', () => {
  it('higher commission % strictly reduces expected profit', () => {
    const low = simulateSmartBuyScheme({ ...BASE, commissionPct: 5 })
    const high = simulateSmartBuyScheme({ ...BASE, commissionPct: 10 })
    expect(high.totals.expectedProfit).toBeLessThan(low.totals.expectedProfit)
  })

  it('higher other expenses strictly reduces expected profit by exactly the delta', () => {
    const base = simulateSmartBuyScheme({ ...BASE, otherExpenses: 50000 })
    const more = simulateSmartBuyScheme({ ...BASE, otherExpenses: 150000 })
    expect(base.totals.expectedProfit - more.totals.expectedProfit).toBeCloseTo(100000, 2)
  })

  it('higher average product cost strictly reduces expected profit', () => {
    const cheap = simulateSmartBuyScheme({ ...BASE, avgProductCost: 40000 })
    const expensive = simulateSmartBuyScheme({ ...BASE, avgProductCost: 50000 })
    expect(expensive.totals.expectedProfit).toBeLessThan(cheap.totals.expectedProfit)
  })

  it('more early winners (holding participants fixed) reduces expected income, since winners contribute less than full term', () => {
    const fewEarly = simulateSmartBuyScheme({ ...BASE, earlyWinners: 2 })
    const manyEarly = simulateSmartBuyScheme({ ...BASE, earlyWinners: 11 })
    expect(manyEarly.totals.expectedIncome).toBeLessThan(fewEarly.totals.expectedIncome)
  })

  it('longer duration (same monthly payment) increases each final member\'s total contribution', () => {
    const short = simulateSmartBuyScheme({ ...BASE, duration: 12, earlyWinners: 0 })
    const long = simulateSmartBuyScheme({ ...BASE, duration: 24, earlyWinners: 0 })
    expect(long.totals.expectedIncome).toBe(short.totals.expectedIncome * 2)
  })
})

describe('findBreakEvenMembers', () => {
  it('finds the smallest participant count with non-negative expected profit for the base example', () => {
    const { minMembers, safetyBuffer, searchedUpTo } = findBreakEvenMembers(BASE)
    expect(minMembers).not.toBeNull()
    expect(searchedUpTo).toBeGreaterThanOrEqual(minMembers!)
    // Verify: minMembers-1 must NOT break even (or be the very first candidate), minMembers must.
    const at = simulateSmartBuyScheme({ ...BASE, participants: minMembers!, earlyWinners: Math.min(BASE.earlyWinners, maxEarlyWinners(BASE.duration, minMembers!)) })
    expect(at.totals.expectedProfit).toBeGreaterThanOrEqual(0)
    if (minMembers! > 1) {
      const below = simulateSmartBuyScheme({ ...BASE, participants: minMembers! - 1, earlyWinners: Math.min(BASE.earlyWinners, maxEarlyWinners(BASE.duration, minMembers! - 1)) })
      expect(below.totals.expectedProfit).toBeLessThan(0)
    }
    expect(safetyBuffer).toBe(BASE.participants - minMembers!)
  })

  it('returns a larger minMembers for a less profitable-per-member configuration', () => {
    const cheap = findBreakEvenMembers({ ...BASE, avgProductCost: 30000 })
    const expensive = findBreakEvenMembers({ ...BASE, avgProductCost: 55000 })
    expect(expensive.minMembers ?? Infinity).toBeGreaterThan(cheap.minMembers ?? 0)
  })

  it('returns null when no participant count within the search bound breaks even', () => {
    const result = findBreakEvenMembers(
      { monthlyPayment: 1000, duration: 2, productEntitlement: 60000, participants: 5, earlyWinners: 1, avgProductCost: 60000, commissionPct: 20, otherExpenses: 1000000 },
      { maxSearch: 50 }
    )
    expect(result.minMembers).toBeNull()
  })
})

describe('simulateSmartBuyScheme — voucherRedemptionRatePct (§20/§21)', () => {
  it('defaults to 100% (fully redeemed) when omitted — identical to the pre-voucher model', () => {
    const withDefault = simulateSmartBuyScheme(BASE)
    const explicit100 = simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 100 })
    expect(withDefault.totals.productCost).toBe(explicit100.totals.productCost)
    expect(withDefault.totals.expectedProfit).toBe(explicit100.totals.expectedProfit)
  })

  it('a 90% redemption rate reduces projected product cost to exactly 90% of the full-redemption figure', () => {
    const full = simulateSmartBuyScheme(BASE)
    const partial = simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 90 })
    expect(partial.totals.productCost).toBeCloseTo(full.totals.productCost * 0.9, 2)
  })

  it('does NOT scale commission — commission is paid on the full voucher value at issuance regardless of redemption rate', () => {
    const full = simulateSmartBuyScheme(BASE)
    const partial = simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 50 })
    expect(partial.totals.commission).toBe(full.totals.commission)
  })

  it('a lower redemption rate strictly increases (or leaves unchanged) expected profit, since less cost is incurred', () => {
    const full = simulateSmartBuyScheme(BASE)
    const partial = simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 50 })
    expect(partial.totals.expectedProfit).toBeGreaterThan(full.totals.expectedProfit)
  })

  it('0% redemption rate means zero product cost — pure income minus commission and expenses', () => {
    const result = simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 0 })
    expect(result.totals.productCost).toBe(0)
    expect(result.totals.expectedProfit).toBe(money(result.totals.expectedIncome - result.totals.commission - result.totals.otherExpenses))
  })

  it('rejects a rate outside 0-100', () => {
    expect(simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: 150 }).valid).toBe(false)
    expect(simulateSmartBuyScheme({ ...BASE, voucherRedemptionRatePct: -1 }).valid).toBe(false)
  })
})

function money(v: number): number {
  return Math.round((Number(v) || 0) * 100) / 100
}
