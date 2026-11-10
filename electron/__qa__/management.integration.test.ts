import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import { createRequire } from 'module'
import { spawnSync } from 'child_process'
import bcrypt from 'bcryptjs'
import { calculatePay,type PayPolicy } from '../../backend/lib/management/calculations'

const state=vi.hoisted(()=>({client:null as any,schema:'',companyId:'management-test-company'}))
vi.mock('../../backend/lib/db',()=>({
 pool:{query:async(_sql:string,args:string[])=>({rows:args[0]===state.companyId||args[0]==='management-test'?[{id:state.companyId,db_schema:state.schema}]:[]})},
 tenantPool:()=>({connect:async()=>state.client}),
}))
import { authorize,login,ManagementError,type ManagementContext } from '../../backend/lib/management/access'
import { estimate,readManagement,writeManagement } from '../../backend/lib/management/service'
import { finance } from '../../backend/lib/management/finance'

const suite=process.env.MANAGEMENT_MYSQL_TEST==='1'?describe:describe.skip
suite('management against a disposable local MySQL test database',()=>{
 let connection:any,admin:ManagementContext
 const policy:PayPolicy={mode:'target',basic:25000,basicEligibility:'always',basicMinimumAchievement:50,basicBelowMinimum:25000,targetIncentive:0,incentiveMinimumAchievement:100,commissionMinimumAchievement:50,commissionTiers:[{from:50,rate:2},{from:100,rate:5}],otherAllowances:0,deductions:0,customer:{dailyTarget:10,monthlyTarget:100,minimumValidCustomers:1,allowancePerCustomer:50,maximumMonthlyAllowance:5000,eligibleWeekdays:[0,1,2,3,4,5,6],qualification:'minimum-count'}}
 const req=(token:string,method='GET',bodyOrigin?:string)=>({method,url:'http://localhost/api/management/me',headers:new Headers({Authorization:'Bearer '+token,...(bodyOrigin?{origin:bodyOrigin}:{})}),cookies:{get:()=>undefined}}) as any
 beforeAll(async()=>{
  const env=Object.fromEntries(fs.readFileSync(path.resolve('backend/.env'),'utf8').split(/\r?\n/).filter(l=>l&&!l.startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(),l.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}))
  const url=env.DATABASE_URL?new URL(env.DATABASE_URL):null
  const host=url?.hostname||env.MYSQL_HOST||'127.0.0.1'
  if(!['localhost','127.0.0.1','::1'].includes(host))throw new Error('Management QA only permits a local MySQL server')
  const cfg={host,port:Number(url?.port||env.MYSQL_PORT||3306),user:url?.username||env.MYSQL_USER,password:url?.password||env.MYSQL_PASSWORD,timezone:'+00:00'}
  const mysql=createRequire(path.resolve('backend/package.json'))('mysql2/promise')
  connection=await mysql.createConnection(cfg)
  state.schema='pos_erp_management_test_'+randomBytes(6).toString('hex')
  await connection.query(`CREATE DATABASE \`${state.schema}\``)
  // Backup before the first schema change, even though this test DB is new/empty.
  const backupDir=path.resolve('tmp/management-qa');fs.mkdirSync(backupDir,{recursive:true})
  const backup=path.join(backupDir,state.schema+'.sql')
  const dump=spawnSync('C:/Program Files/MySQL/MySQL Server 8.0/bin/mysqldump.exe',[`--host=${host}`,`--port=${cfg.port}`,`--user=${cfg.user}`,'--single-transaction',state.schema],{env:{...process.env,MYSQL_PWD:cfg.password},windowsHide:true,encoding:'utf8'})
  if(dump.status!==0||!dump.stdout)throw new Error('Test backup failed; refusing to migrate')
  fs.writeFileSync(backup,dump.stdout)
  await connection.query(`USE \`${state.schema}\``)
  state.client={release(){},async query(sql:string,values?:unknown[]){const [rows]=await connection.query(sql,values);return {rows}}}
  const tables=[
   'CREATE TABLE roles(id CHAR(36) PRIMARY KEY,name VARCHAR(100) UNIQUE,permissions JSON,is_system BOOLEAN DEFAULT 0)',
   'CREATE TABLE users(id CHAR(36) PRIMARY KEY,name VARCHAR(255),email VARCHAR(255) UNIQUE,password_hash VARCHAR(255),role_id CHAR(36),branch_id CHAR(36),is_active BOOLEAN DEFAULT 1)',
   'CREATE TABLE zones(id CHAR(36) PRIMARY KEY,name VARCHAR(100),is_active BOOLEAN DEFAULT 1)',
   'CREATE TABLE regions(id CHAR(36) PRIMARY KEY,name VARCHAR(100),zone_id CHAR(36),is_active BOOLEAN DEFAULT 1)',
   'CREATE TABLE branches(id CHAR(36) PRIMARY KEY,name VARCHAR(100),is_active BOOLEAN DEFAULT 1)',
   'CREATE TABLE agents(id CHAR(36) PRIMARY KEY,user_id CHAR(36))',
   'CREATE TABLE customers(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),name VARCHAR(255),phone VARCHAR(32))',
   'CREATE TABLE invoices(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),cashier_id CHAR(36),agent_id CHAR(36),status VARCHAR(20),subtotal DECIMAL(14,2),total_amount DECIMAL(14,2),created_at DATETIME,updated_at DATETIME)',
   'CREATE TABLE invoice_items(id CHAR(36) PRIMARY KEY,invoice_id CHAR(36),quantity DECIMAL(14,2))',
   'CREATE TABLE sale_batch_allocations(id CHAR(36) PRIMARY KEY,invoice_id CHAR(36),invoice_item_id CHAR(36),branch_id CHAR(36),quantity DECIMAL(14,2),returned_quantity DECIMAL(14,2),unit_selling_price DECIMAL(14,2),unit_cost DECIMAL(14,2),cost_known BOOLEAN)',
   'CREATE TABLE product_batches(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),po_id CHAR(36),original_quantity DECIMAL(14,2),cost_price DECIMAL(14,2),purchase_date DATE)',
   'CREATE TABLE expenses(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),description TEXT,amount DECIMAL(14,2),created_at DATETIME)',
   'CREATE TABLE capital_transactions(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),transaction_type VARCHAR(20),transaction_date DATE,amount DECIMAL(14,2))',
   'CREATE TABLE commission_ledger(id CHAR(36) PRIMARY KEY,branch_id CHAR(36),total_commission DECIMAL(14,2),status VARCHAR(20),created_at DATETIME)',
  ]
  for(const sql of tables)await connection.query(sql)
  const migration=fs.readFileSync(path.resolve('backend/database/migrate-007-management.sql'),'utf8')
  // Repeat the migration to verify idempotent DDL.
  for(let run=0;run<2;run++)for(const sql of migration.split(';').map(s=>s.trim()).filter(Boolean))await connection.query(sql)
  await connection.query("INSERT INTO management_settings VALUES ('enabled','true')")
  await connection.query("INSERT INTO roles VALUES ('owner','Company Admin','{\"all\":true}',1),('staff','Cashier','{}',0)")
  const hash=await bcrypt.hash('management-qa-only-password',4)
  for(const [user,role]of [['owner','owner'],['fo','staff'],['director','staff']])await connection.query('INSERT INTO users (id,name,email,password_hash,role_id) VALUES (?,?,?,?,?)',[user,user,user+'@qa.test',hash,role])
  await connection.query("INSERT INTO zones VALUES ('z','Zone',1);".replace(/;$/,''))
  await connection.query("INSERT INTO regions VALUES ('r','Region','z',1)")
  await connection.query("INSERT INTO branches VALUES ('b','Branch',1),('other','Other Branch',1)")
  admin={companyId:state.companyId,userId:'owner',platform:'control',role:'admin',scopeType:'company',scopeId:null,client:state.client}
  await writeManagement(admin,'access',{userId:'fo',role:'field_officer',status:'active',scopeType:'branch',scopeId:'b'})
  await writeManagement(admin,'access',{userId:'director',role:'director',status:'active',scopeType:'branch',scopeId:'b'})
  await writeManagement(admin,'policy',{role:'field_officer',from:'2026-11-01',to:'2026-11-30',policy})
  await writeManagement(admin,'target',{userId:'fo',from:'2026-11-01',to:'2026-11-30',amount:1200000,activeFrom:'2026-11-01',status:'active'})
  await connection.query("INSERT INTO invoices VALUES ('sale','b','owner',NULL,'completed',600000,600000,'2026-11-07 09:00:00','2026-11-07 09:00:00')")
  await connection.query("INSERT INTO invoice_items VALUES ('line','sale',10)")
  await connection.query("INSERT INTO sale_batch_allocations VALUES ('allocation','sale','line','b',10,0,60000,40000,1)")
  await writeManagement(admin,'attribute-sale',{invoiceId:'sale',userId:'fo'})
 },60000)
 afterAll(async()=>{
  if(connection){if(/^pos_erp_management_test_[a-f0-9]{12}$/.test(state.schema))await connection.query(`DROP DATABASE \`${state.schema}\``);await connection.end()}
 })
 it('computes actual credited sales and dynamic commission using real MySQL',async()=>{
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({achievement:50,commission:12000,net:37000})
 })
 it('requires a policy and does not invent one for another month',async()=>{
  expect(await estimate(admin,'fo','2026-12-01','2026-12-31')).toMatchObject({configured:false})
 })
 it('rejects duplicate sale credit, overlapping policies and reporting cycles',async()=>{
  await expect(writeManagement(admin,'attribute-sale',{invoiceId:'sale',userId:'fo'})).rejects.toBeTruthy()
  await expect(writeManagement(admin,'policy',{role:'field_officer',from:'2026-11-15',policy})).rejects.toThrow(/overlap/)
  await expect(writeManagement(admin,'access',{userId:'fo',role:'field_officer',status:'active',scopeType:'branch',scopeId:'b',managerUserId:'fo'})).rejects.toThrow(/cycle/)
 })
 it('validates Director platform and rejects operational writes and other employee data',async()=>{
  const auth=await login('management-test','director@qa.test','management-qa-only-password','director')
  const ctx=await authorize(req(auth.token))
  expect(ctx.platform).toBe('director')
  await expect(writeManagement(ctx,'target',{})).rejects.toThrow(/POS management/)
  await expect(login('management-test','director@qa.test','management-qa-only-password','control')).rejects.toThrow(/Platform/)
  const fo=await login('management-test','fo@qa.test','management-qa-only-password','employee'),foCtx=await authorize(req(fo.token))
  await expect(readManagement(foCtx,'users',new URLSearchParams())).rejects.toThrow(/POS management/)
  await expect(finance(foCtx,new URLSearchParams({from:'2026-11-01',to:'2026-11-30'}))).rejects.toThrow(/denied/)
 })
 it('revokes already-issued sessions immediately after deactivate/reactivate and explicit revoke',async()=>{
  const auth=await login('management-test','director@qa.test','management-qa-only-password','director')
  await writeManagement(admin,'access',{userId:'director',role:'director',status:'inactive',scopeType:'branch',scopeId:'b'})
  await expect(authorize(req(auth.token))).rejects.toBeInstanceOf(ManagementError)
  await expect(login('management-test','director@qa.test','management-qa-only-password','director')).rejects.toThrow(/denied/)
  await writeManagement(admin,'access',{userId:'director',role:'director',status:'active',scopeType:'branch',scopeId:'b'})
  const next=await login('management-test','director@qa.test','management-qa-only-password','director')
  await writeManagement(admin,'revoke',{userId:'director'})
  await expect(authorize(req(next.token))).rejects.toThrow(/expired|revoked/)
 })
 it('applies role/platform changes and password resets to already-issued sessions',async()=>{
  const before=await login('management-test','director@qa.test','management-qa-only-password','director')
  await writeManagement(admin,'access',{userId:'director',role:'field_officer',status:'active',scopeType:'branch',scopeId:'b'})
  await expect(authorize(req(before.token))).rejects.toThrow(/expired|revoked/)
  await expect(login('management-test','director@qa.test','management-qa-only-password','director')).rejects.toThrow(/Platform/)
  await writeManagement(admin,'access',{userId:'director',role:'director',status:'active',scopeType:'branch',scopeId:'b'})
  const next=await login('management-test','director@qa.test','management-qa-only-password','director')
  await writeManagement(admin,'reset-password',{userId:'director',password:'replacement-qa-only-password'})
  await expect(authorize(req(next.token))).rejects.toThrow(/expired|revoked/)
  await expect(login('management-test','director@qa.test','management-qa-only-password','director')).rejects.toThrow(/Invalid credentials/)
  expect((await login('management-test','director@qa.test','replacement-qa-only-password','director')).userId).toBe('director')
  await writeManagement(admin,'reset-password',{userId:'director',password:'management-qa-only-password'})
 })
 it('does not allow forged branch filters or cookie writes without matching origin',async()=>{
  const auth=await login('management-test','director@qa.test','management-qa-only-password','director'),ctx=await authorize(req(auth.token))
  await expect(finance(ctx,new URLSearchParams({from:'2026-11-01',to:'2026-11-30',branch:'other'}))).rejects.toThrow(/scope/)
  await expect(authorize({method:'POST',url:'http://localhost/api/management/logout',headers:new Headers({origin:'https://attacker.invalid'}),cookies:{get:()=>({value:auth.token})}} as any)).rejects.toThrow(/origin/)
 })
 it('restates returns, keeps salary history immutable and detects changed drafts',async()=>{
  const drafted=await writeManagement(admin,'payroll-draft',{userId:'fo',from:'2026-11-01',to:'2026-11-30'}) as any
  await connection.query("UPDATE sale_batch_allocations SET returned_quantity=2 WHERE id='allocation'")
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({eligibleSales:480000,commission:0})
  await expect(writeManagement(admin,'payroll-status',{id:drafted.id,status:'approved'})).rejects.toThrow(/changed/)
  await writeManagement(admin,'payroll-status',{id:drafted.id,status:'discard'})
  await connection.query("UPDATE sale_batch_allocations SET returned_quantity=0 WHERE id='allocation'")
  const next=await writeManagement(admin,'payroll-draft',{userId:'fo',from:'2026-11-01',to:'2026-11-30'}) as any
  await writeManagement(admin,'payroll-status',{id:next.id,status:'approved'})
  await writeManagement(admin,'payroll-status',{id:next.id,status:'paid'})
  await expect(writeManagement(admin,'payroll-status',{id:next.id,status:'discard'})).rejects.toThrow(/finalized/)
  await expect(writeManagement(admin,'payroll-draft',{userId:'fo',from:'2026-11-01',to:'2026-11-30'})).rejects.toBeTruthy()
 })
 it('registers real customers once, prevents self validation and requires verified activity',async()=>{
  const auth=await login('management-test','fo@qa.test','management-qa-only-password','employee'),foCtx=await authorize(req(auth.token))
  const customer=await writeManagement(foCtx,'register-customer',{name:'Test Customer',phone:'0771234567'}) as any
  await expect(writeManagement(foCtx,'register-customer',{name:'Duplicate',phone:'+94771234567'})).rejects.toThrow(/already exists/)
  await expect(writeManagement(foCtx,'verify-customer',{customerId:customer.customerId,status:'valid'})).rejects.toThrow(/POS management/)
  await writeManagement(admin,'verify-customer',{customerId:customer.customerId,status:'valid'})
  await connection.query("UPDATE management_customer_activity SET activity_date='2026-11-07' WHERE customer_id=?",[customer.customerId])
  expect((await connection.query('SELECT COUNT(*) n FROM customers'))[0][0].n).toBe(1)
 })
 it('reconciles finance, prevents fake ROI and counts linked payroll expenses once',async()=>{
  await connection.query("INSERT INTO capital_transactions VALUES ('investment','b','investment','2026-11-01',1000000),('withdrawal','b','withdrawal','2026-11-05',10000)")
  await connection.query("INSERT INTO expenses VALUES ('salary-expense','b','Salary',37000,'2026-11-30 09:00:00')")
  let report=await finance(admin,new URLSearchParams({from:'2026-11-01',to:'2026-11-30'}))
  expect(report.roi).toBeNull();expect(report.warnings.unclassifiedExpenses).toBe(1)
  const payroll=(await connection.query('SELECT id FROM management_payroll'))[0][0].id
  await writeManagement(admin,'classify-finance',{sourceType:'expense',sourceId:'salary-expense',classification:'payroll',payrollId:payroll})
  await writeManagement(admin,'classify-finance',{sourceType:'capital',sourceId:'withdrawal',classification:'principal-return'})
  report=await finance(admin,new URLSearchParams({from:'2026-11-01',to:'2026-11-30'}))
  expect(report).toMatchObject({netSales:600000,cogs:400000,salaryExpenses:25000,commissionExpenses:12000,netProfit:163000,roi:16.3,outstandingInvestment:990000})
  await connection.query("UPDATE sale_batch_allocations SET cost_known=0 WHERE id='allocation'")
  expect((await finance(admin,new URLSearchParams({from:'2026-11-01',to:'2026-11-30'})))).toMatchObject({complete:false,roi:null})
 })
 it('uses automatic configured agent credit without duplicate manual credit',async()=>{
  await connection.query("INSERT INTO agents VALUES ('linked-agent','fo')")
  await connection.query("UPDATE invoices SET agent_id='linked-agent' WHERE id='sale'")
  await writeManagement(admin,'sales-credit-mode',{mode:'agent-link'})
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({eligibleSales:600000})
  await writeManagement(admin,'sales-credit-mode',{mode:'cashier'})
  // The explicit Field Officer assignment wins over the cashier mode.
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({eligibleSales:600000})
 })
 it('allows individual salary overrides without rewriting already paid payroll',async()=>{
  await writeManagement(admin,'policy',{role:'field_officer',userId:'fo',from:'2026-11-01',to:'2026-11-30',policy:{...policy,basic:30000}})
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({basic:30000,customerAllowance:50,net:42050})
  const paid=(await connection.query("SELECT breakdown FROM management_payroll WHERE user_id='fo'"))[0][0].breakdown
  expect((typeof paid==='string'?JSON.parse(paid):paid).net).toBe(37000)
 })
 it('limits target-credit eligibility to configured activation dates',async()=>{
  await writeManagement(admin,'target',{userId:'fo',from:'2026-11-01',to:'2026-11-30',amount:1200000,activeFrom:'2026-11-08',status:'active'})
  expect(await estimate(admin,'fo','2026-11-01','2026-11-30')).toMatchObject({eligibleSales:0,achievement:0,commission:0,basic:30000})
 })
 it('counts a legacy commission and its linked expense once',async()=>{
  await connection.query("UPDATE sale_batch_allocations SET cost_known=1 WHERE id='allocation'")
  await connection.query("INSERT INTO commission_ledger VALUES ('legacy-commission','b',1000,'paid','2026-11-30 09:00:00')")
  await connection.query("INSERT INTO expenses VALUES ('commission-expense','b','Commission',1000,'2026-11-30 09:00:00')")
  await writeManagement(admin,'classify-finance',{sourceType:'expense',sourceId:'commission-expense',classification:'commission',commissionId:'legacy-commission'})
  const report=await finance(admin,new URLSearchParams({from:'2026-11-01',to:'2026-11-30'}))
  expect(report.commissionExpenses).toBe(13000)
  expect(report.netProfit).toBe(162000)
 })
 it('retains finalized payroll records after a legacy employee deletion',async()=>{
  await connection.query("DELETE FROM users WHERE id='fo'")
  const history=await readManagement(admin,'payroll',new URLSearchParams()) as any[]
  expect(history).toHaveLength(1);expect(history[0].name).toBe('fo');expect(history[0].status).toBe('paid')
 })
})
