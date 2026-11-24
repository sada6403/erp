// Merges docs/mobile-app/integration-evidence/*.json (written by the integration-app suite) into INTEGRATION_REPORT.md.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const dir = path.join(root, 'docs', 'mobile-app', 'integration-evidence')
const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.json') && f !== 'smoke.json').sort() : []
const cell = (s) => String(s ?? '').replace(/\|/g, '\|').replace(/\r?\n/g, ' ')
const rows = []
for (const f of files) {
  const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
  for (const r of d.rows) rows.push({ ...r, file: d.file, at: d.generated_at })
}
const count = (x) => rows.filter((r) => r.result === x).length
let md = `# App <-> API <-> cloud MySQL <-> POS integration report\n\n`
md += `Generated ${new Date().toISOString()} by \`npm run test:integration-app\` against a fresh local tenant (deleted after the run). Local only, never production.\n\n`
md += `**${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('SKIP')} SKIP** of ${rows.length} checks.\n\n`
md += `| ID | Action | API | Cloud MySQL rows (UTC) | POS screen / local rows | Reverse (POS -> app) | ms | Result | Notes |\n|---|---|---|---|---|---|---|---|---|\n`
for (const r of rows) md += `| ${cell(r.id)} | ${cell(r.action)} | ${cell(r.api)} | ${cell(r.cloud)} | ${cell(r.pos)} | ${cell(r.reverse)} | ${r.ms ?? ''} | ${r.result} | ${cell(r.notes)} |\n`
fs.writeFileSync(path.join(root, 'docs', 'mobile-app', 'INTEGRATION_REPORT.md'), md)
console.log(`INTEGRATION_REPORT.md: ${count('PASS')} PASS, ${count('FAIL')} FAIL, ${count('SKIP')} SKIP`)
process.exit(count('FAIL') ? 1 : 0)
