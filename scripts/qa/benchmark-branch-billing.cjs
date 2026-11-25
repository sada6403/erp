// Run with ELECTRON_RUN_AS_NODE=1 against Electron's existing SQLite driver.
// Synthetic transaction benchmark, not a complete checkout/peripheral benchmark.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os')
const {performance}=require('node:perf_hooks')
const Database=require('better-sqlite3')
const {initializeBillingOutbox,claimBillingInvoice}=require('../../dist-electron/branchHub/billing.js')
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pos-billing-bench-'))
const db=new Database(path.join(directory,'synthetic.db'))
try {
  db.pragma('journal_mode=WAL');db.pragma('synchronous=NORMAL')
  db.exec(`CREATE TABLE invoices(id TEXT PRIMARY KEY,invoice_number TEXT,branch_id TEXT,status TEXT);
    CREATE TABLE invoice_items(id TEXT PRIMARY KEY,invoice_id TEXT,quantity REAL);
    CREATE TABLE payments(id TEXT PRIMARY KEY,invoice_id TEXT,amount REAL);`)
  initializeBillingOutbox(db,'BENCH','T01')
  const invoice=db.prepare('INSERT INTO invoices VALUES(?,?,?,?)'),item=db.prepare('INSERT INTO invoice_items VALUES(?,?,?)'),payment=db.prepare('INSERT INTO payments VALUES(?,?,?)')
  const save=db.transaction(n=>{
    claimBillingInvoice(db,`bill-${n}`)
    invoice.run(`bill-${n}`,`BENCH-T01-${n}`,'BENCH','completed')
    for(let line=0;line<10;line++)item.run(`item-${n}-${line}`,`bill-${n}`,1)
    payment.run(`pay-${n}`,`bill-${n}`,100)
  })
  const times=[]
  for(let n=0;n<500;n++){const start=performance.now();save(n);times.push(performance.now()-start)}
  times.sort((a,b)=>a-b)
  console.log(JSON.stringify({synthetic:true,scope:'SQLite invoice + 10 items + payment + durable branch outbox; excludes full checkout, sync and peripherals',bills:500,p50_ms:+times[249].toFixed(3),p95_ms:+times[474].toFixed(3),p99_ms:+times[494].toFixed(3),networkCallsDuringSave:0}))
}finally{
  db.close()
  if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir())||!path.basename(directory).startsWith('pos-billing-bench-'))throw new Error('Unsafe temporary benchmark cleanup path')
  fs.rmSync(directory,{recursive:true,force:true})
}
