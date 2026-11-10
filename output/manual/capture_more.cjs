const { chromium } = require('C:/Users/USER/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright')
const path = require('node:path')
;(async () => {
  const browser = await chromium.connectOverCDP('http://127.0.0.1:9337', { timeout: 5000 })
  const page = browser.contexts()[0].pages().find(p => p.url().includes('5173'))
  const original = page.url()
  const base = original.split('#')[0]
  const shot = async (locator, name, maxHeight) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('Screenshot region unavailable')
    box.height = Math.min(box.height, maxHeight || page.viewportSize()?.height || 950)
    await page.screenshot({ path: path.resolve('output/manual/screens', name), clip: box, timeout: 15000 })
  }
  try {
    await page.goto(base + '#/admin/purchase-orders')
    await page.getByRole('button', { name: 'Supplier Bills', exact: true }).click()
    await page.getByRole('columnheader', { name: 'Uploaded At', exact: true }).waitFor()
    await shot(page.locator('main'), 'bill-history.png')
    if (await page.getByRole('button', { name: 'Purchase Details', exact: true }).count()) {
      await page.getByRole('button', { name: 'Purchase Details', exact: true }).first().click()
      await shot(page.getByText('Supplier Invoice & Payment', { exact: true }).locator('..'), 'bill-details.png')
      await page.getByRole('button', { name: 'Close', exact: true }).first().click()
    }
    await page.goto(base + '#/admin/stock-profit')
    await page.getByRole('heading', { name: 'Stock & Profit', exact: true }).waitFor()
    await page.getByText('Total Available Stock Value (Purchase Cost)', { exact: true }).waitFor()
    await shot(page.locator('main'), 'stock-profit.png', 650)
    await page.goto(base + '#/admin/investments')
    await page.getByRole('heading', { name: 'Owner Investments', exact: true }).waitFor()
    await shot(page.locator('main'), 'investments.png', 700)
    console.log('Captured current supplier bills, upload details, stock profit and investments')
  } finally {
    await page.goto(original)
    await browser.close()
  }
})().catch(error => { console.error(error.message); process.exit(1) })
