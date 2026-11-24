// Bundle a TypeScript script with esbuild (resolves tsconfig "@/" paths) and run it with backend/.env loaded.
// Usage: node scripts/run-ts.cjs scripts/seed-app-test-company.ts [args...]
const { spawnSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.resolve(__dirname, '..')
const entry = process.argv[2]
if (!entry) { console.error('usage: run-ts.cjs <file.ts> [args]'); process.exit(2) }
const outDir = path.join(root, '.seed-build')
fs.mkdirSync(outDir, { recursive: true })
const out = path.join(outDir, path.basename(entry).replace(/\.ts$/, '.cjs'))

let esbuild
for (const base of [root, path.join(root, '..')]) {
  try { esbuild = require(require.resolve('esbuild', { paths: [base] })); break } catch { /* try next */ }
}
if (!esbuild) { console.error('esbuild not found'); process.exit(2) }
esbuild.buildSync({ entryPoints: [path.join(root, entry)], bundle: true, platform: 'node', format: 'cjs', packages: 'external', outfile: out, logLevel: 'warning', tsconfig: path.join(root, 'tsconfig.json') })

const r = spawnSync(process.execPath, ['--env-file=.env', out, ...process.argv.slice(3)], { cwd: root, stdio: 'inherit' })
process.exit(r.status ?? 1)
