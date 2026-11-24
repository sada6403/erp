const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')
const target = path.join(root, 'branch-hub', 'lib')
fs.mkdirSync(target, { recursive: true })
for (const filename of ['store.js', 'server.js', 'cli.js']) {
  fs.copyFileSync(path.join(root, 'dist-electron', 'branchHub', filename), path.join(target, filename))
}
fs.copyFileSync(path.join(root, 'dist-electron', 'lib', 'holdNumber.js'), path.join(target, 'holdNumber.js'))
console.log('Built standalone Node Branch Hub in branch-hub/lib')
