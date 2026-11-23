import { allowedBranches,jsonValue,ManagementError,type ManagementContext } from './access'
import { calculateFinance,money,validDate } from './calculations'
import { attributionExpression,attributionJoins } from './attribution'
type Row=Record<string,unknown>
const num=(v:unknown)=>Number(v||0)
export async function finance(ctx:ManagementContext,q:URLSearchParams){
 if(ctx.platform==='employee'&&ctx.role==='field_officer')throw new ManagementError('Financial reporting access denied',403)
 const from=validDate(q.get('from')),to=validDate(q.get('to'))
 if(to<from)throw new ManagementError('Invalid report dates')
 const allowed=await allowedBranches(ctx)
 const branch=q.get('branch'),region=q.get('region'),zone=q.get('zone')
 if(branch&&!allowed.includes(branch))throw new ManagementError('Branch outside assigned scope',403)
 const all=(await ctx.client.query<Row>('SELECT b.id,b.name,br.region_id,r.zone_id FROM branches b LEFT JOIN management_branch_regions br ON br.branch_id=b.id LEFT JOIN regions r ON r.id=br.region_id')).rows
 const branches=all.filter(b=>allowed.includes(String(b.id))&&(!branch||b.id===branch)&&(!region||b.region_id===region)&&(!zone||b.zone_id===zone))
 const companyWide=ctx.scopeType==='company'&&!branch&&!region&&!zone
 const ids=branches.map(b=>b.id)
 // Include unallocated company costs/capital only in company-wide totals.
 const scope=(column:string)=>`(${ids.length?`${column} IN (${ids.map(()=>'?').join(',')})`:'1=0'}${companyWide?` OR ${column} IS NULL`:''})`
 const date=(column:string)=>`${column}>=CONVERT_TZ(?,'+05:30','+00:00') AND ${column}<CONVERT_TZ(DATE_ADD(?,INTERVAL 1 DAY),'+05:30','+00:00')`
 async function summary(start:string){
  const sales=await ctx.client.query<Row>(`SELECT i.branch_id,COALESCE(SUM(i.subtotal),0) gross_sales,COALESCE(SUM(i.total_amount),0) total_sales,MAX(i.updated_at) last_sale
   FROM invoices i WHERE i.status NOT IN ('draft','held','cancelled') AND ${scope('i.branch_id')} AND ${date('i.created_at')} GROUP BY i.branch_id`,[...ids,start,to])
  const costs=await ctx.client.query<Row>(`SELECT a.branch_id,SUM((a.quantity-a.returned_quantity)*a.unit_selling_price) net_sales,
   SUM((a.quantity-a.returned_quantity)*a.unit_cost) cogs,SUM(CASE WHEN a.cost_known=0 THEN a.quantity-a.returned_quantity ELSE 0 END) unknown_cost
   FROM sale_batch_allocations a JOIN invoices i ON i.id=a.invoice_id WHERE i.status NOT IN ('draft','held','cancelled') AND ${scope('a.branch_id')} AND ${date('i.created_at')} GROUP BY a.branch_id`,[...ids,start,to])
  const coverage=await ctx.client.query<Row>(`SELECT COALESCE(SUM(GREATEST(ii.quantity-COALESCE(a.qty,0),0)),0) missing
   FROM invoice_items ii JOIN invoices i ON i.id=ii.invoice_id LEFT JOIN (SELECT invoice_item_id,SUM(quantity) qty FROM sale_batch_allocations GROUP BY invoice_item_id) a ON a.invoice_item_id=ii.id
   WHERE i.status NOT IN ('draft','held','cancelled','returned') AND ${scope('i.branch_id')} AND ${date('i.created_at')}`,[...ids,start,to])
  const expenses=await ctx.client.query<Row>(`SELECT e.branch_id,f.classification,SUM(e.amount) amount,COUNT(*) records FROM expenses e
   LEFT JOIN management_finance_classifications f ON f.source_type='expense' AND f.source_id=e.id
   WHERE ${scope('e.branch_id')} AND ${date('e.created_at')} AND f.payroll_id IS NULL AND f.commission_id IS NULL GROUP BY e.branch_id,f.classification`,[...ids,start,to])
  const payroll=await ctx.client.query<Row>(`SELECT p.breakdown,p.scope_type,p.scope_id FROM management_payroll p
   WHERE p.status IN ('approved','paid') AND p.period_end BETWEEN ? AND ? AND (${scope('p.scope_id')} OR (?=1 AND p.scope_type='company'))`,[start,to,...ids,companyWide?1:0])
  const legacy=await ctx.client.query<Row>(`SELECT l.branch_id,SUM(l.total_commission) amount FROM commission_ledger l
   LEFT JOIN management_finance_classifications f ON f.source_type='commission' AND f.source_id=l.id
   WHERE l.status IN ('approved','admin_approved','paid') AND ${scope('l.branch_id')} AND ${date('l.created_at')} AND f.payroll_id IS NULL GROUP BY l.branch_id`,[...ids,start,to])
  const byBranch=new Map<string,Row>()
  for(const b of branches)byBranch.set(String(b.id),{id:b.id,name:b.name,netSales:0,cogs:0,grossProfit:0,expenses:0,netProfit:0})
  let netSales=0,cogs=0,unknownCostQuantity=num(coverage.rows[0]?.missing),operatingExpenses=0,salaryExpenses=0,commissionExpenses=0,otherExpenses=0,unclassifiedExpenses=0,unallocatedPayroll=0
  for(const row of costs.rows){netSales+=num(row.net_sales);cogs+=num(row.cogs);unknownCostQuantity+=num(row.unknown_cost);const b=byBranch.get(String(row.branch_id));if(b){b.netSales=num(row.net_sales);b.cogs=num(row.cogs)}}
  for(const row of expenses.rows){
   const value=num(row.amount)
   if(!row.classification)unclassifiedExpenses+=num(row.records)
   if(row.classification==='salary')salaryExpenses+=value
   else if(row.classification==='commission')commissionExpenses+=value
   else if(row.classification==='other')otherExpenses+=value
   else operatingExpenses+=value
   const b=byBranch.get(String(row.branch_id));if(b)b.expenses=num(b.expenses)+value
  }
  for(const row of payroll.rows){
   const p=jsonValue<Row>(row.breakdown),commission=num(p.commission),salary=num(p.net)-commission
   salaryExpenses+=salary;commissionExpenses+=commission
   const b=row.scope_type==='branch'?byBranch.get(String(row.scope_id)):undefined
   if(b)b.expenses=num(b.expenses)+salary+commission;else unallocatedPayroll+=salary+commission
  }
  for(const row of legacy.rows){commissionExpenses+=num(row.amount);const b=byBranch.get(String(row.branch_id));if(b)b.expenses=num(b.expenses)+num(row.amount)}
  for(const b of byBranch.values()){b.grossProfit=money(num(b.netSales)-num(b.cogs));b.netProfit=money(num(b.grossProfit)-num(b.expenses))}
  return {netSales,cogs,unknownCostQuantity,operatingExpenses,salaryExpenses,commissionExpenses,otherExpenses,unclassifiedExpenses,unallocatedPayroll,
   totalSales:money(sales.rows.reduce((s,r)=>s+num(r.total_sales),0)),grossSales:money(sales.rows.reduce((s,r)=>s+num(r.gross_sales),0)),branches:[...byBranch.values()]}
 }
 const selected=await summary(from),cumulative=from==='1900-01-01'?selected:await summary('1900-01-01')
 const capital=(await ctx.client.query<Row>(`SELECT c.branch_id,c.transaction_type,f.classification,SUM(c.amount) amount,COUNT(*) records FROM capital_transactions c
  LEFT JOIN management_finance_classifications f ON f.source_type='capital' AND f.source_id=c.id
  WHERE ${scope('c.branch_id')} AND c.transaction_date<=? GROUP BY c.branch_id,c.transaction_type,f.classification`,[...ids,to])).rows
 let investment=0,principalReturned=0,unclassifiedWithdrawals=0
 for(const row of capital){if(row.transaction_type==='investment')investment+=num(row.amount);else if(row.classification==='principal-return')principalReturned+=num(row.amount);else if(!row.classification)unclassifiedWithdrawals+=num(row.records)}
 if(principalReturned>investment)throw new ManagementError('Recorded principal returns exceed scoped investments. Review capital classifications or include the relevant investment branch.',409)
 const period=calculateFinance({...selected,investment,principalReturned})
 const total=calculateFinance({...cumulative,investment,principalReturned})
 const people=(await ctx.client.query<Row>(`SELECT u.id,u.name,u.is_active,a.status,a.role_code,a.scope_type,a.scope_id FROM management_access a JOIN users u ON u.id=a.user_id
  WHERE a.role_code<>'director' AND (${scope('a.scope_id')} OR (?=1 AND a.scope_type='company'))`,[...ids,companyWide?1:0])).rows
 const performance=[]
 const creditedUser=await attributionExpression(ctx)
 const joins=await attributionJoins(ctx)
 const targetRows=(await ctx.client.query<Row>("SELECT user_id,SUM(amount) target FROM management_targets WHERE period_start<=? AND period_end>=? AND status='active' GROUP BY user_id",[to,from])).rows
 const targetMap=new Map(targetRows.map(t=>[String(t.user_id),num(t.target)]))
 const credited=(await ctx.client.query<Row>(`SELECT ${creditedUser} employee_id,SUM((s.quantity-s.returned_quantity)*s.unit_selling_price) sales
  FROM invoices i ${joins} JOIN sale_batch_allocations s ON s.invoice_id=i.id
  WHERE i.status NOT IN ('draft','held','cancelled') AND ${scope('i.branch_id')} AND ${date('i.created_at')}
  AND (NOT EXISTS(SELECT 1 FROM management_targets t WHERE t.user_id=${creditedUser} AND t.status='active' AND t.period_start<=? AND t.period_end>=?)
   OR EXISTS(SELECT 1 FROM management_targets t WHERE t.user_id=${creditedUser} AND t.status='active'
    AND DATE(CONVERT_TZ(i.created_at,'+00:00','+05:30')) BETWEEN t.active_from AND COALESCE(t.active_to,t.period_end)))
  GROUP BY employee_id`,[...ids,from,to,to,from])).rows
 const creditedMap=new Map(credited.map(r=>[String(r.employee_id),num(r.sales)]))
 for(const person of people){
  const target=targetMap.get(String(person.id))||0,achieved=creditedMap.get(String(person.id))||0
  performance.push({...person,target,achieved,achievement:target>0?achieved/target*100:null})
 }
 const purchase=(await ctx.client.query<Row>(`SELECT COALESCE(SUM(original_quantity*cost_price),0) cost FROM product_batches WHERE po_id IS NOT NULL AND ${scope('branch_id')} AND purchase_date BETWEEN ? AND ?`,[...ids,from,to])).rows[0]
 const complete=period.complete&&total.complete&&!selected.unclassifiedExpenses&&!cumulative.unclassifiedExpenses&&!unclassifiedWithdrawals
 return {from,to,...period,roi:complete?total.roi:null,cumulativeNetProfit:total.netProfit,complete,
  purchaseCost:num(purchase.cost),totalSales:selected.totalSales,grossSales:selected.grossSales,branches:selected.branches,capitalByBranch:capital,employees:performance,
  employeeCount:people.length,activeEmployees:people.filter(p=>Number(p.is_active)&&p.status==='active').length,totalBranches:branches.length,
  warnings:{unknownCostQuantity:total.unknownCostQuantity,unclassifiedExpenses:cumulative.unclassifiedExpenses,unclassifiedWithdrawals,unallocatedPayroll:selected.unallocatedPayroll},
  generatedAt:new Date().toISOString(),basis:'Net of tax and discounts; returns restate original sale period. Approved payroll payable recognized at month end; expenses by record date. ROI uses cumulative profit / total invested capital through end date.',
  freshness:'Central synced records only. Offline POS transactions appear after sync.'}
}
