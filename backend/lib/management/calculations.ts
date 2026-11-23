/** Pure management calculations. Examples are tests, never production defaults. */
export type SalaryMode = 'fixed' | 'target'
export interface CommissionTier { from: number; rate: number }
export interface PayPolicy {
  mode: SalaryMode
  basic: number
  basicEligibility: 'always' | 'minimum-achievement'
  basicMinimumAchievement: number
  basicBelowMinimum: number
  targetIncentive: number
  incentiveMinimumAchievement: number
  commissionMinimumAchievement: number
  commissionTiers: CommissionTier[]
  otherAllowances: number
  deductions: number
  customer: {
    dailyTarget: number; monthlyTarget: number; minimumValidCustomers: number
    allowancePerCustomer: number; maximumMonthlyAllowance: number
    eligibleWeekdays: number[]; qualification: 'minimum-count' | 'daily-target' | 'monthly-target'
  }
}
export interface CustomerDay { date: string; validCustomerIds: string[] }
export interface PayInput {
  eligibleSales: number; target: number | null; customerDays: CustomerDay[]
  periodStart: string; periodEnd: string
}
export const money = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
export function stableJson(value:unknown):string {
  if(Array.isArray(value))return '['+value.map(stableJson).join(',')+']'
  if(value && typeof value==='object')return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,v])=>JSON.stringify(key)+':'+stableJson(v)).join(',')+'}'
  return JSON.stringify(value) ?? 'null'
}
function finite(value: unknown, name: string, max = 1e12): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new Error(`Invalid ${name}`)
  return value
}
export function validDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Invalid date')
  const parsed=new Date(value+'T00:00:00Z')
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==value)throw new Error('Invalid date')
  return value
}
export function validatePolicy(value: unknown, role?: string): PayPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Salary policy required')
  const p = value as PayPolicy
  if (!['fixed','target'].includes(p.mode) || !['always','minimum-achievement'].includes(p.basicEligibility)) throw new Error('Invalid salary eligibility')
  if (['general_manager','assistant_general_manager'].includes(role || '') && (p.mode !== 'fixed' || p.basicEligibility !== 'always')) throw new Error('General managers require a fixed basic salary independent of targets')
  for (const key of ['basic','basicMinimumAchievement','basicBelowMinimum','targetIncentive','incentiveMinimumAchievement','commissionMinimumAchievement','otherAllowances','deductions'] as const) finite(p[key],key)
  if (p.basicBelowMinimum > p.basic) throw new Error('Below-minimum basic cannot exceed basic salary')
  if (!Array.isArray(p.commissionTiers) || p.commissionTiers.length > 30) throw new Error('Invalid commission tiers')
  let last = -1
  for (const tier of p.commissionTiers) {
    finite(tier.from,'tier threshold'); finite(tier.rate,'commission percentage',100)
    if (tier.from <= last) throw new Error('Commission thresholds must be unique and ascending')
    last = tier.from
  }
  const c = p.customer
  if (!c || !Array.isArray(c.eligibleWeekdays) || new Set(c.eligibleWeekdays).size !== c.eligibleWeekdays.length || c.eligibleWeekdays.some(day=>!Number.isInteger(day)||day<0||day>6)) throw new Error('Invalid eligible working days')
  for (const key of ['dailyTarget','monthlyTarget','minimumValidCustomers','allowancePerCustomer','maximumMonthlyAllowance'] as const) finite(c[key],key)
  for (const count of [c.dailyTarget,c.monthlyTarget,c.minimumValidCustomers]) if (!Number.isInteger(count)) throw new Error('Customer targets must be whole numbers')
  if (!['minimum-count','daily-target','monthly-target'].includes(c.qualification)) throw new Error('Invalid customer qualification')
  return p
}
export function calculatePay(raw: unknown, input: PayInput, role?: string) {
  const policy = validatePolicy(raw,role)
  const start = validDate(input.periodStart), end = validDate(input.periodEnd)
  if (end < start) throw new Error('Invalid payroll period')
  if (!Number.isFinite(input.eligibleSales)) throw new Error('Invalid eligible sales')
  if (input.target != null) finite(input.target,'target')
  const sales = money(Math.max(0,input.eligibleSales))
  const achievement = input.target && input.target > 0 ? sales / input.target * 100 : null
  const basic = policy.mode === 'fixed' || policy.basicEligibility === 'always'
    ? policy.basic : achievement != null && achievement >= policy.basicMinimumAchievement ? policy.basic : policy.basicBelowMinimum
  const targetIncentive = achievement != null && achievement >= policy.incentiveMinimumAchievement ? policy.targetIncentive : 0
  const tier = achievement == null || achievement < policy.commissionMinimumAchievement ? undefined : [...policy.commissionTiers].reverse().find(t=>achievement >= t.from)
  const commissionRate = tier?.rate || 0
  const commission = money(sales * commissionRate / 100)
  const seen = new Set<string>(), daily = new Map<string,number>()
  // Sort dates first so duplicate IDs cannot earn twice, even across days.
  for (const day of [...input.customerDays].sort((a,b)=>a.date.localeCompare(b.date))) {
    const date = validDate(day.date)
    if (date < start || date > end || !policy.customer.eligibleWeekdays.includes(new Date(date+'T00:00:00Z').getUTCDay())) continue
    for (const id of day.validCustomerIds) if (id && !seen.has(id)) { seen.add(id);daily.set(date,(daily.get(date)||0)+1) }
  }
  const c = policy.customer
  let count = [...daily.values()].reduce((a,b)=>a+b,0)
  if (count < c.minimumValidCustomers || (c.qualification === 'monthly-target' && count < c.monthlyTarget)) count = 0
  else if (c.qualification === 'daily-target') count = [...daily.values()].filter(n=>n>=c.dailyTarget).reduce((a,b)=>a+b,0)
  const customerAllowance = money(Math.min(count*c.allowancePerCustomer,c.maximumMonthlyAllowance))
  const gross = money(basic+targetIncentive+commission+customerAllowance+policy.otherAllowances)
  if (policy.deductions > gross) throw new Error('Deductions exceed earned salary; review the policy')
  return { configured:true, eligibleSales:sales, target:input.target, achievement, basic:money(basic),targetIncentive:money(targetIncentive),commissionRate,commission,
    validCustomers:seen.size,eligibleCustomers:count,customerAllowance,otherAllowances:money(policy.otherAllowances),deductions:money(policy.deductions),gross,net:money(gross-policy.deductions) }
}

export interface FinancialInput {
  netSales: number; cogs: number; operatingExpenses: number; salaryExpenses: number
  commissionExpenses: number; otherExpenses: number; investment: number; principalReturned: number
  unknownCostQuantity: number
}
export function calculateFinance(input: FinancialInput) {
  for (const key of ['netSales','cogs','operatingExpenses','salaryExpenses','commissionExpenses','otherExpenses','investment','principalReturned','unknownCostQuantity'] as const) if (!Number.isFinite(input[key])) throw new Error(`Invalid ${key}`)
  for (const key of ['investment','principalReturned','unknownCostQuantity'] as const) finite(input[key],key)
  if (input.principalReturned > input.investment) throw new Error('Principal returned exceeds recorded investment')
  const grossProfit = money(input.netSales-input.cogs)
  const netProfit = money(grossProfit-input.operatingExpenses-input.salaryExpenses-input.commissionExpenses-input.otherExpenses)
  const complete = input.unknownCostQuantity === 0
  return { ...input,grossProfit,netProfit,complete,roi:complete && input.investment>0 ? netProfit/input.investment*100 : null,
    outstandingInvestment:money(input.investment-input.principalReturned) }
}
