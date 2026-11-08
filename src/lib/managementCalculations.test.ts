import { describe,expect,it } from 'vitest'
import { calculatePay,calculateFinance,validatePolicy, type PayPolicy } from '../../backend/lib/management/calculations'

const policy = ():PayPolicy=>({mode:'target',basic:25000,basicEligibility:'always',basicMinimumAchievement:50,basicBelowMinimum:25000,
 targetIncentive:0,incentiveMinimumAchievement:100,commissionMinimumAchievement:50,commissionTiers:[{from:50,rate:2},{from:75,rate:3},{from:100,rate:5}],otherAllowances:0,deductions:0,
 customer:{dailyTarget:10,monthlyTarget:100,minimumValidCustomers:1,allowancePerCustomer:50,maximumMonthlyAllowance:5000,eligibleWeekdays:[0,1,2,3,4,5,6],qualification:'minimum-count'}})
const input = {eligibleSales:600000,target:1200000,customerDays:[],periodStart:'2026-11-01',periodEnd:'2026-11-30'}
describe('configurable management pay policies',()=>{
 it.each([[599999,0],[600000,12000],[899999,17999.98],[900000,27000],[1199999,35999.97],[1200000,60000]])('evaluates tier boundaries for %s', (sales,commission)=>{
  expect(calculatePay(policy(),{...input,eligibleSales:sales}).commission).toBe(commission)
 })
 it('matches the configured 50 percent achievement and 42000 salary example',()=>{
  const pay=calculatePay(policy(),{...input,customerDays:[{date:'2026-11-07',validCustomerIds:Array.from({length:100},(_,i)=>String(i))}]})
  expect(pay.achievement).toBe(50);expect(pay.commission).toBe(12000);expect(pay.net).toBe(42000)
 })
 it('does not reduce basic when the target is missed and policy says always',()=>{
  expect(calculatePay(policy(),{...input,eligibleSales:0}).basic).toBe(25000)
 })
 it('never invents targets, incentives or commissions for an unconfigured target',()=>{
  const pay=calculatePay(policy(),{...input,target:null});expect(pay.achievement).toBeNull();expect(pay.commission).toBe(0);expect(pay.targetIncentive).toBe(0)
 })
 it('supports explicit lower basic eligibility and preserves fixed manager basic',()=>{
  const p=policy();p.basicEligibility='minimum-achievement';p.basicBelowMinimum=10000
  expect(calculatePay(p,{...input,eligibleSales:1}).basic).toBe(10000)
  expect(()=>validatePolicy(p,'general_manager')).toThrow(/fixed/)
  p.mode='fixed';p.basicEligibility='always';expect(calculatePay(p,{...input,eligibleSales:0},'general_manager').basic).toBe(25000)
 })
 it('deduplicates customer identities across dates, applies working days and caps',()=>{
  const p=policy();p.customer.eligibleWeekdays=[6];p.customer.maximumMonthlyAllowance=75
  const pay=calculatePay(p,{...input,customerDays:[{date:'2026-11-07',validCustomerIds:['a','a','b']},{date:'2026-11-14',validCustomerIds:['a']},{date:'2026-11-08',validCustomerIds:['c']}]})
  expect(pay.validCustomers).toBe(2);expect(pay.customerAllowance).toBe(75)
 })
 it('applies daily and monthly qualification independently of sales',()=>{
  const p=policy();p.customer.qualification='daily-target';p.customer.dailyTarget=2
  const data={...input,eligibleSales:0,customerDays:[{date:'2026-11-07',validCustomerIds:['a','b']},{date:'2026-11-08',validCustomerIds:['c']}]}
  expect(calculatePay(p,data).customerAllowance).toBe(100)
  p.customer.qualification='monthly-target';expect(calculatePay(p,data).customerAllowance).toBe(0)
 })
 it('rejects overlapping tiers, negative values, impossible dates and excessive deductions',()=>{
  const p=policy();p.commissionTiers.push({from:100,rate:8});expect(()=>validatePolicy(p)).toThrow(/ascending/)
  expect(()=>calculatePay(policy(),{...input,periodStart:'2026-02-30'})).toThrow(/date/)
  const q=policy();q.basic=-1;expect(()=>validatePolicy(q)).toThrow()
  q.basic=0;q.basicBelowMinimum=0;q.deductions=999999;expect(()=>calculatePay(q,input)).toThrow(/Deductions/)
 })
 it('reduces commission on returned sales and clamps negative net credited sales to zero',()=>{
  expect(calculatePay(policy(),{...input,eligibleSales:500000}).commission).toBe(0)
  expect(calculatePay(policy(),{...input,eligibleSales:-100}).eligibleSales).toBe(0)
 })
})
describe('management financial calculations',()=>{
 const data={netSales:1750,cogs:1150,operatingExpenses:100,salaryExpenses:50,commissionExpenses:20,otherExpenses:0,investment:2000,principalReturned:500,unknownCostQuantity:0}
 it('separates costs, salary, commission, profit and principal recovery',()=>{
  expect(calculateFinance(data)).toMatchObject({grossProfit:600,netProfit:430,roi:21.5,outstandingInvestment:1500,complete:true})
 })
 it('does not claim ROI without investment or complete purchase costs',()=>{
  expect(calculateFinance({...data,investment:0,principalReturned:0}).roi).toBeNull()
  expect(calculateFinance({...data,unknownCostQuantity:5})).toMatchObject({roi:null,complete:false})
 })
 it('rejects unrecorded excess principal returned',()=>{
  expect(()=>calculateFinance({...data,principalReturned:3000})).toThrow(/exceeds/)
 })
})
