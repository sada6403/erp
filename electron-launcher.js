const { spawn } = require('child_process')
const path = require('path')
const electronBin = require('electron')

const env = Object.assign({}, process.env)
delete env.ELECTRON_RUN_AS_NODE
env.NODE_ENV = process.env.NODE_ENV || 'development'
env.DEV_PORT = process.env.DEV_PORT || '5173'

const proc = spawn(electronBin, [path.resolve('.')], {
  env,
  stdio: 'inherit',
  windowsHide: false
})

proc.on('close', (code) => process.exit(code ?? 0))
