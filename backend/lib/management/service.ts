import { randomUUID } from 'crypto'
import bcrypt from 'bcryptjs'
import { allowedBranches,audit,jsonValue,ManagementError,managementRoles,requireControl,transaction,type ManagementContext } from './access'
import { calculatePay,validatePolicy,validDate,stableJson,type CustomerDay } from './calculations'
import { finance } from './finance'
import { attributionExpression,attributionJoins } from './attribution'

type Row=Record<string,unknown>
const dateOnly=(value:unknown)=>value instanceof Date?value.toISOString().slice(0,10):String(value).slice(0,10)
const id=(value:unknown)=>{
 if(typeof value!=='string'||!value||value.length>64)throw new ManagementError('Invalid reference')
 return value
}
const amount=(value:unknown)=>{
 const n=Number(value);if(value==null||value===''||!Number.isFinite(n)||n<0||n>1e12)throw new ManagementError('Invalid amount');return Math.round(n*100)/100
}
const text=(value:unknown,max=255)=>{if(typeof value!=='string'||!value.trim()||value.length>max)throw new ManagementError('Required text is missing or too long');return value.trim()}
function period(start:unknown,end:unknown){
 const a=validDate(start),b=validDate(end)
 if(a>b||a.slice(0,7)!==b.slice(0,7)||!a.endsWith('-01')||new Date(new Date(b+'T00:00:00Z').getTime()+86400000).getUTCDate()!==1)throw new ManagementError('Select one complete calendar month')
 return {start:a,end:b}
}
export async function employee(ctx:ManagementContext,userId:string){
 const {rows}=await ctx.client.query<Row>('SELECT a.*,u.name,u.email,u.is_active FROM management_access a JOIN users u ON u.id=a.user_id WHERE a.user_id=?',[userId])
 if(!rows.length)throw new ManagementError('Management employee not found',404)
 if(ctx.platform==='employee' && ctx.userId!==userId){
  if(ctx.role==='field_officer')throw new ManagementError('Employee access denied',403)
  const branches=await allowedBranches(ctx)
  if(rows[0].scope_type!=='branch'||!branches.includes(String(rows[0].scope_id)))throw new ManagementError('Employee outside assigned scope',403)
 }
 return rows[0]
}
export async function creditedSales(ctx:ManagementContext,userId:string,start:string,end:string){
 const creditedUser=await attributionExpression(ctx)
 const joins=await attributionJoins(ctx)
 // Restates the original invoice month using its current non-cancelled net sold quantities.
 const {rows}=await ctx.client.query<Row>(`SELECT COALESCE(SUM((s.quantity-s.returned_quantity)*s.unit_selling_price),0) sales,
  COALESCE(SUM(CASE WHEN s.cost_known=0 THEN s.quantity-s.returned_quantity ELSE 0 END),0) unknown_cost
  FROM invoices i ${joins} JOIN sale_batch_allocations s ON s.invoice_id=i.id
  WHERE ${creditedUser}=? AND i.status NOT IN ('draft','held','cancelled') AND i.created_at>=CONVERT_TZ(?,'+05:30','+00:00') AND i.created_at<CONVERT_TZ(DATE_ADD(?,INTERVAL 1 DAY),'+05:30','+00:00')`,[userId,start,end])
 return Number(rows[0].sales)
}
export async function estimate(ctx:ManagementContext,userId:string,start:string,end:string){
 const access=await employee(ctx,userId)
 const p=await ctx.client.query<Row>(`SELECT * FROM management_policies WHERE role_code=? AND (user_id IS NULL OR user_id=?) AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?) ORDER BY (user_id IS NOT NULL) DESC,effective_from DESC`,[access.role_code,userId,start,end])
 if(!p.rows.length)return {configured:false,reason:'No salary policy covers this complete month'}
 if(p.rows.length>1&&p.rows[0].user_id===p.rows[1].user_id)throw new ManagementError('Overlapping salary policies; review configuration')
 const target=await ctx.client.query<Row>("SELECT * FROM management_targets WHERE user_id=? AND period_start=? AND status='active' AND active_from<=? AND (active_to IS NULL OR active_to>=?)",[userId,start,end,start])
 const activities=await ctx.client.query<Row>("SELECT activity_date,customer_id FROM management_customer_activity WHERE user_id=? AND status='valid' AND activity_date BETWEEN ? AND ? ORDER BY activity_date,customer_id",[userId,start,end])
 const dayMap=new Map<string,string[]>()
 for(const row of activities.rows){const date=dateOnly(row.activity_date);dayMap.set(date,[...(dayMap.get(date)||[]),String(row.customer_id)])}
 const customerDays:CustomerDay[]=[...dayMap].map(([date,validCustomerIds])=>({date,validCustomerIds}))
 const salesStart=target.rows.length?dateOnly(target.rows[0].active_from):start
 const salesEnd=target.rows[0]?.active_to?dateOnly(target.rows[0].active_to):end
 const result=calculatePay(jsonValue(p.rows[0].policy),{eligibleSales:await creditedSales(ctx,userId,salesStart,salesEnd),target:target.rows.length?Number(target.rows[0].amount):null,customerDays,periodStart:start,periodEnd:end},String(access.role_code))
 return {...result,policyId:p.rows[0].id,policySnapshot:jsonValue(p.rows[0].policy)}
}
export async function readManagement(ctx:ManagementContext,resource:string,query:URLSearchParams){
 if(resource==='finance')return finance(ctx,query)
 if(resource==='me')return {userId:ctx.userId,name:ctx.name,email:ctx.email,role:ctx.role,platform:ctx.platform,scopeType:ctx.scopeType,scopeId:ctx.scopeId}
 if(resource==='locations'){
  const ids=await allowedBranches(ctx)
  if(!ids.length)return {branches:[],regions:[],zones:[]}
  const branches=(await ctx.client.query<Row>(`SELECT b.id,b.name,r.id region_id,r.zone_id FROM branches b LEFT JOIN management_branch_regions br ON br.branch_id=b.id LEFT JOIN regions r ON r.id=br.region_id WHERE b.id IN (${ids.map(()=>'?').join(',')})`,ids)).rows
  const regions=(await ctx.client.query<Row>('SELECT id,name FROM regions')).rows.filter(r=>branches.some(b=>b.region_id===r.id))
  const zones=(await ctx.client.query<Row>('SELECT id,name FROM zones')).rows.filter(z=>branches.some(b=>b.zone_id===z.id))
  return {branches,regions,zones}
 }
 if(resource==='estimate'){
  const userId=ctx.platform==='employee'?ctx.userId:id(query.get('userId'))
  const dates=period(query.get('from'),query.get('to'));return estimate(ctx,userId,dates.start,dates.end)
 }
 if(resource==='payroll' && ctx.platform==='employee')return (await ctx.client.query<Row>('SELECT * FROM management_payroll WHERE user_id=? ORDER BY period_start DESC LIMIT 120',[ctx.userId])).rows
 if(resource==='targets' && ctx.platform==='employee')return (await ctx.client.query<Row>('SELECT * FROM management_targets WHERE user_id=? ORDER BY period_start DESC LIMIT 120',[ctx.userId])).rows
 if(resource==='activities' && ctx.platform==='employee')return (await ctx.client.query<Row>('SELECT a.*,c.name FROM management_customer_activity a JOIN customers c ON c.id=a.customer_id WHERE a.user_id=? ORDER BY a.activity_date DESC LIMIT 500',[ctx.userId])).rows
 requireControl(ctx)
 const queries:Record<string,string>={
  users:'SELECT u.id,u.name,u.email,u.is_active,a.role_code,a.platform,a.status,a.scope_type,a.scope_id,a.manager_user_id FROM users u LEFT JOIN management_access a ON a.user_id=u.id ORDER BY u.name LIMIT 1000',
  policies:'SELECT * FROM management_policies ORDER BY effective_from DESC LIMIT 500',
  targets:'SELECT t.*,u.name FROM management_targets t JOIN users u ON u.id=t.user_id ORDER BY period_start DESC LIMIT 1000',
  payroll:'SELECT p.*,COALESCE(u.name,p.employee_name) name FROM management_payroll p LEFT JOIN users u ON u.id=p.user_id ORDER BY period_start DESC LIMIT 1000',
  activities:'SELECT a.*,c.name,u.name employee_name FROM management_customer_activity a JOIN customers c ON c.id=a.customer_id JOIN users u ON u.id=a.user_id ORDER BY a.created_at DESC LIMIT 1000',
  audit:'SELECT id,actor_id,action,entity_id,details,created_at FROM management_audit ORDER BY created_at DESC,id DESC LIMIT 500',
  branches:'SELECT b.id,b.name,br.region_id FROM branches b LEFT JOIN management_branch_regions br ON br.branch_id=b.id WHERE b.is_active=1 ORDER BY b.name',
  regions:'SELECT id,name,zone_id FROM regions WHERE is_active=1 ORDER BY name',
  zones:'SELECT id,name FROM zones WHERE is_active=1 ORDER BY name',
  settings:'SELECT * FROM management_settings',
  expenses:'SELECT e.id,e.description,e.amount,e.branch_id,f.classification,f.payroll_id FROM expenses e LEFT JOIN management_finance_classifications f ON f.source_type=\'expense\' AND f.source_id=e.id ORDER BY e.created_at DESC LIMIT 500',
  capital:'SELECT c.*,f.classification FROM capital_transactions c LEFT JOIN management_finance_classifications f ON f.source_type=\'capital\' AND f.source_id=c.id ORDER BY c.transaction_date DESC LIMIT 500',
  sales:'SELECT i.id,i.invoice_number,i.branch_id,i.created_at,a.user_id FROM invoices i LEFT JOIN management_attributions a ON a.invoice_id=i.id WHERE i.status NOT IN (\'draft\',\'held\',\'cancelled\') ORDER BY i.created_at DESC LIMIT 500',
  commissions:'SELECT id,branch_id,total_commission,status,created_at FROM commission_ledger ORDER BY created_at DESC LIMIT 500',
 }
 if(!queries[resource])throw new ManagementError('Resource not found',404)
 return (await ctx.client.query<Row>(queries[resource])).rows
}
export async function writeManagement(ctx:ManagementContext,resource:string,body:Row){
 if(resource==='register-customer' && ctx.platform==='employee' && ctx.role==='field_officer')return registerCustomer(ctx,body)
 requireControl(ctx)
 return transaction(ctx.client,async()=>{
  // Serializes empty-range policy inserts and concurrent hierarchy/approval edits.
  await ctx.client.query("SELECT id FROM management_settings WHERE id='enabled' FOR UPDATE")
  if(resource==='access'){
   const userId=id(body.userId),role=text(body.role),status=text(body.status),scopeType=text(body.scopeType),scopeId=body.scopeId?id(body.scopeId):null
   if(!managementRoles.includes(role as typeof managementRoles[number])||!['active','inactive','suspended'].includes(status)||!['company','branch','region','zone'].includes(scopeType))throw new ManagementError('Invalid role, status or scope')
   const user=(await ctx.client.query<Row>('SELECT u.id,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=? FOR UPDATE',[userId])).rows[0]
   if(!user)throw new ManagementError('User not found',404)
   if(jsonValue<Record<string,boolean>>(user.permissions).all)throw new ManagementError('Use a dedicated management account, not the Company Admin account')
   await ctx.client.query("INSERT IGNORE INTO roles (id,name,permissions,is_system) VALUES ('management-web-only','Management Web Only','{}',1)")
   // Management platform assignment explicitly removes desktop operational privileges.
   await ctx.client.query("UPDATE users SET role_id='management-web-only' WHERE id=?",[userId])
   const scopeTables:Record<string,string>={branch:'branches',region:'regions',zone:'zones'}
   if(scopeType!=='company' && (!scopeId||!(await ctx.client.query(`SELECT id FROM ${scopeTables[scopeType]} WHERE id=? AND is_active=1`,[scopeId])).rows.length))throw new ManagementError('Select an active assigned location')
   if(role==='field_officer'&&scopeType!=='branch')throw new ManagementError('Field Officer must have a branch')
   const manager=body.managerUserId?id(body.managerUserId):null
   const visited=new Set([userId]);let cursor=manager
   while(cursor){
    if(visited.has(cursor))throw new ManagementError('Reporting hierarchy cannot contain a cycle')
    visited.add(cursor)
    const next=(await ctx.client.query<Row>('SELECT manager_user_id FROM management_access WHERE user_id=?',[cursor])).rows[0]
    if(!next)throw new ManagementError('Reporting manager not found')
    cursor=next.manager_user_id?String(next.manager_user_id):null
   }
   await ctx.client.query(`INSERT INTO management_access (user_id,role_code,platform,status,scope_type,scope_id,manager_user_id) VALUES (?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE role_code=VALUES(role_code),platform=VALUES(platform),status=VALUES(status),scope_type=VALUES(scope_type),scope_id=VALUES(scope_id),manager_user_id=VALUES(manager_user_id),session_version=session_version+1`,[userId,role,role==='director'?'director':'employee',status,scopeType,scopeId,manager])
   await ctx.client.query('UPDATE management_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL',[userId])
   await audit(ctx,'ACCESS_UPDATED',userId,{role,status,scopeType,scopeId,manager});return {userId}
  }
  if(resource==='create-user'){
   const name=text(body.name),email=text(body.email).toLowerCase(),password=text(body.password,256)
   if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||password.length<12)throw new ManagementError('Use a valid email and password of at least 12 characters')
   const existing=(await ctx.client.query<Row>('SELECT u.id,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE LOWER(u.email)=?',[email])).rows[0]
   if(existing){
    if(jsonValue<Record<string,boolean>>(existing.permissions).all)throw new ManagementError('Use a dedicated management account, not the Company Admin account')
    const existingId=String(existing.id)
    await ctx.client.query('UPDATE users SET name=?, password_hash=?, is_active=1 WHERE id=?',[name,await bcrypt.hash(password,12),existingId])
    await ctx.client.query('UPDATE management_access SET session_version=session_version+1 WHERE user_id=?',[existingId])
    await ctx.client.query('UPDATE management_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL',[existingId])
    await audit(ctx,'USER_UPDATED',existingId,{name,email})
    return {userId:existingId}
   }
   const userId=randomUUID(),roleId='management-web-only'
   await ctx.client.query("INSERT IGNORE INTO roles (id,name,permissions,is_system) VALUES (?, 'Management Web Only', '{}',1)",[roleId])
   await ctx.client.query('INSERT INTO users (id,name,email,password_hash,role_id,is_active) VALUES (?,?,?,?,?,1)',[userId,name,email,await bcrypt.hash(password,12),roleId])
   await audit(ctx,'USER_CREATED',userId,{name,email});return {userId}
  }
  if(resource==='revoke'||resource==='reset-password'||resource==='update-user'){
   const userId=id(body.userId)
   const targetUser=(await ctx.client.query<Row>('SELECT u.id,u.name,u.email,r.permissions FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?',[userId])).rows[0]
   if(!targetUser)throw new ManagementError('User not found',404)
   if(jsonValue<Record<string,boolean>>(targetUser.permissions).all)throw new ManagementError('Use a dedicated management account, not the Company Admin account')
   if(resource==='update-user'||resource==='reset-password'){
    const updates:string[]=[],params:any[]=[]
    if(body.name){updates.push('name=?');params.push(text(body.name))}
    if(body.email){
     const email=text(body.email).toLowerCase()
     if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new ManagementError('Use a valid email address')
     const dup=(await ctx.client.query<Row>('SELECT id FROM users WHERE email=? AND id!=?',[email,userId])).rows[0]
     if(dup)throw new ManagementError('Email address is already in use by another account',409)
     updates.push('email=?');params.push(email)
    }
    if(body.password){
     const password=text(body.password,256)
     if(password.length<12)throw new ManagementError('Password must have at least 12 characters')
     updates.push('password_hash=?');params.push(await bcrypt.hash(password,12))
    }
    if(updates.length){
     params.push(userId)
     await ctx.client.query(`UPDATE users SET ${updates.join(', ')} WHERE id=?`,params)
    }
   }
   await ctx.client.query('UPDATE management_access SET session_version=session_version+1 WHERE user_id=?',[userId])
   await ctx.client.query('UPDATE management_sessions SET revoked_at=NOW() WHERE user_id=? AND revoked_at IS NULL',[userId])
   await audit(ctx,resource==='revoke'?'SESSIONS_REVOKED':resource==='update-user'?'USER_UPDATED':'PASSWORD_RESET',userId);return {userId}
  }
  if(resource==='policy'){
   const role=text(body.role),from=validDate(body.from),to=body.to?validDate(body.to):null
   const userId=body.userId?id(body.userId):null
   if(userId&&(await employee(ctx,userId)).role_code!==role)throw new ManagementError('Employee role must match the policy role')
   if(!managementRoles.includes(role as typeof managementRoles[number])||role==='director'||to&&to<from)throw new ManagementError('Invalid policy role or dates')
   const policy=validatePolicy(body.policy,role)
   // Lock the role row to serialize policy inserts, including initially empty ranges.
   await ctx.client.query('SELECT user_id FROM management_access WHERE role_code=? FOR UPDATE',[role])
   const overlaps=await ctx.client.query("SELECT id FROM management_policies WHERE role_code=? AND user_id<=>? AND effective_from<=COALESCE(?,'9999-12-31') AND (effective_to IS NULL OR effective_to>=?)",[role,userId,to,from])
   if(overlaps.rows.length)throw new ManagementError('Policy dates overlap an existing version; select a new effective period')
   const policyId=randomUUID();await ctx.client.query('INSERT INTO management_policies (id,role_code,user_id,effective_from,effective_to,policy,created_by) VALUES (?,?,?,?,?,?,?)',[policyId,role,userId,from,to,JSON.stringify(policy),ctx.userId])
   await audit(ctx,'POLICY_CREATED',policyId,{role,from,to,policy});return {id:policyId}
  }
  if(resource==='target'){
   const userId=id(body.userId);await employee(ctx,userId)
   const dates=period(body.from,body.to),activeFrom=validDate(body.activeFrom),activeTo=body.activeTo?validDate(body.activeTo):null,status=text(body.status)
   if(!['active','inactive'].includes(status)||activeFrom<dates.start||activeFrom>dates.end||activeTo&&(activeTo<activeFrom||activeTo>dates.end))throw new ManagementError('Invalid target activation dates/status')
   const old=await ctx.client.query<Row>('SELECT * FROM management_targets WHERE user_id=? AND period_start=? FOR UPDATE',[userId,dates.start])
   const targetId=old.rows[0]?.id||randomUUID(),targetAmount=amount(body.amount)
   await ctx.client.query(`INSERT INTO management_targets (id,user_id,period_start,period_end,amount,active_from,active_to,status) VALUES (?,?,?,?,?,?,?,?)
    ON DUPLICATE KEY UPDATE amount=VALUES(amount),active_from=VALUES(active_from),active_to=VALUES(active_to),status=VALUES(status),revision=revision+1`,[targetId,userId,dates.start,dates.end,targetAmount,activeFrom,activeTo,status])
   await audit(ctx,'TARGET_UPDATED',String(targetId),{previous:old.rows[0]||null,next:body});return {id:targetId}
  }
  if(resource==='branch-region'){
   const branch=id(body.branchId),region=id(body.regionId)
   if(!(await ctx.client.query('SELECT id FROM branches WHERE id=?',[branch])).rows.length||!(await ctx.client.query('SELECT id FROM regions WHERE id=?',[region])).rows.length)throw new ManagementError('Location not found')
   await ctx.client.query('INSERT INTO management_branch_regions (branch_id,region_id) VALUES (?,?) ON DUPLICATE KEY UPDATE region_id=VALUES(region_id)',[branch,region])
   await audit(ctx,'BRANCH_REGION_ASSIGNED',branch,{region});return {branch}
  }
  if(resource==='attribute-sale'){
   const invoice=id(body.invoiceId),userId=id(body.userId),access=await employee(ctx,userId)
   const sale=(await ctx.client.query<Row>('SELECT id,branch_id,status FROM invoices WHERE id=? FOR UPDATE',[invoice])).rows[0]
   if(!sale||['draft','held','cancelled'].includes(String(sale.status))||access.scope_type!=='branch'||sale.branch_id!==access.scope_id)throw new ManagementError('Sale must belong to the assigned employee branch')
   // One invoice can credit one employee. Corrections require explicit audit.
   await ctx.client.query('INSERT INTO management_attributions (invoice_id,user_id,assigned_by) VALUES (?,?,?)',[invoice,userId,ctx.userId])
   await audit(ctx,'SALE_ATTRIBUTED',invoice,{userId});return {invoice}
  }
  if(resource==='verify-customer'){
   const customer=id(body.customerId),status=text(body.status)
   if(!['valid','rejected'].includes(status))throw new ManagementError('Invalid customer verification')
   const row=(await ctx.client.query<Row>('SELECT * FROM management_customer_activity WHERE customer_id=? FOR UPDATE',[customer])).rows[0]
   if(!row)throw new ManagementError('Customer activity not found',404)
   if(row.user_id===ctx.userId)throw new ManagementError('Cannot verify your own registration')
   await ctx.client.query('UPDATE management_customer_activity SET status=?,verified_by=? WHERE customer_id=?',[status,ctx.userId,customer])
   await audit(ctx,'CUSTOMER_VERIFIED',customer,{status});return {customer}
  }
  if(resource==='payroll-draft'){
   const userId=id(body.userId),dates=period(body.from,body.to)
   const calculated=await estimate(ctx,userId,dates.start,dates.end)
   if(!calculated.configured||!('policyId'in calculated))throw new ManagementError('Configure a policy covering this month first')
   const payrollId=randomUUID()
   const access=await employee(ctx,userId)
   if(!['company','branch'].includes(String(access.scope_type)))throw new ManagementError('Assign payroll costs to a branch or company scope before drafting')
   await ctx.client.query('INSERT INTO management_payroll (id,user_id,employee_name,period_start,period_end,policy_id,policy_snapshot,breakdown,scope_type,scope_id,status,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,\'draft\',?)',[payrollId,userId,access.name,dates.start,dates.end,calculated.policyId,JSON.stringify(calculated.policySnapshot),JSON.stringify(calculated),access.scope_type,access.scope_id,ctx.userId])
   await audit(ctx,'PAYROLL_DRAFTED',payrollId,{userId,from:dates.start,to:dates.end});return {id:payrollId}
  }
  if(resource==='payroll-status'){
   const payrollId=id(body.id),status=text(body.status)
   const row=(await ctx.client.query<Row>('SELECT * FROM management_payroll WHERE id=? FOR UPDATE',[payrollId])).rows[0]
   if(!row)throw new ManagementError('Payroll not found',404)
   if(ctx.userId===row.user_id)throw new ManagementError('Cannot approve/pay your own payroll')
   if(row.status==='draft'&&status==='approved'){
    const current=await estimate(ctx,String(row.user_id),dateOnly(row.period_start),dateOnly(row.period_end))
    if(stableJson(current)!==stableJson(jsonValue(row.breakdown)))throw new ManagementError('Calculation changed; discard and recreate the draft before approval')
    await ctx.client.query("UPDATE management_payroll SET status='approved',approved_by=? WHERE id=?",[ctx.userId,payrollId])
   }else if(row.status==='approved'&&status==='paid')await ctx.client.query("UPDATE management_payroll SET status='paid',paid_by=?,paid_at=NOW() WHERE id=?",[ctx.userId,payrollId])
   else if(row.status==='draft'&&status==='discard')await ctx.client.query('DELETE FROM management_payroll WHERE id=?',[payrollId])
   else throw new ManagementError('Invalid payroll transition; finalized records cannot be edited')
   await audit(ctx,'PAYROLL_'+status.toUpperCase(),payrollId);return {id:payrollId}
  }
  if(resource==='classify-finance'){
   const source=text(body.sourceType),sourceId=id(body.sourceId),classification=text(body.classification),payrollId=body.payrollId?id(body.payrollId):null,commissionId=body.commissionId?id(body.commissionId):null
   if(payrollId&&commissionId)throw new ManagementError('Link to payroll or an existing commission, not both')
   const tables:Record<string,string>={expense:'expenses',capital:'capital_transactions',commission:'commission_ledger'}
   const classes:Record<string,string[]>={expense:['operating','salary','commission','payroll','other'],capital:['principal-return','profit-distribution','other-withdrawal'],commission:['commission']}
   if(!tables[source]||!classes[source].includes(classification))throw new ManagementError('Invalid financial classification')
   const row=(await ctx.client.query<Row>(`SELECT * FROM ${tables[source]} WHERE id=?`,[sourceId])).rows[0]
   if(!row)throw new ManagementError('Financial source not found',404)
   if(classification==='payroll'&&!payrollId)throw new ManagementError('Combined payroll classification requires a linked approved payroll')
   if(source==='capital'&&row.transaction_type!=='withdrawal')throw new ManagementError('Only withdrawals require principal/distribution classification')
   if(commissionId){
    if(source!=='expense'||classification!=='commission')throw new ManagementError('Commission links require a commission expense')
    const ledger=(await ctx.client.query<Row>("SELECT * FROM commission_ledger WHERE id=? AND status IN ('approved','admin_approved','paid')",[commissionId])).rows[0]
    if(!ledger||(ledger.branch_id||null)!==(row.branch_id||null))throw new ManagementError('Approved commission and expense must have the same branch')
    const linked=(await ctx.client.query<Row>("SELECT COALESCE(SUM(e.amount),0) total FROM management_finance_classifications f JOIN expenses e ON e.id=f.source_id WHERE f.source_type='expense' AND f.commission_id=? AND f.source_id<>?",[commissionId,sourceId])).rows[0]
    if(amount(row.amount)+Number(linked.total)>Number(ledger.total_commission)+0.001)throw new ManagementError('Linked expenses exceed the recorded commission')
   }
   if(payrollId){
    const p=(await ctx.client.query<Row>("SELECT id,breakdown,scope_type,scope_id FROM management_payroll WHERE id=? AND status IN ('approved','paid')",[payrollId])).rows[0]
    if(!p||source==='capital')throw new ManagementError('Link only an existing approved payroll expense/commission')
    if(!['salary','commission','payroll'].includes(classification))throw new ManagementError('Payroll links require salary, commission or combined payroll classification')
    if((p.scope_type==='branch'?p.scope_id:null)!==(row.branch_id||null))throw new ManagementError('Payroll and source must have the same cost branch')
    const breakdown=jsonValue<Row>(p.breakdown),limit=classification==='payroll'?Number(breakdown.net):classification==='commission'?Number(breakdown.commission):Number(breakdown.net)-Number(breakdown.commission)
    const linked=(await ctx.client.query<Row>(`SELECT f.classification,SUM(e.amount) total FROM management_finance_classifications f JOIN expenses e ON f.source_type='expense' AND e.id=f.source_id WHERE f.payroll_id=? AND NOT (f.source_type=? AND f.source_id=?) GROUP BY f.classification`,[payrollId,source,sourceId])).rows
    const commissions=(await ctx.client.query<Row>(`SELECT f.classification,SUM(l.total_commission) total FROM management_finance_classifications f JOIN commission_ledger l ON f.source_type='commission' AND l.id=f.source_id WHERE f.payroll_id=? AND NOT (f.source_type=? AND f.source_id=?) GROUP BY f.classification`,[payrollId,source,sourceId])).rows
    const linkedRows=[...linked,...commissions],value=amount(row.amount??row.total_commission)
    if(value+linkedRows.reduce((sum,r)=>sum+Number(r.total),0)>Number(breakdown.net)+0.001 || value+linkedRows.filter(r=>r.classification===classification).reduce((sum,r)=>sum+Number(r.total),0)>limit+0.001)throw new ManagementError('Linked sources exceed the payroll component amount')
   }
   await ctx.client.query('INSERT INTO management_finance_classifications (source_type,source_id,classification,payroll_id,commission_id) VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE classification=VALUES(classification),payroll_id=VALUES(payroll_id),commission_id=VALUES(commission_id)',[source,sourceId,classification,payrollId,commissionId])
   await audit(ctx,'FINANCE_CLASSIFIED',sourceId,{source,classification,payrollId,commissionId});return {sourceId}
  }
  if(resource==='close-policy'){
   const policyId=id(body.id),to=validDate(body.to)
   const row=(await ctx.client.query<Row>('SELECT * FROM management_policies WHERE id=? FOR UPDATE',[policyId])).rows[0]
   if(!row||to<dateOnly(row.effective_from))throw new ManagementError('Invalid policy end date')
   const overlap=await ctx.client.query("SELECT id FROM management_policies WHERE role_code=? AND user_id<=>? AND id<>? AND effective_from<=? AND (effective_to IS NULL OR effective_to>=?)",[row.role_code,row.user_id,policyId,to,dateOnly(row.effective_from)])
   if(overlap.rows.length)throw new ManagementError('End date overlaps another salary policy')
   await ctx.client.query('UPDATE management_policies SET effective_to=? WHERE id=?',[to,policyId])
   await audit(ctx,'POLICY_CLOSED',policyId,{previous:row,to});return {id:policyId}
  }
  if(resource==='sales-credit-mode'){
   const mode=text(body.mode)
   if(!['manual','agent-link','cashier'].includes(mode))throw new ManagementError('Invalid sales credit mode')
   await ctx.client.query("INSERT INTO management_settings (id,value) VALUES ('sales-credit',?) ON DUPLICATE KEY UPDATE value=VALUES(value)",[JSON.stringify({mode})])
   await audit(ctx,'SALES_CREDIT_MODE_CHANGED',null,{mode});return {mode}
  }
  throw new ManagementError('Unknown management action',404)
 })
}
async function registerCustomer(ctx:ManagementContext,body:Row){
 if(ctx.scopeType!=='branch'||!ctx.scopeId)throw new ManagementError('Assigned branch required',403)
 const name=text(body.name),phone=text(body.phone,32).replace(/[\s()-]/g,'').replace(/^00/,'+')
 const digits=phone.replace(/^\+/,'')
 const normalized=digits.startsWith('0')&&digits.length===10?'94'+digits.slice(1):digits.length===9&&digits.startsWith('7')?'94'+digits:digits
 if(!/^\d{9,15}$/.test(normalized))throw new ManagementError('Valid mobile number required')
 return transaction(ctx.client,async()=>{
  // The management normalized-phone unique key serializes concurrent allowance claims.
  const existing=await ctx.client.query<Row>("SELECT id FROM customers WHERE REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(phone,' ',''),'-',''),'+',''),'(',''),')','') IN (?,?,?) LIMIT 1",[normalized,'0'+normalized.slice(2),normalized.slice(2)])
  if(existing.rows.length)throw new ManagementError('Customer already exists; duplicate registration does not earn allowance')
  const customerId=randomUUID()
  await ctx.client.query('INSERT INTO customers (id,branch_id,name,phone) VALUES (?,?,?,?)',[customerId,ctx.scopeId,name,normalized])
  await ctx.client.query("INSERT INTO management_customer_activity (customer_id,user_id,branch_id,activity_date,normalized_phone) VALUES (?,?,?,DATE(CONVERT_TZ(NOW(),'+00:00','+05:30')),?)",[customerId,ctx.userId,ctx.scopeId,normalized])
  await audit(ctx,'CUSTOMER_REGISTERED',customerId,{branch:ctx.scopeId});return {customerId,status:'pending'}
 })
}
