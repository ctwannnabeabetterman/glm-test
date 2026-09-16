const { contextBridge, ipcRenderer } = require('electron')

const UPDATE_CHANNEL = 'update-status'

contextBridge.exposeInMainWorld('electronSaveFile', (payload) => ipcRenderer.invoke('save-file', payload))

// 壳层与应用信息（版本号、是否打包态），界面用来显示「当前版本」
contextBridge.exposeInMainWorld('electronAppInfo', () => ipcRenderer.invoke('app-info'))

// 手动检查 / 下载 / 安装更新
contextBridge.exposeInMainWorld('electronCheckUpdates', () => ipcRenderer.invoke('check-for-updates'))
contextBridge.exposeInMainWorld('electronDownloadUpdate', () => ipcRenderer.invoke('download-update'))
contextBridge.exposeInMainWorld('electronInstallUpdate', () => ipcRenderer.invoke('install-update'))

// 原生目录选择器：浏览器无法获得目录绝对路径，只有壳层能给（用于选 Obsidian vault）
contextBridge.exposeInMainWorld('electronPickVaultDir', () => ipcRenderer.invoke('obsidian-pick-vault'))

/**
 * 订阅主进程推来的更新状态（「发现新版本」等）。
 *
 * 用自增 id 退订，而不是让订阅函数「返回一个取消订阅函数」——
 * contextBridge 对「返回值是函数」的支持在各 Electron 版本上并不一致，
 * 传 id + 显式 off 最稳。渲染层通常只挂一次，但 React 严格模式会重复挂载，
 * 没有退订就会收到重复提示。
 */
const updateListeners = new Map()
let nextListenerId = 1

ipcRenderer.on(UPDATE_CHANNEL, (_event, payload) => {
  for (const cb of updateListeners.values()) {
    try {
      cb(payload)
    } catch {
      /* 单个监听器抛错不应影响其它监听器 */
    }
  }
})

contextBridge.exposeInMainWorld('electronOnUpdateStatus', (cb) => {
  if (typeof cb !== 'function') return 0
  const id = nextListenerId++
  updateListeners.set(id, cb)
  return id
})

contextBridge.exposeInMainWorld('electronOffUpdateStatus', (id) => {
  updateListeners.delete(id)
})
