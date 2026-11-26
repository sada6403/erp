require('../../dist-electron/preload.js')
const {contextBridge,ipcRenderer}=require('electron')
contextBridge.exposeInMainWorld('qa',{state:()=>ipcRenderer.invoke('qa:state'),quit:()=>ipcRenderer.invoke('qa:quit')})
