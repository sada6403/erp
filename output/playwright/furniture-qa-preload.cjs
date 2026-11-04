const { contextBridge, ipcRenderer } = require('electron')
require('../../dist-electron/preload.js')
contextBridge.exposeInMainWorld('furnitureQA', {
  inspect: () => ipcRenderer.invoke('qa:inspect'),
  businessType: type => ipcRenderer.invoke('qa:businessType', type),
})
