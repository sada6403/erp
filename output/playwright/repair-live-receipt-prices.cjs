const {chromium}=require('C:/Users/USER/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright')
const assert=require('node:assert/strict')
;(async()=>{
 const browser=await chromium.connectOverCDP('http://127.0.0.1:9337')
 const page=browser.contexts()[0].pages().find(p=>p.url().includes('5173'))
 await page.waitForFunction(()=>typeof window.api?.purchases?.refreshProductPrices==='function')
 const result=await page.evaluate(async()=>{
  const all=await window.api.purchases.list({})
  const receipt=all.data.find(r=>r.po_number==='MAIN-001-PO-2026-0001')
  if(!receipt) throw new Error('Expected supplier receipt not found')
  const before=await window.api.products.list({})
  const repaired=await window.api.purchases.refreshProductPrices(receipt.id)
  if(!repaired.success)throw new Error(repaired.error)
  const after=await window.api.products.list({})
  return {updated:repaired.data.updated,products:after.data.filter(p=>['PRD-116','PRD-117'].includes(p.sku)).map(p=>({sku:p.sku,cost:p.cost_price,selling:p.selling_price,stock:p.stock,previousStock:before.data.find(x=>x.id===p.id)?.stock}))}
 })
 for(const p of result.products){assert.equal(p.stock,p.previousStock);assert.equal(p.cost,p.sku==='PRD-116'?100:150)}
 console.log(JSON.stringify(result,null,2))
 await page.goto(page.url().split('#')[0]+'#/admin/products')
 await page.getByRole('heading',{name:'List Products',exact:true}).waitFor()
 console.log((await page.locator('main').ariaSnapshot()).slice(0,1200))
 await page.screenshot({path:'output/playwright/tk-receipt-product-prices-repaired.png'})
 await browser.close()
})().catch(e=>{console.error(e.message);process.exit(1)})
