const {spawn}=require('node:child_process'),path=require('node:path')
const env={...process.env};delete env.ELECTRON_RUN_AS_NODE
const child=spawn(require('electron'),[path.join(__dirname,'purchase-module-qa.cjs')],{env,stdio:'inherit',windowsHide:true})
child.on('close',code=>process.exit(code||0))
