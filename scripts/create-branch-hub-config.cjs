// Generates new files only. Never overwrites an existing configuration or DB.
const fs = require('node:fs')
const path = require('node:path')
const { randomBytes } = require('node:crypto')

function createConfiguration(args) {
  const options = {}
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]
    if (!['--branch-id', '--hub-url', '--output', '--terminals'].includes(key) || !args[i + 1] || options[key]) throw new Error('Use --branch-id ID --hub-url http://LAN-IP:4781 --output NEW-DIRECTORY --terminals T01,T02')
    options[key] = args[i + 1]
  }
  for (const key of ['--branch-id', '--hub-url', '--output', '--terminals']) if (!options[key]) throw new Error(`Missing ${key}`)
  const url = new URL(options['--hub-url'])
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Hub URL must be an HTTP(S) origin')
  // Direct service is HTTP; HTTPS requires a correctly configured reverse proxy.
  const terminalIds = options['--terminals'].split(',')
  if (!terminalIds.length || terminalIds.length > 5 || new Set(terminalIds.map(id => id.toUpperCase())).size !== terminalIds.length || terminalIds.some(id => !/^[A-Za-z0-9_-]{1,40}$/.test(id))) throw new Error('Use 1–5 distinct terminal IDs')
  const output = path.resolve(options['--output'])
  fs.mkdirSync(output) // Intentionally non-recursive: output must be a NEW directory.
  const tokens = Object.fromEntries(terminalIds.map(id => [id, randomBytes(32).toString('hex')]))
  const config = { branchId: options['--branch-id'], host: url.protocol === 'https:' ? '127.0.0.1' : url.hostname, port: url.protocol === 'https:' ? 4781 : Number(url.port || 80), timezone: 'Asia/Colombo', database: 'branch-hub.db', backupDirectory: 'backups', terminals: tokens }
  fs.writeFileSync(path.join(output, 'hub.json'), JSON.stringify(config, null, 2), { flag: 'wx', mode: 0o600 })
  for (const terminalId of terminalIds) {
    const terminalDirectory = path.join(output, terminalId)
    fs.mkdirSync(terminalDirectory)
    fs.writeFileSync(path.join(terminalDirectory, 'branch-hub-terminal.json'), JSON.stringify({ url: url.origin, branchId: config.branchId, terminalId, token: tokens[terminalId] }, null, 2), { flag: 'wx', mode: 0o600 })
  }
  return output
}
if (require.main === module) {
  try { console.log(`Created Hub and per-terminal configurations in ${createConfiguration(process.argv.slice(2))}`) }
  catch (err) { console.error(err.message); process.exitCode = 1 }
}
module.exports = { createConfiguration }
