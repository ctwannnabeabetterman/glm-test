const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('electronSaveFile', (payload) => ipcRenderer.invoke('save-file', payload))

contextBridge.exposeInMainWorld('electronCheckUpdates', () => ipcRenderer.invoke('check-for-updates'))

// 原生目录选择器：浏览器无法获得目录绝对路径，只有壳层能给（用于选 Obsidian vault）
contextBridge.exposeInMainWorld('electronPickVaultDir', () => ipcRenderer.invoke('obsidian-pick-vault'))
