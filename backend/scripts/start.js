const { spawn } = require('child_process')

const port = process.env.PORT || '3000'
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['next', 'start', '-p', port],
  { stdio: 'inherit', shell: false }
)

child.on('exit', code => process.exit(code ?? 0))
