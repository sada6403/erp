import { describe, it, expect } from 'vitest'
import {
  isSupermarketCompany,
  calculateSchemeDuration,
  validateCustomerCapacity,
  calculateWinnerProductValue,
  MAX_CUSTOMER_LIMIT_ERROR,
} from './supermarketSmartBuy'

describe('Supermarket Smart Buy Scheme — Section 13 Requirements', () => {
  // Test 1: Company Type Detection
  describe('Test 1 — Company Type Feature Activation', () => {
    it('activates custom logic ONLY for supermarket company type', () => {
      expect(isSupermarketCompany('supermarket')).toBe(true)
      expect(isSupermarketCompany('SUPERMARKET')).toBe(true)
      expect(isSupermarketCompany('retail')).toBe(false)
      expect(isSupermarketCompany('furniture')).toBe(false)
      expect(isSupermarketCompany('chit_fund')).toBe(false)
      expect(isSupermarketCompany('')).toBe(false)
      expect(isSupermarketCompany(null)).toBe(false)
    })
  })

  // Test 2: Customer Capacity Limit (Hard Cap of 100)
  describe('Test 2 — Customer Capacity Limit (Hard Cap of 100)', () => {
    const maxCapacity = 100

    it('allows registration of first 100 customers', () => {
      for (let count = 0; count < 100; count++) {
        const result = validateCustomerCapacity(count, maxCapacity)
        expect(result.allowed).toBe(true)
        expect(result.error).toBeUndefined()
      }
    })

    it('rejects 101st customer with exact error message', () => {
      const result = validateCustomerCapacity(100, maxCapacity)
      expect(result.allowed).toBe(false)
      expect(result.error).toBe(
        'This scheme has reached its maximum customer limit. Please select or create a new scheme.'
      )
      expect(result.error).toBe(MAX_CUSTOMER_LIMIT_ERROR)
    })
  })

  // Test 3: Multi-Agent Combined Limit
  describe('Test 3 — Multi-Agent Combined Limit', () => {
    const maxCapacity = 100

    it('enforces total capacity across multiple agents combined', () => {
      let totalEnrolled = 0

      // Agent A registers 60
      for (let i = 0; i < 60; i++) {
        expect(validateCustomerCapacity(totalEnrolled, maxCapacity).allowed).toBe(true)
        totalEnrolled++
      }
      expect(totalEnrolled).toBe(60)

      // Agent B registers 40
      for (let i = 0; i < 40; i++) {
        expect(validateCustomerCapacity(totalEnrolled, maxCapacity).allowed).toBe(true)
        totalEnrolled++
      }
      expect(totalEnrolled).toBe(100)

      // Agent C attempts to register 1
      const agentCResult = validateCustomerCapacity(totalEnrolled, maxCapacity)
      expect(agentCResult.allowed).toBe(false)
      expect(agentCResult.error).toBe(
        'This scheme has reached its maximum customer limit. Please select or create a new scheme.'
      )
    })
  })

  // Test 4: Weekly Scheme Winner Calculation (Toggle ON)
  describe('Test 4 — Weekly Scheme Winner Calculation (Toggle ON: 15K, 18K, 21K)', () => {
    const schemeAmount = 12000
    const isSupermarket = true
    const addWinnerPaidAmount = true

    it('Week 1: Winner paid Rs. 3,000 -> Entitlement Rs. 15,000', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 3000,
        isFinalCycle: false,
      })
      expect(value).toBe(15000)
    })

    it('Week 2: Winner paid Rs. 6,000 -> Entitlement Rs. 18,000', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 6000,
        isFinalCycle: false,
      })
      expect(value).toBe(18000)
    })

    it('Week 3: Winner paid Rs. 9,000 -> Entitlement Rs. 21,000', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 9000,
        isFinalCycle: false,
      })
      expect(value).toBe(21000)
    })
  })

  // Test 5: Winner Calculation (Toggle OFF)
  describe('Test 5 — Winner Calculation (Toggle OFF: Scheme Amount ONLY)', () => {
    const schemeAmount = 12000
    const isSupermarket = true
    const addWinnerPaidAmount = false

    it('Week 1: Entitlement is Rs. 12,000 only', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 3000,
        isFinalCycle: false,
      })
      expect(value).toBe(12000)
    })

    it('Week 2: Entitlement is Rs. 12,000 only despite Rs. 6,000 paid', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 6000,
        isFinalCycle: false,
      })
      expect(value).toBe(12000)
    })

    it('Week 3: Entitlement is Rs. 12,000 only despite Rs. 9,000 paid', () => {
      const value = calculateWinnerProductValue({
        isSupermarket,
        addWinnerPaidAmount,
        schemeAmount,
        winnerPaidAmount: 9000,
        isFinalCycle: false,
      })
      expect(value).toBe(12000)
    })
  })

  // Test 6: Final Week — All Remaining Customers Receive Scheme Amount ONLY
  describe('Test 6 — Final Week Remaining Customers (Rs. 12,000 ONLY, NOT Rs. 24,000)', () => {
    it('non-winning customers receive original scheme amount only even with toggle ON and full payments', () => {
      const schemeAmount = 12000
      const customerTotalPaid = 12000

      // In final cycle with toggle ON
      const finalValue = calculateWinnerProductValue({
        isSupermarket: true,
        addWinnerPaidAmount: true,
        schemeAmount,
        winnerPaidAmount: customerTotalPaid,
        isFinalCycle: true,
      })

      // Must be Rs. 12,000, NEVER Rs. 24,000
      expect(finalValue).toBe(12000)
      expect(finalValue).not.toBe(24000)
    })
  })

  // Test 7: Monthly Scheme with Custom Values (Rs. 50,000, Rs. 5,000, 10 Months)
  describe('Test 7 — Monthly Scheme with Custom Values (Rs. 50,000 / Rs. 5,000)', () => {
    const schemeAmount = 50000
    const contributionAmount = 5000

    it('calculates duration automatically: 10 months', () => {
      expect(calculateSchemeDuration(schemeAmount, contributionAmount)).toBe(10)
    })

    it('Month 3 winner paid Rs. 15,000 -> Entitlement Rs. 65,000', () => {
      const value = calculateWinnerProductValue({
        isSupermarket: true,
        addWinnerPaidAmount: true,
        schemeAmount,
        winnerPaidAmount: 15000,
        isFinalCycle: false,
      })
      expect(value).toBe(65000)
    })

    it('Month 10 (Final Month) customers receive Rs. 50,000 only', () => {
      const value = calculateWinnerProductValue({
        isSupermarket: true,
        addWinnerPaidAmount: true,
        schemeAmount,
        winnerPaidAmount: 50000,
        isFinalCycle: true,
      })
      expect(value).toBe(50000)
    })
  })

  // Test 8: Actual Payments vs. Assumed Installments
  describe('Test 8 — Actual Payments Summed Dynamically (Not Assumed)', () => {
    it('uses actual sum of payments when customer paid partial amounts or missed cycles', () => {
      const schemeAmount = 12000
      // In Week 2, suppose customer only paid Rs. 2,500 total (e.g. partial payments or missed 1)
      const actualPaid = 2500

      const value = calculateWinnerProductValue({
        isSupermarket: true,
        addWinnerPaidAmount: true,
        schemeAmount,
        winnerPaidAmount: actualPaid,
        isFinalCycle: false,
      })

      // Entitlement is 12,000 + 2,500 = 14,500, NOT assuming 2 * 3,000 = 6,000 (18,000)
      expect(value).toBe(14500)
      expect(value).not.toBe(18000)
    })
  })

  // Test 9: Non-Supermarket Isolation
  describe('Test 9 — Non-Supermarket Isolation (100% Untouched)', () => {
    it('preserves scheme value without adding paid amount for non-supermarket companies', () => {
      const retailValue = calculateWinnerProductValue({
        isSupermarket: false,
        addWinnerPaidAmount: true,
        schemeAmount: 12000,
        winnerPaidAmount: 6000,
        isFinalCycle: false,
      })
      expect(retailValue).toBe(12000)

      const furnitureValue = calculateWinnerProductValue({
        isSupermarket: false,
        addWinnerPaidAmount: false,
        schemeAmount: 100000,
        winnerPaidAmount: 20000,
        isFinalCycle: false,
      })
      expect(furnitureValue).toBe(100000)
    })
  })
})
