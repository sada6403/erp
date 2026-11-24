const fs=require('node:fs'),os=require('node:os'),path=require('node:path')
const {NsisUpdater}=require('electron-updater')
const {NodeHttpExecutor}=require('builder-util/out/nodeHttpExecutor')
const installed=process.argv[2]||'2.9.5',expected=process.argv[3]||'2.10.0',url=process.argv[4]||'https://updates.nfplantation.com/'
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'pos-update-probe-'))
async function main(){
 const app={version:installed,name:'POS update probe',isPackaged:true,userDataPath:directory,baseCachePath:directory,appUpdateConfigPath:path.join(directory,'unused.yml'),whenReady:async()=>{},relaunch(){throw new Error('Probe must never relaunch')},quit(){throw new Error('Probe must never install')},onQuit(){}}
 const updater=new NsisUpdater(null,app)
 updater.httpExecutor=new NodeHttpExecutor()
 updater.autoDownload=false
 updater.autoInstallOnAppQuit=false
 updater.logger={info(){},warn(){},error(){},debug(){}}
 updater.setFeedURL({provider:'generic',url})
 let available=false
 updater.on('update-available',()=>{available=true})
 updater.on('error',()=>{})
 const result=await updater.checkForUpdates()
 if(!available||result?.updateInfo?.version!==expected)throw new Error('Expected update is not available in the live feed')
 console.log(JSON.stringify({feed:url,installed,available:result.updateInfo.version,event:'update-available',downloaded:false,installedByProbe:false}))
}
main().catch(error=>{console.error(error.message);process.exitCode=1}).finally(()=>{if(path.dirname(path.resolve(directory))!==path.resolve(os.tmpdir()))throw new Error('Unsafe probe cleanup path');fs.rmSync(directory,{recursive:true,force:true})})
