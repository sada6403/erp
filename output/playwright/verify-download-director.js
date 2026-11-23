async(page)=>{
 let accept=false,requests=0
 await page.route('**/latest.yml**',route=>route.fulfill({body:'version: 2.9.4\npath: Enterprise POS ERP Setup 2.9.4.exe\n'}))
 await page.route('**/api/management/login',async route=>{
  const data=route.request().postDataJSON();requests++
  if(data.platform!=='director'||data.transport)throw new Error('Public login must use Director cookie authentication')
  await route.fulfill({status:accept?200:401,json:accept?{success:true}:{success:false,error:'Invalid credentials'}})
 })
 await page.route('**/director',route=>route.fulfill({body:'<h1>QA Director dashboard</h1>',contentType:'text/html'}))
 await page.goto('http://127.0.0.1:3022/')
 await page.getByRole('heading',{name:'Director Login'}).waitFor()
 await page.getByText('2.9.4',{exact:true}).waitFor()
 const href=await page.locator('#downloadBtn').getAttribute('href')
 if(!decodeURIComponent(href||'').includes('Enterprise POS ERP Setup 2.9.4.exe'))throw new Error('Download link regressed')
 await page.screenshot({path:'output/playwright/download-director-desktop.png',fullPage:true})
 await page.setViewportSize({width:390,height:844})
 await page.screenshot({path:'output/playwright/download-director-mobile.png',fullPage:true})
 if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Mobile horizontal overflow')
 await page.getByLabel('Company name / ID',{exact:true}).fill('qa-company')
 await page.getByLabel('Director email / User ID',{exact:true}).fill('director@qa.test')
 await page.getByLabel('Password',{exact:true}).fill('qa-test-only-password')
 await page.getByRole('button',{name:'Sign in to Director Dashboard'}).click()
 await page.getByRole('alert').filter({hasText:'Invalid credentials'}).waitFor()
 if(await page.getByLabel('Password',{exact:true}).inputValue())throw new Error('Failed password was retained')
 accept=true
 await page.getByLabel('Password',{exact:true}).fill('qa-test-only-password')
 await page.getByRole('button',{name:'Sign in to Director Dashboard'}).click()
 await page.getByRole('heading',{name:'QA Director dashboard'}).waitFor()
 if(new URL(page.url()).origin!=='http://127.0.0.1:3022'||requests!==2)throw new Error('Same-origin redirect failed')
 console.log('Download homepage Director login checks passed; requests intercepted, no accounts changed.')
}
