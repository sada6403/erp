const {spawnSync}=require('node:child_process')
const path=require('node:path')
const archive=process.argv[2]?path.resolve(process.argv[2],'resources/app.asar'):null
const code=archive
 ? `const base=${JSON.stringify(archive)};for(const name of ['bcryptjs','jsonwebtoken','xlsx','ws','nodemailer'])require(base+'/node_modules/'+name);require(base+'/dist-electron/services/releaseMigration.js');const D=require(base+'/node_modules/better-sqlite3');const db=new D(':memory:');db.prepare('SELECT 1').get();db.close();console.log('Packaged dependencies and Electron SQLite ABI OK')`
 : "const D=require('better-sqlite3');const db=new D(':memory:');console.log('Electron SQLite ABI OK');db.close()"
const result=spawnSync(require('electron'),['-e',code],{stdio:'inherit',env:{...process.env,ELECTRON_RUN_AS_NODE:'1'}})
process.exit(result.status??1)
