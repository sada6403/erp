const fs = require('node:fs')
const path = require('node:path')

function setHubUrl(filename, address) {
  const url = new URL(address)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use an HTTP(S) server origin, for example http://BRANCH-SERVER:4781')
  const target = path.resolve(filename)
  const original = fs.readFileSync(target, 'utf8')
  const config = JSON.parse(original)
  if (!config.branchId || !config.terminalId || typeof config.token !== 'string' || config.token.length < 24) throw new Error('Select an existing terminal configuration')
  const backup = `${target}.backup-${Date.now()}`
  fs.writeFileSync(backup, original, { flag: 'wx', mode: 0o600 })
  const temporary = `${target}.pending-${process.pid}`
  try {
    fs.writeFileSync(temporary, JSON.stringify({ ...config, url: url.origin }, null, 2), { flag: 'wx', mode: 0o600 })
    fs.renameSync(temporary, target)
  } finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  return { terminalId: config.terminalId, backup }
}
if (require.main === module) {
  try {
    if (process.argv.length !== 4) throw new Error('Usage: node set-branch-hub-url.cjs PATH-TO-TERMINAL-CONFIG http://SERVER:4781')
    const result = setHubUrl(process.argv[2], process.argv[3])
    console.log(`Updated ${result.terminalId} server address. Restart POS. Existing terminal identity, queues and databases are retained.`)
  } catch (err) { console.error(err.message); process.exitCode = 1 }
}
module.exports = { setHubUrl }
