/**
 * Supermarket Smart Buy Scheme Business Logic & Entitlement Engine
 * Implements the Master Prompt requirements for company_type === 'supermarket'.
 */

export const MAX_CUSTOMER_LIMIT_ERROR =
  'This scheme has reached its maximum customer limit. Please select or create a new scheme.'

export interface WinnerCalculationParams {
  isSupermarket: boolean
  addWinnerPaidAmount: boolean | number
  schemeAmount: number
  winnerPaidAmount: number
  isFinalCycle: boolean
}

/**
 * Validates company type feature activation.
 */
export function isSupermarketCompany(businessType?: string | null): boolean {
  return String(businessType || '').trim().toLowerCase() === 'supermarket'
}

/**
 * Calculates duration / cycle count automatically from scheme total amount and installment payment.
 */
export function calculateSchemeDuration(chitValue: number, contributionAmount: number): number {
  if (chitValue <= 0 || contributionAmount <= 0) return 0
  return Math.round(chitValue / contributionAmount)
}

/**
 * Enforces strict maximum customer capacity.
 */
export function validateCustomerCapacity(currentCount: number, maxCapacity: number): { allowed: boolean; error?: string } {
  if (maxCapacity > 0 && currentCount >= maxCapacity) {
    return { allowed: false, error: MAX_CUSTOMER_LIMIT_ERROR }
  }
  return { allowed: true }
}

/**
 * Calculates winner product purchase value based on company type, toggle setting,
 * actual payments paid, and whether it is the final cycle settlement.
 *
 * Rules:
 * 1. Non-supermarket companies: Scheme Amount ONLY.
 * 2. Final cycle: All remaining customers receive Scheme Amount ONLY (regardless of toggle).
 * 3. Supermarket with Toggle ON: Scheme Amount + Total Amount Paid by Winner.
 * 4. Supermarket with Toggle OFF: Scheme Amount ONLY.
 */
export function calculateWinnerProductValue(params: WinnerCalculationParams): number {
  const schemeAmount = Number(params.schemeAmount) || 0
  const winnerPaid = Math.max(0, Number(params.winnerPaidAmount) || 0)

  // Section 8: Final week / period customers receive original scheme amount only
  if (params.isFinalCycle) {
    return schemeAmount
  }

  // Section 1: Non-supermarket isolation - existing logic untouched
  if (!params.isSupermarket) {
    return schemeAmount
  }

  // Section 5 & 6: Supermarket dynamic calculation toggle
  if (Boolean(params.addWinnerPaidAmount)) {
    return schemeAmount + winnerPaid
  }

  return schemeAmount
}
