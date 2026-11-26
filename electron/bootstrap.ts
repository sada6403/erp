import { app, dialog } from 'electron'
import { testingLaunchDirectory } from './services/testingSandbox'

// Select userData BEFORE main.ts imports stores, databases or background services.
const liveRoot=app.getPath('userData')
process.env.POS_LIVE_USER_DATA=liveRoot
delete process.env.POS_TEST_MODE
let sandbox:string|undefined
let launchError:Error|undefined
try{sandbox=testingLaunchDirectory(liveRoot)}catch(error){launchError=error as Error}
if(launchError){
  // Never fall back to live data when the testing sandbox is unreadable.
  app.whenReady().then(()=>{dialog.showErrorBox('POS Testing Mode',`${launchError!.message}

Delete pos-testing-control.json in ${liveRoot} to return to live mode.`);app.quit()})
}else{
if(sandbox){
  app.setPath('userData',sandbox);process.env.POS_TEST_MODE='1'
  const blocked=()=>{throw new Error('External services are disabled in POS Testing Mode')}
  for(const name of ['http','https']){const transport=require(name);transport.request=blocked;transport.get=blocked}
  globalThis.fetch=async()=>blocked()
}
require('./main')
}
