async (page) => {
  // UI fixtures only. Requests are intercepted: no account or financial data is written.
  let signedIn=false
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  const branches=[{id:'qa-main',name:'QA Main Branch',netSales:600000,cogs:400000,grossProfit:200000,expenses:37000,netProfit:163000},{id:'qa-west',name:'QA West Branch',netSales:400000,cogs:280000,grossProfit:120000,expenses:25000,netProfit:95000}]
  const report={from:'2026-11-01',to:'2026-11-07',investment:1000000,totalSales:1000000,netSales:1000000,purchaseCost:800000,cogs:680000,grossProfit:320000,operatingExpenses:25000,salaryExpenses:25000,commissionExpenses:12000,otherExpenses:0,netProfit:258000,principalReturned:10000,outstandingInvestment:990000,roi:25.8,complete:true,branches,totalBranches:2,
   employeeCount:1,activeEmployees:1,employees:[{id:'qa-fo',name:'QA Field Officer',role_code:'field_officer',status:'active',target:1200000,achieved:600000,achievement:50}],capitalByBranch:[{branch_id:'qa-main',transaction_type:'investment',classification:null,amount:1000000}],warnings:{unknownCostQuantity:0,unclassifiedExpenses:0,unclassifiedWithdrawals:0,unallocatedPayroll:0},basis:'QA fixture: no production data. Net of tax and discounts.',freshness:'QA fixture central records.',generatedAt:'2026-11-07T12:00:00Z'}
  await page.route('**/api/management/**',async route=>{
    const url=new URL(route.request().url()),resource=url.pathname.split('/').at(-1)
    if(resource==='login'){signedIn=true;await route.fulfill({json:{success:true,data:{userId:'qa-director'}}});return}
    if(resource==='me'){await route.fulfill({status:signedIn?200:401,json:signedIn?{success:true,data:{userId:'qa-director',platform:'director'}}:{success:false,error:'Login required'}});return}
    if(resource==='locations'){await route.fulfill({json:{success:true,data:{branches,regions:[],zones:[]}}});return}
    if(resource==='finance'){await route.fulfill({json:{success:true,data:{...report,branches:url.searchParams.get('branch')?branches.filter(b=>b.id===url.searchParams.get('branch')):branches}}});return}
    if(resource==='logout'){signedIn=false;await route.fulfill({json:{success:true}});return}
    throw new Error('Unexpected fixture request '+resource)
  })
  await page.goto('http://localhost:3018/director')
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor()
  await page.screenshot({path:'output/playwright/director-login-desktop.png',fullPage:true})
  await page.getByLabel('Company slug').fill('qa-test-company')
  await page.getByLabel('Email address').fill('director@qa.test')
  await page.getByLabel('Password',{exact:true}).fill('qa-fixture-only-password')
  await page.getByRole('button',{name:'Continue to dashboard'}).click()
  await page.getByRole('heading',{name:'Financial overview',exact:true}).waitFor()
  await page.getByText('QA fixture central records.').waitFor()
  await page.screenshot({path:'output/playwright/director-finance-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Branch performance',exact:true}).click()
  await page.getByRole('heading',{name:'Branch comparison',exact:true}).waitFor()
  await page.getByLabel('Compare').selectOption('netProfit')
  await page.screenshot({path:'output/playwright/director-branches-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Employee performance',exact:true}).click()
  await page.getByRole('cell',{name:'QA Field Officer',exact:true}).waitFor()
  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:'output/playwright/director-employees-mobile.png',fullPage:true})
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile page overflow')
  await page.getByRole('button',{name:'Financial overview',exact:true}).click()
  await page.screenshot({path:'output/playwright/director-finance-mobile.png',fullPage:true})
  if(await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth))throw new Error('Mobile finance overflow')
  await page.getByRole('button',{name:'Sign out',exact:true}).click()
  await page.getByRole('heading',{name:'Sign in',exact:true}).waitFor()
  if(errors.length)throw new Error(errors.join('\n'))
  console.log('Director desktop/mobile UI fixtures passed; no real accounts or transactions written.')
}
