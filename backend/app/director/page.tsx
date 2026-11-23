'use client'
import { useEffect,useState,type FormEvent } from 'react'
import styles from './director.module.css'

type Row=Record<string,any>
const lkr=(value:unknown)=>new Intl.NumberFormat('en-LK',{style:'currency',currency:'LKR',maximumFractionDigits:2}).format(Number(value||0))
function today(){const p=new Intl.DateTimeFormat('en',{timeZone:'Asia/Colombo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());return ['year','month','day'].map(k=>p.find(v=>v.type===k)!.value).join('-')}
async function api(path:string,body?:unknown){
 const response=await fetch('/api/management/'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin',cache:'no-store',...(body===undefined?{}:{body:JSON.stringify(body)})})
 const result=await response.json()
 if(!response.ok||!result.success)throw Object.assign(new Error(result.error||'Could not load report'),{status:response.status})
 return result.data
}
export default function DirectorPage(){
 const [session,setSession]=useState<Row|null>(null),[checking,setChecking]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState('')
 const [login,setLogin]=useState({company:'',email:'',password:''}),[data,setData]=useState<Row|null>(null),[locations,setLocations]=useState<Row>({branches:[],regions:[],zones:[]})
 const [section,setSection]=useState('Financial overview'),[metric,setMetric]=useState('netSales')
 const [filters,setFilters]=useState({from:today().slice(0,7)+'-01',to:today(),branch:'',region:'',zone:''})
 useEffect(()=>{let live=true;api('me').then(user=>{if(live&&user.platform==='director')setSession(user)}).catch(()=>undefined).finally(()=>{if(live)setChecking(false)});return()=>{live=false}},[])
 useEffect(()=>{if(!session)return;api('locations').then(setLocations).catch(e=>setError(e.message))},[session])
 useEffect(()=>{
  if(!session)return
  let live=true;const load=async()=>{
   setBusy(true)
   try{const report=await api('finance?'+new URLSearchParams(filters));if(live){setData(report);setError('')}}
   catch(e){if(live){setData(null);setError((e as Error).message);if([401,403].includes((e as {status:number}).status))setSession(null)}}
   finally{if(live)setBusy(false)}
  };load();const timer=setInterval(load,60000);return()=>{live=false;clearInterval(timer)}
 },[session,filters])
 const preset=(key:string)=>{
  const to=today();let from=to
  if(key==='Weekly'){const d=new Date(to+'T12:00:00Z');d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));from=d.toISOString().slice(0,10)}
  if(key==='Monthly')from=to.slice(0,7)+'-01'
  if(key==='Yearly')from=to.slice(0,4)+'-01-01'
  setFilters(f=>({...f,from,to}))
 }
 async function signIn(e:FormEvent){
  e.preventDefault();setBusy(true);setError('')
  try{await api('login',{...login,platform:'director'});const user=await api('me');if(user.platform!=='director')throw new Error('Director website account required');setLogin(l=>({...l,password:''}));setSession(user)}
  catch(e){setError((e as Error).message)}finally{setBusy(false)}
 }
 if(checking)return <main className={styles.loading}>Checking secure session…</main>
 if(!session)return <main className={styles.loginPage}><div className={styles.loginIntro}><div className={styles.eyebrow}>SUPERMARKET · DIRECTOR</div><h1>A clear view<br/>of your business.</h1><p>Investment, operating performance and people.<br/>Connected to your existing POS.</p><small>Account access is managed by your Company Admin in POS.</small></div><form className={styles.loginForm} onSubmit={signIn}><span className={styles.eyebrow}>SECURE DIRECTOR ACCESS</span><h2>Sign in</h2>{(['company','email','password'] as const).map(key=><label key={key}>{key==='company'?'Company name / ID':key==='email'?'Email address':'Password'}<input required type={key==='password'?'password':key==='email'?'email':'text'} autoComplete={key==='password'?'current-password':key==='email'?'username':'organization'} value={login[key]} onChange={e=>setLogin(l=>({...l,[key]:e.target.value}))}/></label>)}{error&&<p role="alert" className={styles.error}>{error}</p>}<button disabled={busy}>{busy?'Signing in…':'Continue to dashboard'}</button><p className={styles.muted}>Director accounts have reporting access only.</p></form></main>
 const sorted=[...(data?.branches||[])].sort((a,b)=>Number(b.netProfit)-Number(a.netProfit))
 const cards=data?[
  ['Total investment',data.investment],['Total sales · incl. tax',data.totalSales],['Net sales · excl. tax',data.netSales],['Received purchase cost',data.purchaseCost],['Cost of goods sold',data.cogs],['Gross profit',data.grossProfit],['Operating expenses',data.operatingExpenses],['Salary expenses',data.salaryExpenses],['Commission expenses',data.commissionExpenses],['Other expenses',data.otherExpenses],['Net profit',data.netProfit],['Actual capital returned',data.principalReturned],['Outstanding investment',data.outstandingInvestment],
 ]:[]
 const max=Math.max(1,...(data?.branches||[]).map((b:Row)=>Math.abs(Number(b[metric]))))
 return <div className={styles.app}><aside className={styles.sidebar}><a className={styles.brand} href="/director">DIRECTOR<span>Supermarket management</span></a><p className={styles.navCaption}>WORKSPACE</p><nav>{['Financial overview','Branch performance','Employee performance'].map(s=><button className={s===section?styles.active:''} key={s} onClick={()=>setSection(s)}>{s}</button>)}</nav><div className={styles.sidebarFoot}><span>Read-only access</span><button onClick={async()=>{try{await api('logout',{})}finally{setSession(null);setData(null)}}}>Sign out</button></div></aside><main className={styles.main}><header className={styles.header}><div><div className={styles.eyebrow}>COMPANY PERFORMANCE</div><h1>{section}</h1><p>Actual POS records. One financial view.</p></div><div className={styles.status}>{busy?'Updating…':'Connected to central backend'}</div></header>
 <section className={styles.filters} aria-label="Report filters"><div className={styles.presets}>{['Today','Weekly','Monthly','Yearly'].map(p=><button key={p} onClick={()=>preset(p)}>{p}</button>)}</div><div className={styles.filterInputs}><label>From<input aria-label="From date" type="date" value={filters.from} max={filters.to} onChange={e=>setFilters(f=>({...f,from:e.target.value}))}/></label><label>To<input aria-label="To date" type="date" min={filters.from} value={filters.to} onChange={e=>setFilters(f=>({...f,to:e.target.value}))}/></label>{(['branch','region','zone'] as const).map(key=><label key={key}>{key[0].toUpperCase()+key.slice(1)}<select value={filters[key]} onChange={e=>setFilters(f=>({...f,[key]:e.target.value}))}><option value="">All assigned {key==='branch'?'branches':key+'s'}</option>{(locations[key==='branch'?'branches':key+'s']||[]).map((r:Row)=><option key={r.id} value={r.id}>{r.name}</option>)}</select></label>)}</div></section>
 {error&&<p role="alert" className={styles.error}>{error}</p>}
 {!data&&!error&&<div className={styles.empty}>Loading your financial records…</div>}
 {data&&<>
 {!data.complete&&<div className={styles.warning}><strong>Financial records need review.</strong> Unknown/missing cost units: {data.warnings.unknownCostQuantity}. Unclassified expenses: {data.warnings.unclassifiedExpenses}. Unclassified withdrawals: {data.warnings.unclassifiedWithdrawals}. Profit is provisional; ROI is withheld until coverage is complete.</div>}
 {section==='Financial overview'&&<><div className={styles.heroMetrics}><div><span>{data.complete?'NET PROFIT':'PROVISIONAL NET PROFIT'}</span><strong>{lkr(data.netProfit)}</strong><small>Selected period · {filters.from} — {filters.to}</small></div><div><span>CUMULATIVE ROI</span><strong>{data.roi==null?'Unavailable':Number(data.roi).toFixed(2)+'%'}</strong><small>Profit and capital returned are separate</small></div></div><section className={styles.metrics}>{cards.map(([name,value])=><article key={String(name)}><h2>{name}</h2><strong>{lkr(value)}</strong></article>)}</section><section className={styles.panel}><h2>Investment by branch</h2><div className={styles.tableWrap}><table><thead><tr><th>Branch</th><th>Transaction</th><th>Classification</th><th>Amount</th></tr></thead><tbody>{data.capitalByBranch.map((r:Row,i:number)=><tr key={i}><td>{locations.branches.find((b:Row)=>b.id===r.branch_id)?.name||'Company / unallocated'}</td><td>{r.transaction_type}</td><td>{r.classification||'—'}</td><td>{lkr(r.amount)}</td></tr>)}{!data.capitalByBranch.length&&<tr><td colSpan={4}>No investment records. Record them in POS.</td></tr>}</tbody></table></div></section></>}
 {section==='Branch performance'&&<><div className={styles.summaryLine}><span><b>{data.totalBranches}</b> branches in scope</span><span>Highest net profit: <b>{sorted[0]?.name||'No data'}</b></span><span>Lowest net profit: <b>{sorted.at(-1)?.name||'No data'}</b></span></div><section className={styles.panel}><div className={styles.panelHeading}><h2>Branch comparison</h2><label>Compare<select value={metric} onChange={e=>setMetric(e.target.value)}><option value="netSales">Net sales</option><option value="grossProfit">Gross profit</option><option value="netProfit">Net profit</option></select></label></div><div className={styles.bars}>{data.branches.map((b:Row)=><button key={b.id} onClick={()=>setFilters(f=>({...f,branch:b.id}))} title="Filter to this branch"><span>{b.name}</span><div><i className={Number(b[metric])<0?styles.negative:''} style={{width:Math.abs(Number(b[metric]))/max*100+'%'}}/></div><b>{lkr(b[metric])}</b></button>)}</div></section><section className={styles.panel}><h2>Branch financial performance</h2><div className={styles.tableWrap}><table><thead><tr><th>Branch</th><th>Net sales</th><th>COGS</th><th>Gross profit</th><th>Expenses</th><th>Net profit</th></tr></thead><tbody>{data.branches.map((b:Row)=><tr key={b.id}><td>{b.name}</td>{['netSales','cogs','grossProfit','expenses','netProfit'].map(k=><td key={k}>{lkr(b[k])}</td>)}</tr>)}</tbody></table></div><p className={styles.muted}>Company/unallocated payroll costs {lkr(data.warnings.unallocatedPayroll)} are included in company totals, not assigned arbitrarily to branches.</p></section></>}
 {section==='Employee performance'&&<><div className={styles.summaryLine}><span><b>{data.employeeCount}</b> employees</span><span><b>{data.activeEmployees}</b> active</span><span><b>{data.employeeCount-data.activeEmployees}</b> inactive / suspended</span><span>Salary: <b>{lkr(data.salaryExpenses)}</b></span><span>Commission: <b>{lkr(data.commissionExpenses)}</b></span></div><section className={styles.panel}><h2>Targets and achievements</h2><div className={styles.tableWrap}><table><thead><tr><th>Employee</th><th>Role</th><th>Status</th><th>Target</th><th>Eligible sales</th><th>Achievement</th></tr></thead><tbody>{data.employees.map((e:Row)=><tr key={e.id}><td>{e.name}</td><td>{String(e.role_code).replace(/_/g,' ')}</td><td>{e.status}</td><td>{e.target>0?lkr(e.target):'Not configured'}</td><td>{lkr(e.achieved)}</td><td>{e.achievement==null?'—':Number(e.achievement).toFixed(2)+'%'}</td></tr>)}{!data.employees.length&&<tr><td colSpan={6}>No management employees assigned to this scope.</td></tr>}</tbody></table></div></section></>}
 <footer className={styles.footer}><p>{data.basis}</p><p>{data.freshness}</p><span>Report generated: {new Date(data.generatedAt).toLocaleString('en-LK',{timeZone:'Asia/Colombo'})} · Asia/Colombo</span></footer>
 </>}
 </main></div>
}
