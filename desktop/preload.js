const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronSaveFile', (payload) => ipcRenderer.invoke('save-file', payload))
// 渲染层可选调用：手动检查更新（返回 { ok, current, latest, hasUpdate }）
contextBridge.exposeInMainWorld('electronCheckUpdates', () => ipcRenderer.invoke('check-for-updates'))
