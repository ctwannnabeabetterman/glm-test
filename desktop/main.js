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
const { migrateDatabase, readDatabaseVersion, encodeVersion, formatVersion } = require('./migrate-database')
const { findForeignLabInstances, buildConflictDetail } = require('./instance-guard')

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

/** 最近一次更新状态，供前端「关于/设置」页在打开时直接取用，而不是只有推送 */
let lastUpdateStatus = { state: 'idle' }

/**
 * 把更新状态推给渲染层。
 *
 * 为什么不能只靠系统对话框：用户点一次「稍后」对话框就消失了，之后再没有任何痕迹，
 * 等于「提醒过了但用户没记住」。推一份到界面，可以做成常驻提示，用户随时能看到。
 */
function sendUpdateStatus(payload) {
  lastUpdateStatus = payload
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('update-status', payload)
  }
}

/**
 * 把 electron-updater 的原始报错翻译成用户看得懂、能行动的话。
 *
 * 最典型的一种：GitHub 侧没有「正式发布」时，getLatestTagName() 请求
 * /releases/latest 会跟随跳转拿到 406，报错原文是
 * `Cannot parse releases feed: ... HttpError: 406` —— 对用户零信息量，
 * 实际含义只是「更新源还没有可用的正式版本」。这类错误原来被 console.warn
 * 悄悄吞掉，用户永远不知道发生了什么，所以必须分类后显式回传。
 */
function classifyUpdateError(e) {
  const msg = String((e && (e.message || e.stack)) || e || '')
  if (/406|Cannot parse releases feed|LATEST_VERSION_NOT_FOUND|Unable to find latest version|No published versions/i.test(msg)) {
    return {
      reason: 'no-release',
      message: '更新源暂时没有可用的正式发布（GitHub Releases）。等作者发布新版本后即可检测到。',
    }
  }
  if (/CHANNEL_FILE_NOT_FOUND|Cannot find latest\.yml|404/i.test(msg)) {
    return { reason: 'no-channel', message: '更新源缺少 latest.yml，说明上一次发布流程没有跑完。' }
  }
  if (/ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNREFUSED|ECONNRESET|getaddrinfo|socket hang up/i.test(msg)) {
    return { reason: 'network', message: '网络不可用，连不上更新源。请检查网络后重试。' }
  }
  return { reason: 'unknown', message: msg.split('\n')[0].slice(0, 200) }
}

/**
 * SQLite 是单用户本地库：锁定为单实例 —— 多开会并发写同一个 db 文件，造成数据竞争。
 *
 * 这里用 `app.exit(0)` 而不是 `app.quit()`：quit 只是「请求退出」，要等 before-quit
 * 走完才真正结束进程，而 `app.whenReady()` 在这个窗口期仍可能被触发 —— 那样第二个
 * 实例会照样走完 bootstrap、拉起第二份内部服务，表现为「多开一个客户端 + 多一批
 * node 子进程 + 第二个 SQLite 句柄」。exit 是立即终止，配合下面的 isSecondaryInstance
 * 兜底，才能保证拿不到锁的进程绝不再往下启动。
 *
 * 实测（win-unpacked 双开）：第二个实例确实会在打印启动警告后自行退出，
 * 进程总数不增加；关窗后 5 个进程全部归零，无残留。
 */
const isSecondaryInstance = !app.requestSingleInstanceLock()
if (isSecondaryInstance) {
  app.exit(0)
} else {
  app.on('second-instance', () => {
    // 用户又点了一次图标：把已有窗口顶到前面，而不是再开一个
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

  // ── 版本一致性（降级保护）──────────────────────────────────────────────
  // 库里记的版本比当前程序新，说明本机数据已经被更新的版本写过。旧代码不认识新增的
  // 列/表，继续启动就可能把新数据写坏，而且坏得很安静 —— 所以宁可直接拒绝启动。
  // 升级方向（库比程序旧）永远放行，由下面的 migrateDatabase 补齐结构。
  const appVersion = app.getVersion()
  const stored = readDatabaseVersion(dbPath)
  const self = encodeVersion(appVersion)
  if (stored > 0 && self !== null && stored > self) {
    const detail = [
      `本机数据库已由更高版本（${formatVersion(stored)}）创建，当前程序是 ${appVersion}。`,
      '',
      '继续用旧版本打开会破坏新版本写入的数据，因此已停止启动。',
      '请安装最新的 AI Network Lab 后再打开；本机数据不会被删除。',
    ].join('\n')
    console.error(`[guard] 数据库版本 ${formatVersion(stored)} 高于程序版本 ${appVersion}，拒绝启动`)
    dialog.showErrorBox('版本不一致', detail)
    app.exit(0)
  }

  try {
    // 顺带把本程序的版本写进库头的 user_version —— 下次若拿更老的程序来开，
    // 上面的检查就能拦住它。
    migrateDatabase(dbPath, { appVersion })
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

  // 窗口重新获得焦点时做一次「是不是又开了别的版本」的复检（内部已按 60s 节流）。
  // 用户切回来这个动作本身往往就意味着他刚点过旧版本的图标。
  mainWindow.on('focus', () => {
    void watchForeignInstances()
  })
}

/** 先释放 SQLite 句柄再交给安装器，否则安装程序可能覆盖不掉正在被占用的文件 */
function applyUpdateAndRestart() {
  if (!autoUpdater) return
  app.isQuitting = true
  if (serverProc) {
    try {
      serverProc.kill()
    } catch {
      /* 进程可能已自行退出 */
    }
  }
  setImmediate(() => autoUpdater.quitAndInstall())
}

/** 开始下载更新（系统对话框与界面按钮共用同一条路径，行为一致） */
function startUpdateDownload() {
  if (!autoUpdater) return { ok: false, error: '更新组件不可用' }
  if (!app.isPackaged) return { ok: false, error: '开发模式不下载更新' }
  sendUpdateStatus({
    state: 'downloading',
    current: app.getVersion(),
    percent: 0,
    message: '正在下载更新…',
  })
  autoUpdater.downloadUpdate().catch((e) => {
    const info = classifyUpdateError(e)
    sendUpdateStatus({ state: 'error', reason: info.reason, message: info.message, current: app.getVersion() })
    dialog.showErrorBox('下载更新失败', info.message)
  })
  return { ok: true }
}

/**
 * 自动更新：启动后台静默检查 → 有新版用系统对话框询问 + 推给界面常驻提示
 * → 下载 → 退出时安装。
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
    // 先推给界面做常驻提示，再弹对话框 —— 用户点「稍后」也不会漏掉这次提醒
    sendUpdateStatus({
      state: 'available',
      current: app.getVersion(),
      version: info.version,
      message: `发现新版本 ${info.version}（当前 ${app.getVersion()}）`,
    })
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
      if (response === 0) startUpdateDownload()
    } catch (e) {
      console.warn('[update] 提示失败：', e && e.message ? e.message : e)
    }
  })

  autoUpdater.on('update-not-available', (info) => {
    console.log(`[update] 已是最新版本 ${app.getVersion()}`)
    sendUpdateStatus({
      state: 'latest',
      current: app.getVersion(),
      version: (info && info.version) || app.getVersion(),
      message: '已是最新版本',
    })
  })

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent || 0)
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()} — 正在下载更新 ${percent}%`)
    }
    sendUpdateStatus({
      state: 'downloading',
      current: app.getVersion(),
      percent,
      message: `正在下载更新 ${percent}%`,
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()}`)
    }
    sendUpdateStatus({
      state: 'downloaded',
      current: app.getVersion(),
      version: info.version,
      message: `新版本 ${info.version} 已下载完成，重启后生效`,
    })
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
      if (response === 0) applyUpdateAndRestart()
    } catch (e) {
      console.warn('[update] 安装提示失败：', e && e.message ? e.message : e)
    }
  })

  // 网络/权限类错误一律吞掉：更新是增强能力，不能影响正常使用。
  // 这里只记日志、不打扰用户 —— 手动检查的报错由 IPC 直接回传给界面，
  // 启动时的静默检查失败更不该弹窗（否则每次开机都要被念一遍）。
  autoUpdater.on('error', (e) => {
    const info = classifyUpdateError(e)
    console.warn(`[update] 更新检查出错（已忽略）：${info.reason} — ${info.message}`)
  })

  // 延后 6 秒再查，避免与启动阶段的解压/建库抢磁盘 IO
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      const info = classifyUpdateError(e)
      console.warn(`[update] 启动静默检查未成功：${info.reason} — ${info.message}`)
    })
  }, 6000)
}

async function bootstrap() {
  // 兜底：拿不到单实例锁的进程绝不启动内部服务（见 isSecondaryInstance 的说明）
  if (isSecondaryInstance) return
  // 「单一版本」检查必须排在最前面：一旦发现别的版本在跑，连解压/建库都不做，
  // 更不能拉起内部服务去写共享的 SQLite 库。
  await enforceSingleVersion()
  await ensureAppExtracted()
  const port = await getFreePort()
  const dbPath = ensureDatabase()
  startInternalServer(port, dbPath)
  await waitForServer(`http://127.0.0.1:${port}/api/settings/llm`)
  createWindow(port)
  setupAutoUpdate()
}

/**
 * 「单一版本使用限制」的启动闸门。
 *
 * 与 app.requestSingleInstanceLock() 分工：进程内锁只认「同一份安装」的第二个实例，
 * 且要求双方都调用它 —— 而 v1.2.0 及更早的版本没有这段代码，历史二进制改不了。
 * 它们与新版共用同一个 userData 和同一个 custom.db，同时运行就是两个写者。
 * 所以这里再主动扫一遍系统：只要发现有**另一个安装路径**的同名客户端在跑，就拒绝启动。
 */
async function enforceSingleVersion() {
  const foreign = await findForeignLabInstances(process.pid, process.execPath)
  if (foreign === null) {
    // 查询失败（PowerShell 被策略禁用 / 超时）→ 放行，只留日志。
    // 宁可少拦一次，也不能因为查不出来就把用户挡在自己的应用外面。
    console.warn('[guard] 无法枚举同名进程，本次跳过跨版本检查')
    return
  }
  if (!foreign.length) return
  console.error('[guard] 检测到其他版本的实例，拒绝启动：', JSON.stringify(foreign))
  dialog.showErrorBox('检测到另一个版本正在运行', buildConflictDetail(foreign, process.execPath))
  app.exit(0)
}

/**
 * 运行期的反向检查：新版已经在跑，用户又去点了旧版本的图标。
 *
 * 旧版本内部没有守卫代码，拦不住它自己启动 —— 能做的只有「尽快让用户知道」。
 * 挂在窗口获得焦点时触发：用户切回来往往正是因为刚点了旧图标，而且这个时机天然
 * 由用户行为驱动，不会让后台隔几秒就 spawn 一次 PowerShell。
 */
// 用「进程启动时刻」初始化节流基准：启动时 enforceSingleVersion() 刚扫过一遍，
// 窗口随后自动获得焦点会再触发一次 focus 事件，没必要紧接着重复 spawn PowerShell。
let lastForeignCheckAt = Date.now()
let foreignWarnedPids = ''
async function watchForeignInstances() {
  if (Date.now() - lastForeignCheckAt < 60_000) return
  lastForeignCheckAt = Date.now()
  const foreign = await findForeignLabInstances(process.pid, process.execPath)
  if (!foreign || !foreign.length) return
  const key = foreign.map((f) => f.pid).sort().join(',')
  if (key === foreignWarnedPids) return
  foreignWarnedPids = key
  console.error('[guard] 运行期检测到其他版本的实例：', JSON.stringify(foreign))
  sendUpdateStatus({ state: 'conflict', message: '检测到另一个版本的客户端正在运行，请关闭它以免数据冲突' })
  try {
    await dialog.showMessageBox(mainWindow, {
      type: 'warning',
      buttons: ['我知道了'],
      title: '检测到另一个版本正在运行',
      message: '另一个版本的 AI Network Lab 已启动',
      detail: buildConflictDetail(foreign, process.execPath),
    })
  } catch (e) {
    console.warn('[guard] 提醒失败：', e && e.message ? e.message : e)
  }
}

/**
 * 渲染层 IPC 的统一调用方校验：必须是本窗口的主框架，且来源是内部服务那个受信任源。
 * 返回错误字符串表示拒绝，返回 null 表示放行。
 */
function guardSender(event) {
  if (!mainWindow || event.sender !== mainWindow.webContents ||
      event.senderFrame !== mainWindow.webContents.mainFrame) {
    return 'Untrusted sender'
  }
  try {
    if (!trustedOrigin || new URL(event.senderFrame.url).origin !== trustedOrigin) return 'Untrusted origin'
  } catch {
    return 'Untrusted origin'
  }
  return null
}

/** 壳层与应用信息：界面用它显示当前版本，并判断是不是跑在桌面端 */
ipcMain.handle('app-info', async (event) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, error: bad }
  return {
    ok: true,
    version: app.getVersion(),
    isPackaged: app.isPackaged,
    platform: process.platform,
    electron: process.versions.electron,
    updateStatus: lastUpdateStatus,
  }
})

ipcMain.handle('save-file', async (event, payload) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, error: bad }
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

/**
 * 渲染层主动触发一次更新检查（「设置 → 软件更新」的手动检查按钮）。
 *
 * 与启动时的静默检查不同：这里的失败要**如实回传**，让用户知道到底怎么了
 * （原来失败只 console.warn，用户点完按钮什么反馈都没有，看起来像按钮坏了）。
 */
ipcMain.handle('check-for-updates', async (event) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, reason: 'untrusted', error: bad, current: app.getVersion() }
  if (!autoUpdater) {
    return { ok: false, reason: 'no-updater', error: '更新组件缺失', current: app.getVersion() }
  }
  if (!app.isPackaged) {
    return { ok: false, reason: 'dev', error: '开发模式不检查更新', current: app.getVersion() }
  }
  try {
    const result = await autoUpdater.checkForUpdates()
    const latest = result && result.updateInfo ? result.updateInfo.version : null
    const hasUpdate = Boolean(latest && latest !== app.getVersion())
    if (!hasUpdate) {
      sendUpdateStatus({ state: 'latest', current: app.getVersion(), version: latest, message: '已是最新版本' })
    }
    return { ok: true, current: app.getVersion(), latest, hasUpdate }
  } catch (e) {
    const info = classifyUpdateError(e)
    sendUpdateStatus({ state: 'error', reason: info.reason, message: info.message, current: app.getVersion() })
    return { ok: false, reason: info.reason, error: info.message, current: app.getVersion() }
  }
})

/** 界面上的「下载更新」按钮 */
ipcMain.handle('download-update', async (event) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, error: bad }
  return startUpdateDownload()
})

/** 界面上的「立即重启并安装」按钮 */
ipcMain.handle('install-update', async (event) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, error: bad }
  if (!autoUpdater) return { ok: false, error: '更新组件不可用' }
  applyUpdateAndRestart()
  return { ok: true }
})

/**
 * 渲染层请求用系统原生对话框挑选 Obsidian vault 目录。
 * 浏览器环境拿不到目录的绝对路径，只有壳层能提供，所以这里走 IPC。
 * 注意：只负责「选目录并回传路径」，真正的写盘由内部服务完成
 * （见 src/app/api/notes/export/obsidian/route.ts），避免多开一条写文件通道。
 */
ipcMain.handle('obsidian-pick-vault', async (event) => {
  const bad = guardSender(event)
  if (bad) return { ok: false, error: bad }
  try {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      title: '选择 Obsidian vault 目录',
      buttonLabel: '选用此目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { ok: false, canceled: true }
    }
    return { ok: true, path: result.filePaths[0] }
  } catch (e) {
    return { ok: false, error: e && e.message ? e.message : String(e) }
  }
})

// 以下启动与生命周期钩子只在「拿到单实例锁」的进程里注册。
// 第二个实例在上面已经 exit，这里再挡一道，避免 quit 竞态下重复拉起内部服务。
if (!isSecondaryInstance) {
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
}
