const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const http = require('node:http')
const { createBranchHub } = require('../branch-hub/lib/server.js')

async function main() {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'branchhub-package-smoke-'))
  const token = require('node:crypto').randomBytes(32).toString('hex')
  const hub = createBranchHub({ branchId: 'SMOKE', database: path.join(directory, 'hub.db'), terminals: { T01: token }, backupDirectory: path.join(directory, 'backups') })
  try {
    const port = await hub.listen(0)
    const body = await new Promise((resolve, reject) => {
      http.get(`http://127.0.0.1:${port}/v1/status`, { headers: { authorization: `Bearer ${token}`, 'x-pos-branch': 'SMOKE', 'x-pos-terminal': 'T01' } }, response => {
        let data = ''
        response.on('data', chunk => { data += chunk })
        response.on('end', () => response.statusCode === 200 ? resolve(JSON.parse(data)) : reject(new Error('Hub status rejected')))
        response.on('error', reject)
      }).on('error', reject)
    })
    if (body.branch_id !== 'SMOKE') throw new Error('Hub identity mismatch')
    const hold = hub.store.createHold('T01', 'smoke-manual-hold', { hold_number: '25', items: [{ id: 'smoke-item' }] })
    if (hold.hold_number !== '25' || hub.store.consumeHold('T01', 'smoke-recall', '25').hold_number !== '25') throw new Error('Manual hold number round trip failed')
    if (!await hub.backup()) throw new Error('Hub backup missing')
    console.log('Standalone Node Hub: startup, authenticated REST, manual hold number and verified backup passed')
  } finally {
    await hub.close()
    if (path.dirname(path.resolve(directory)) !== path.resolve(os.tmpdir()) || !path.basename(directory).startsWith('branchhub-package-smoke-')) throw new Error('Unsafe smoke cleanup path')
    fs.rmSync(directory, { recursive: true, force: true })
  }
}
void main().catch(err => { console.error(err.message); process.exitCode = 1 })
