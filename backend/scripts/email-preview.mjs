// Renders every email type in en / ta / si to HTML files under backend/email-previews/ (git-ignored).
//   npm run email:preview [-- "Company name"]
import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { renderEmail, EMAIL_TYPES } from '../lib/app/emailTemplates.ts'

const out = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'email-previews')
mkdirSync(out, { recursive: true })
const company = {
  name: process.argv[2] || 'Natural Plantation', logo_url: null,
  address: '12 Palm Road, Colombo 07', phone: '011 234 5678', email: 'support@example.com', website: null,
}
const data = {
  name: 'Kamal', order: 'APP-1042', reason: 'The slip image is not readable', code: '482913', scheme: 'Gold Saver 12', receipt: 'R-0007', amount: 2500,
  items: [{ name: 'Virgin coconut oil 1L', qty: 2, total: 1800 }, { name: 'Ceylon tea 500g', qty: 1, total: 950.5 }], delivery_fee: 250, total: 3000.5,
}
let idx = '<!doctype html><meta charset="utf-8"><title>Email previews</title><body style="font-family:sans-serif"><h1>Email previews</h1>'
for (const lang of ['en', 'ta', 'si']) {
  idx += `<h2>${lang}</h2><ul>`
  for (const type of EMAIL_TYPES) {
    const r = renderEmail(type, lang, company, data)
    const file = `${lang}-${type}.html`
    writeFileSync(path.join(out, file), r.html, 'utf8')
    writeFileSync(path.join(out, `${lang}-${type}.txt`), `Subject: ${r.subject}\n\n${r.text}`, 'utf8')
    idx += `<li><a href="${file}">${type}</a> - ${r.subject}</li>`
  }
  idx += '</ul>'
}
writeFileSync(path.join(out, 'index.html'), idx, 'utf8')
console.log(`Wrote ${EMAIL_TYPES.length * 3} previews to ${out}`)
