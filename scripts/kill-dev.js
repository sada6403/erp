// Kills anything on port 5173 and stale Electron processes before dev server starts.
// Runs automatically via the "predev" npm script — no manual steps needed.
const { execSync } = require('child_process')

function run(cmd) {
  try { execSync(cmd, { stdio: 'ignore' }) } catch {}
}

// Kill whatever is on port 5173
run('powershell -Command "$pids=(Get-NetTCPConnection -LocalPort 5173 -ErrorAction SilentlyContinue).OwningProcess; if($pids){$pids|ForEach-Object{Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue}}"')

// Kill stale Electron / built-app processes that may be holding the SQLite file
run('taskkill /F /IM electron.exe')
run('taskkill /F /IM "Enterprise POS ERP.exe"')

console.log('[predev] Port 5173 cleared, stale Electron processes killed.')
