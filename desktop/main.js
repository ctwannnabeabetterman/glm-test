/**
 * AI Network Lab —— Electron 桌面壳层
 *
 * 架构：主进程在内部以子进程拉起 Next standalone server，
 * 绑定 127.0.0.1:<随机空闲端口>（不占用固定端口、不对局域网暴露），
 * 窗口通过 http 加载本地服务。用户视角是一个桌面应用，无端口概念。
 *
 * 运行前提：npm run build 已产出 .next/standalone（desktop:prepare 会补齐静态资源与数据库模板）。
 * 打包后：server 位于 <resources>/app，数据库模板位于 <resources>/db-template。
 */

const { app, BrowserWindow, Menu, shell, ipcMain, dialog } = require('electron')
const { spawn, execFile } = require('child_process')
const net = require('net')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { migrateDatabase } = require('./migrate-database')

/**
 * 自动更新器（electron-updater）。
 *
 * 用 try/catch 包住 require：更新依赖被打进 asar（见 electron-builder.yml 的 files 白名单），
 * 但万一打包时漏了，也绝不能让整个应用起不来——「更新不可用」远好过「应用打不开」。
 */
let autoUpdater = null
try {
  ;({ autoUpdater } = require('electron-updater'))
} catch (e) {
  console.warn('[update] electron-updater 不可用，本次跳过自动更新：', e && e.message ? e.message : e)
}

let mainWindow = null
let serverProc = null
// SQLite 是单用户本地库：锁定为单实例，避免多进程并发写入造成数据竞争。
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}
let trustedOrigin = null
let savingFile = false

/**
 * 定位可用的 tar 可执行文件。
 * Windows 10 1803+ 自带 bsdtar（C:\Windows\System32\tar.exe），但 PATH 被裁剪时
 * 仅靠 `tar` 这个名字可能解析不到，因此优先用绝对路径兜底。
 */
function resolveTar() {
  if (process.platform === 'win32') {
    const abs = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    if (fs.existsSync(abs)) return abs
  }
  return 'tar'
}

/** 读取 zip 内 BUILD_ID（Next 每次构建都会生成不同值，用作版本标识）；失败返回 null */
function readZipBuildId(zip) {
  return new Promise((resolve) => {
    execFile(resolveTar(), ['-xOf', zip, '.next/BUILD_ID'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      const id = String(stdout).trim()
      resolve(id || null)
    })
  })
}

/** 读取已解压目录的 BUILD_ID；不存在或读失败返回 null */
function readAppBuildId(appDir) {
  try {
    const f = path.join(appDir, '.next', 'BUILD_ID')
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() : null
  } catch {
    return null
  }
}

/**
 * 「解压完成」标记文件的路径。
 * 这是本模块的关键防线：只有**整包解压并校验通过之后**才会写入，
 * 内容为本次解压对应的 BUILD_ID。因此「标记存在且等于 zip 的 BUILD_ID」
 * 才能真正代表目录完整；光看 BUILD_ID 是不够的——压缩包里 `.next/BUILD_ID`
 * 位于第 1347/2337 个条目，若解压在后半段被中断，BUILD_ID 已就位而静态资源缺失，
 * 只比 BUILD_ID 就会误判为「版本一致」而永远跳过修复。
 */
function extractMarkerPath(appDir) {
  return path.join(appDir, '.extract-ok')
}

function isAppDirComplete(appDir, zipBuildId) {
  if (!zipBuildId) return false
  if (!fs.existsSync(path.join(appDir, 'server.js'))) return false
  if (!fs.existsSync(path.join(appDir, '.next', 'server'))) return false
  try {
    return fs.readFileSync(extractMarkerPath(appDir), 'utf8').trim() === zipBuildId
  } catch {
    return false
  }
}

function extractZip(zip, destDir) {
  return new Promise((resolve, reject) => {
    execFile(resolveTar(), ['-xf', zip, '-C', destDir], { windowsHide: true }, (err) => {
      if (err) return reject(new Error('内置服务解压失败：' + err.message))
      resolve()
    })
  })
}

/**
 * 解压随包携带的 resources/app.zip 到 resources/app（standalone 服务本体）。
 *
 * 语义（每条都是有意的）：
 *  1. **fail-safe**：读不出 zip 版本时**保留现有目录**，绝不因为一次只读探测失败
 *     就删掉可用的服务目录——旧实现会这么干，导致「启动即自毁」。
 *  2. **原子替换**：先解压到 app.new，校验通过后再 rename 切换。解压期间
 *     resources/app 始终是完整的旧版本，不会出现半残状态。
 *  3. **完整性标记**：解压后校验 BUILD_ID 与 server.js / .next/server 是否齐备，
 *     全部通过才写 .extract-ok 标记。中断的解压不会留标记，下次启动自动重做。
 *  4. **失败回滚**：切换失败时把旧目录 rename 回来，保证应用仍可用。
 */
function ensureAppExtracted() {
  if (!app.isPackaged) return Promise.resolve()
  const resDir = process.resourcesPath
  const appDir = path.join(resDir, 'app')
  const zip = path.join(resDir, 'app.zip')
  const stagingDir = appDir + '.new'
  const backupDir = appDir + '.old'

  // 清理上一次运行可能留下的中间目录；若 app 缺失但备份还在，先把备份恢复回来
  if (!fs.existsSync(appDir) && fs.existsSync(backupDir)) {
    try {
      fs.renameSync(backupDir, appDir)
      console.log('[desktop] 上次切换未完成，已回滚旧服务目录')
    } catch (e) {
      console.warn('[desktop] 回滚旧服务目录失败：', e.message)
    }
  }
  fs.rmSync(stagingDir, { recursive: true, force: true })

  return readZipBuildId(zip).then(async (zipBuildId) => {
    // ① 目录完整且版本一致 → 复用，零 IO
    if (isAppDirComplete(appDir, zipBuildId)) {
      fs.rmSync(backupDir, { recursive: true, force: true })
      return
    }

    // ② fail-safe：无法确定 zip 版本时保留现状，绝不做破坏性操作
    if (!zipBuildId) {
      if (fs.existsSync(path.join(appDir, 'server.js'))) {
        console.warn('[desktop] 无法读取 app.zip 的 BUILD_ID，保留现有服务目录')
        return
      }
      if (!fs.existsSync(zip)) throw new Error('安装不完整：缺少内置服务包 app.zip')
      throw new Error('内置服务包 app.zip 无法读取，请重新安装')
    }

    if (!fs.existsSync(zip)) {
      if (fs.existsSync(path.join(appDir, 'server.js'))) return // 有旧解压产物可兜底
      throw new Error('安装不完整：缺少内置服务包 app.zip')
    }

    // ③ 需要重建 → 解压到 staging，校验通过后再原子切换
    fs.mkdirSync(stagingDir, { recursive: true })
    try {
      await extractZip(zip, stagingDir)

      const stagedBuildId = readAppBuildId(stagingDir)
      if (!stagedBuildId || stagedBuildId !== zipBuildId) {
        throw new Error(`解压校验失败：期望 BUILD_ID ${zipBuildId}，实际 ${stagedBuildId || '缺失'}`)
      }
      if (!fs.existsSync(path.join(stagingDir, 'server.js')) ||
          !fs.existsSync(path.join(stagingDir, '.next', 'server'))) {
        throw new Error('解压校验失败：服务入口或服务端产物缺失')
      }
      // 校验全部通过，最后一步才写「解压完成」标记
      fs.writeFileSync(extractMarkerPath(stagingDir), zipBuildId)

      // 原子切换：旧目录先让位，staging 顶上来
      fs.rmSync(backupDir, { recursive: true, force: true })
      if (fs.existsSync(appDir)) fs.renameSync(appDir, backupDir)
      fs.renameSync(stagingDir, appDir)
      fs.rmSync(backupDir, { recursive: true, force: true })
      console.log(`[desktop] 服务目录已更新到 BUILD_ID ${zipBuildId}`)
    } catch (err) {
      // 回滚：只要旧目录还能找回来，应用就仍然可用
      fs.rmSync(stagingDir, { recursive: true, force: true })
      if (!fs.existsSync(appDir) && fs.existsSync(backupDir)) {
        try {
          fs.renameSync(backupDir, appDir)
          console.warn('[desktop] 更新失败，已回滚到旧服务目录')
        } catch (e) {
          console.error('[desktop] 回滚失败：', e.message)
        }
      }
      if (fs.existsSync(path.join(appDir, 'server.js'))) {
        console.warn('[desktop] 本次更新未生效，继续使用旧服务目录：', err.message)
        return
      }
      throw err
    }
  })
}

/** 向系统要一个临时空闲端口（绑定后立即释放，存在极小的竞态窗口，实践上足够可靠） */
function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const port = srv.address().port
      srv.close(() => resolve(port))
    })
  })
}

/** 轮询直到本地服务可响应或超时 */
function waitForServer(url, timeoutMs = 90_000) {
  const started = Date.now()
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume()
        if (res.statusCode && res.statusCode < 500) return resolve()
        retry()
      })
      req.on('error', retry)
      req.setTimeout(3000, () => {
        req.destroy()
        retry()
      })
    }
    const retry = () => {
      if (Date.now() - started > timeoutMs) return reject(new Error('内部服务启动超时'))
      setTimeout(attempt, 400)
    }
    attempt()
  })
}

function dataRoot() {
  // 打包态：resources 下；仓库直跑：项目根
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, '..')
}

/** 首次运行时把带 schema 的空白数据库模板落到用户数据目录 */
function ensureDatabase() {
  const dbDir = path.join(app.getPath('userData'), 'db')
  fs.mkdirSync(dbDir, { recursive: true })
  const dbPath = path.join(dbDir, 'custom.db')
  if (!fs.existsSync(dbPath)) {
    const tpl = app.isPackaged
      ? path.join(dataRoot(), 'db-template', 'custom.db')
      : path.join(dataRoot(), 'resources', 'db-template', 'custom.db')
    if (!fs.existsSync(tpl)) throw new Error('缺少数据库模板，请重新安装或执行 npm run desktop:prepare')
    fs.copyFileSync(tpl, dbPath)
  }
  try {
    migrateDatabase(dbPath)
  } catch (e) {
    console.error('[desktop] 数据库迁移失败：', e && e.message ? e.message : e)
  }
  return dbPath
}

function startInternalServer(port, dbPath) {
  const baseDir = app.isPackaged
    ? path.join(process.resourcesPath, 'app')
    : path.join(__dirname, '..', '.next', 'standalone')
  const serverJs = path.join(baseDir, 'server.js')
  if (!fs.existsSync(serverJs)) {
    throw new Error(`未找到内部服务入口：${serverJs}。请先执行 npm run build 与 npm run desktop:prepare。`)
  }

  // ELECTRON_RUN_AS_NODE：让 Electron 主程序以纯 Node 身份运行 server.js —— 打包产物自包含，无需系统安装 Node
  serverProc = spawn(process.execPath, [serverJs], {
    cwd: baseDir,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      NODE_ENV: 'production',
      PORT: String(port),
      HOSTNAME: '127.0.0.1',
      DATABASE_URL: 'file:' + dbPath.replace(/\\/g, '/'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  serverProc.stdout.on('data', (d) => process.stdout.write(`[next] ${d}`))
  serverProc.stderr.on('data', (d) => process.stderr.write(`[next] ${d}`))
  serverProc.on('exit', (code) => {
    serverProc = null
    // 窗口仍在时内部服务意外退出 ⇒ 整体退出，避免出现无后端的白屏窗口
    if (!app.isQuitting && code !== 0) {
      app.quit()
    }
  })
  return serverProc
}

function createWindow(port) {
  trustedOrigin = `http://127.0.0.1:${port}`
  mainWindow = new BrowserWindow({
    width: 1500,
    height: 940,
    minWidth: 1100,
    minHeight: 700,
    title: `AI Network Lab ${app.getVersion()}`,
    autoHideMenuBar: true,
    backgroundColor: '#0a0a0a',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // 隐藏 Windows 默认菜单栏
  Menu.setApplicationMenu(null)
  mainWindow.on('page-title-updated', (event) => event.preventDefault())

  // 页面内 target=_blank / window.open 的外部链接交给系统浏览器，桌面窗口不漂移
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url)
      return { action: 'deny' }
    }
    return { action: 'allow' }
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)
}

/**
 * 自动更新：启动后台静默检查 → 有新版用系统对话框询问 → 下载 → 退出时安装。
 *
 * 刻意不改动 Next 前端：全部用 Electron 原生 dialog + 窗口标题显示进度，
 * 这样前端一行代码都不用动，更新链路就能独立跑通。
 * 更新源来自 electron-builder 的 publish 配置生成的 app-update.yml（GitHub Releases）。
 */
function setupAutoUpdate() {
  if (!autoUpdater) return
  if (!app.isPackaged) {
    console.log('[update] 开发模式，跳过自动更新检查')
    return
  }
  // 先问再下：避免在用户不知情时占用带宽；退出时自动安装已下载的更新
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('update-available', async (info) => {
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['下载更新', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '发现新版本',
        message: `发现新版本 ${info.version}`,
        detail: `当前版本 ${app.getVersion()}。是否现在下载？下载完成后会在退出时自动安装。`,
      })
      if (response === 0) {
        autoUpdater.downloadUpdate().catch((e) => {
          dialog.showErrorBox('下载更新失败', String(e && e.message ? e.message : e))
        })
      }
    } catch (e) {
      console.warn('[update] 提示失败：', e && e.message ? e.message : e)
    }
  })

  autoUpdater.on('update-not-available', () => {
    console.log(`[update] 已是最新版本 ${app.getVersion()}`)
  })

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()} — 正在下载更新 ${Math.round(p.percent || 0)}%`)
    }
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()}`)
    }
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['立即重启并安装', '退出时安装'],
        defaultId: 0,
        cancelId: 1,
        title: '更新已下载',
        message: `新版本 ${info.version} 已下载完成`,
        detail: '选择「立即重启并安装」会关闭应用并完成更新；也可以稍后退出时自动安装。',
      })
      if (response === 0) {
        app.isQuitting = true
        if (serverProc) {
          try {
            serverProc.kill() // 先释放 SQLite 文件句柄，再交给安装器
          } catch {
            /* 进程可能已自行退出 */
          }
        }
        setImmediate(() => autoUpdater.quitAndInstall())
      }
    } catch (e) {
      console.warn('[update] 安装提示失败：', e && e.message ? e.message : e)
    }
  })

  // 网络/权限类错误一律吞掉：更新是增强能力，不能影响正常使用
  autoUpdater.on('error', (e) => {
    console.warn('[update] 更新检查出错（已忽略）：', e && e.message ? e.message : e)
  })

  // 延后 6 秒再查，避免与启动阶段的解压/建库抢磁盘 IO
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      console.warn('[update] 检查更新失败：', e && e.message ? e.message : e)
    })
  }, 6000)
}

async function bootstrap() {
  await ensureAppExtracted()
  const port = await getFreePort()
  const dbPath = ensureDatabase()
  startInternalServer(port, dbPath)
  await waitForServer(`http://127.0.0.1:${port}/api/settings/llm`)
  createWindow(port)
  setupAutoUpdate()
}

ipcMain.handle('save-file', async (event, payload) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return { ok: false, error: 'Untrusted sender' }
  try {
    if (!trustedOrigin || new URL(event.senderFrame.url).origin !== trustedOrigin) return { ok: false, error: 'Untrusted origin' }
  } catch { return { ok: false, error: 'Untrusted origin' } }
  if (savingFile) return { ok: false, error: 'A save is already in progress' }
  if (!payload || typeof payload.filename !== 'string' || payload.filename.length > 200 ||
      /[<>:"/\\|?*\u0000-\u001f]/.test(payload.filename) || !/\.(md|pdf|xlsx|txt|csv)$/i.test(payload.filename) ||
      typeof payload.mime !== 'string' || payload.mime.length > 150 ||
      !(payload.buffer instanceof ArrayBuffer) || payload.buffer.byteLength > 50 * 1024 * 1024) {
    return { ok: false, error: 'Invalid export payload' }
  }
  savingFile = true
  try {
    const filename = payload.filename
    const mime = payload.mime
    const filters = []
    if (filename.endsWith('.md')) filters.push({ name: 'Markdown', extensions: ['md'] })
    else if (filename.endsWith('.pdf')) filters.push({ name: 'PDF', extensions: ['pdf'] })
    else if (filename.endsWith('.xlsx')) filters.push({ name: 'Excel', extensions: ['xlsx'] })
    else if (filename.endsWith('.txt')) filters.push({ name: 'Text', extensions: ['txt'] })
    else if (filename.endsWith('.csv')) filters.push({ name: 'CSV', extensions: ['csv'] })
    filters.push({ name: 'All Files', extensions: ['*'] })
    const result = await dialog.showSaveDialog(mainWindow || undefined, {
      defaultPath: filename,
      filters,
    })
    if (result.canceled || !result.filePath) return { ok: false, canceled: true }
    const buffer = Buffer.from(payload.buffer)
    fs.writeFileSync(result.filePath, buffer)
    return { ok: true, path: result.filePath, mime }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  } finally {
    savingFile = false
  }
})

/** 渲染层可主动触发一次更新检查（供「关于/设置」页做手动检查按钮用） */
ipcMain.handle('check-for-updates', async (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) {
    return { ok: false, error: 'Untrusted sender' }
  }
  try {
    if (!trustedOrigin || new URL(event.senderFrame.url).origin !== trustedOrigin) {
      return { ok: false, error: 'Untrusted origin' }
    }
  } catch {
    return { ok: false, error: 'Untrusted origin' }
  }
  if (!autoUpdater) return { ok: false, error: '更新器不可用（未打包 electron-updater）' }
  if (!app.isPackaged) return { ok: false, error: '开发模式不检查更新' }
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result && result.updateInfo ? result.updateInfo.version : null
    return { ok: true, current: app.getVersion(), latest, hasUpdate: Boolean(latest && latest !== app.getVersion()) }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
})

app.whenReady().then(bootstrap).catch((err) => {
  // 无窗口阶段的致命错误：弹系统级提示并退出
  const { dialog } = require('electron')
  dialog.showErrorBox('AI Network Lab 启动失败', String(err && err.message ? err.message : err))
  app.quit()
})

app.on('window-all-closed', () => {
  app.quit()
})

app.on('before-quit', () => {
  app.isQuitting = true
  if (serverProc) {
    try {
      serverProc.kill()
    } catch {
      /* 进程可能已自行退出 */
    }
  }
})
