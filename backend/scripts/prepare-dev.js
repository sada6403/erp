const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

function run(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }) } catch {}
}

run('powershell -Command "$pids=(Get-NetTCPConnection -LocalPort 3000 -ErrorAction SilentlyContinue).OwningProcess; if($pids){$pids|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}"')

const nextDir = path.join(__dirname, '..', '.next')
fs.rmSync(nextDir, { recursive: true, force: true })

console.log('[backend predev] Port 3000 cleared, Next cache removed.')
