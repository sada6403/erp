const { chromium } = require('C:/Users/USER/AppData/Local/npm-cache/_npx/31e32ef8478fbf80/node_modules/playwright')
const path = require('node:path')
const fs = require('node:fs')
const { pathToFileURL } = require('node:url')
;(async () => {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/USER/AppData/Local/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-win64/chrome-headless-shell.exe',
    headless: true,
  })
  const page = await browser.newPage({ viewport: { width: 1000, height: 1300 } })
  try {
    await page.goto(pathToFileURL(path.resolve('output/manual/Supermarket_User_Manual_Tamil_v2.9.4.html')).href)
    await page.evaluate(() => document.fonts.ready)
    const audit = await page.evaluate(() => [...document.querySelectorAll('.page')].map((section, i) => {
      const body = section.querySelector('.body').getBoundingClientRect()
      const footer = section.querySelector('.footer').getBoundingClientRect()
      return { page: i + 1, contentBottom: Math.round(body.bottom - section.getBoundingClientRect().top), footerTop: Math.round(footer.top - section.getBoundingClientRect().top), gap: Math.round(footer.top - body.bottom) }
    }))
    console.log(JSON.stringify(audit))
    fs.writeFileSync('output/manual/layout-audit.json', JSON.stringify(audit, null, 2))
    const overflow = audit.filter(item => item.gap < 12)
    if (overflow.length) throw new Error('Content too close to footer: ' + overflow.map(item => item.page).join(', '))
    await page.pdf({
      path: path.resolve('output/pdf/Supermarket_User_Manual_Tamil_v2.9.4.pdf'),
      printBackground: true,
      preferCSSPageSize: true,
      tagged: true,
      outline: true,
    })
    console.log('Created verified-layout Tamil PDF')
  } finally { await browser.close() }
})().catch(error => { console.error(error); process.exit(1) })
