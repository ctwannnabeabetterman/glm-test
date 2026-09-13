const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronSaveFile', (payload) => ipcRenderer.invoke('save-file', payload))
