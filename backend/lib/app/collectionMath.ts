// Pure due / late-fee arithmetic for Smart Buy contributions, DISPLAY ONLY.
// A port of contributionQuote / cycleDueDate / computeMemberCycleBalance in electron/ipc/chits.ts (the authority: the POS
// recomputes at approval). Kept free of I/O so a parity test can run it against the POS functions.
// Deliberate difference: the due day is a calendar day with no machine-timezone shift (the POS helper builds a LOCAL midnight and
// reads it back in UTC, so on a Colombo desktop its due date is one day early; see TIMEZONE_AUDIT.md). The parity test runs the POS with TZ=UTC.

export type SchemeTerms = {
  contribution_amount: number
  start_date: string
  late_payment_days: number
  late_fee_amount: number
  frequency: string
}

export const money = (v: number): number => Math.round((Number(v) || 0) * 100) / 100

/** Cycle N's due date (YYYY-MM-DD). */
export function cycleDueDate(startDate: string, cycleNo: number, latePaymentDays: number, frequency = 'monthly'): string {
  const day = latePaymentDays > 0 ? latePaymentDays : 5
  const start = new Date(startDate)
  if (frequency === 'weekly') {
    const msPerDay = 24 * 60 * 60 * 1000
    return new Date(start.getTime() + (cycleNo - 1) * 7 * msPerDay + Math.min(day, 6) * msPerDay).toISOString().slice(0, 10)
  }
  return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + (cycleNo - 1), Math.min(day, 28))).toISOString().slice(0, 10)
}

export type CycleFigures = {
  /** SUM(amount - late_fee_applied) of approved cycle rows */
  approvedPaid: number
  /** SUM(credit_applied) of approved cycle rows */
  creditUsed: number
  /** SUM(late_fee_applied) of approved + pending_verification rows for the cycle */
  feeCharged: number
  /** SUM(amount - late_fee_applied) of pending_verification rows (display) */
  pendingPrincipal: number
}

export function quoteCycle(scheme: SchemeTerms, cycleNo: number, paidAtIso: string, f: CycleFigures, creditBalance = 0) {
  const expected = money(scheme.contribution_amount)
  const paid = money(f.approvedPaid)
  const creditUsed = money(f.creditUsed)
  const balanceDue = money(Math.max(0, expected - paid - creditUsed))
  const dueDate = cycleDueDate(scheme.start_date, cycleNo, Number(scheme.late_payment_days) || 0, scheme.frequency || 'monthly')
  const paymentDate = String(paidAtIso).slice(0, 10)
  const isLate = paymentDate > dueDate && balanceDue > 0.01
  const lateFee = isLate && Number(f.feeCharged || 0) <= 0.005 ? money(Number(scheme.late_fee_amount) || 0) : 0
  const creditUsable = money(Math.min(money(creditBalance), balanceDue))
  const cashPrincipalDue = money(Math.max(0, balanceDue - creditUsable))
  return { cycleNo, dueDate, isLate, installmentAmount: expected, paidPrincipal: paid, creditAlreadyUsed: creditUsed, balanceDue, lateFee, cashPrincipalDue, totalPayable: money(cashPrincipalDue + lateFee) }
}
