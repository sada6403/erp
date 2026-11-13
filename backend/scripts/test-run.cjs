// `npm test`: seed a fresh, uniquely named LOCAL test tenant, run the backend suites against it, delete it.
// Needs the local dev server on TEST_BASE_URL/SEED_BASE_URL (default http://localhost:3000) and local MySQL.
const { spawnSync } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const root = path.resolve(__dirname, '..')
const out = path.join(os.tmpdir(), `np-seed-${Date.now()}-${process.pid}.json`)
const env = { ...process.env, SEED_FRESH: '1', SEED_OUTPUT: out, SEED_FILE: out }
const run = (args, extra = {}) => spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit', env: { ...env, ...extra } })

let code = 1
try {
  const seed = run(['--env-file=.env', 'scripts/run-ts.cjs', 'scripts/seed-app-test-company.ts'])
  if (seed.status !== 0 || !fs.existsSync(out)) { console.error('Seeding the fresh test tenant failed.'); process.exit(1) }
  const t = run(['--env-file=.env', '--experimental-strip-types', '--no-warnings', '--test', 'tests/app-api.test.mjs', 'tests/sync-tz.test.mjs', 'tests/email.test.mjs'])
  code = t.status ?? 1
} finally {
  if (fs.existsSync(out)) run(['--env-file=.env', 'scripts/run-ts.cjs', 'scripts/seed-app-test-company.ts', '--cleanup'])
}
process.exit(code)
