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
const {
  registerAppHardening,
  registerWindowHardening,
} = require('./hardening')

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
 * 用户是否主动发起过下载/安装。
 *
 * 用途：区分「后台静默检查失败」和「用户点过按钮之后失败」。
 * 前者只记日志（不能开机就弹错误框），后者必须回传到界面 —— 否则「点了按钮没反应」
 * 与「按钮坏了」在用户看来毫无区别。
 */
let updateActionInFlight = false

/**
 * 下载停滞看门狗 —— 「点了下载却永远下不完」的真正解药。
 *
 * 为什么必须有：electron-updater 底层走 Electron 的 net 模块，**没有任何超时**。
 * 网络一旦不吐数据（国内直连 GitHub Releases 很常见），`downloadUpdate()` 返回的 Promise
 * 就一直挂着：既不 resolve 也不 reject，`download-progress` 也不再触发。
 * 用户看到的就是「进度停在 37% 再也不动，也不报错」—— 也就是「下载无法完成」。
 * 唯一的办法是我们自己判定「下载期间多久没收到任何进度」，然后给出可操作的状态。
 *
 * 判定口径：下载中每收到一次 `download-progress` 就重新计时；超过 DOWNLOAD_STALL_MS 没有任何
 * 进度 ⇒ 认定卡住，推一个 reason='stalled' 的错误态（界面据此显示「重试下载」+ 手动下载入口）。
 */
const DOWNLOAD_STALL_MS = 45_000
let downloadStallTimer = null
let downloadLastPercent = 0

/**
 * 最近一次成功下载的安装包绝对路径。
 *
 * 用途：用户那句「不知道怎么下的」—— 他既不窗口标题、也没进设置页，
 * 就完全不知道安装包去了哪里。把它记下来，既能在安装确认框里显示，
 * 也能随状态推给界面做「安装包位置」提示，用户想手动重装时能直接找到。
 */
let lastDownloadedFile = ''

/** 已落盘的最后一个「10% 档位」进度；避免每一帧都写日志把文件刷爆 */
let downloadLoggedBucket = -1

function clearDownloadStallWatch() {
  if (downloadStallTimer) {
    clearTimeout(downloadStallTimer)
    downloadStallTimer = null
  }
}

function armDownloadStallWatch() {
  clearDownloadStallWatch()
  downloadStallTimer = setTimeout(() => {
    downloadStallTimer = null
    // 只有「用户主动发起的下载」才打扰用户；后台检查阶段的异常留给 error 事件记日志
    if (!updateActionInFlight) return
    const sec = Math.round(DOWNLOAD_STALL_MS / 1000)
    logUpdate(`下载停滞：${sec} 秒内没有收到任何进度（停在 ${downloadLastPercent}%），判定为卡住`)
    updateActionInFlight = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()}`)
    }
    sendUpdateStatus({
      state: 'error',
      reason: 'stalled',
      current: app.getVersion(),
      percent: downloadLastPercent,
      message:
        `下载卡住了：${sec} 秒没有收到任何数据（停在 ${downloadLastPercent}%）。` +
        '通常是网络无法稳定访问 GitHub 所致。可以点「重试下载」；' +
        '若反复卡住，请用下面的「发布页手动下载」。',
    })
  }, DOWNLOAD_STALL_MS)
}

/** 把字节/秒格式化成人看的字符串（0 或未知时返回空串） */
function formatSpeed(bytesPerSecond) {
  const v = Number(bytesPerSecond) || 0
  if (v <= 0) return ''
  if (v >= 1024 * 1024) return `${(v / 1024 / 1024).toFixed(1)} MB/s`
  return `${Math.max(1, Math.round(v / 1024))} KB/s`
}

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

/** 更新日志文件大小上限；超过就只保留尾部，避免长期使用后无限增长 */
const UPDATE_LOG_MAX_BYTES = 512 * 1024

/**
 * 更新链路的落盘日志（%APPDATA%\ai-network-lab\logs\update.log）。
 *
 * 为什么必须有：打包后的应用没有控制台，而 electron-updater 的输出、以及
 * 「安装器根本没起来」这类故障，全都发生在应用退出前后 —— 应用侧一行痕迹都不留。
 * 2026-09-17 本机排查「点击更新闪退」时，唯一的线索是安装目录里一个 178 字节的
 * debug.log 和 %LOCALAPPDATA%\ai-network-lab-updater 的残留；真正卡住的位置
 * （NSIS 先跑旧卸载器那一步）只能靠倒推。有了这个文件，下次一眼就能看到
 * 安装器路径、传了哪些参数、以及应用到底有没有退出。
 *
 * 日志写失败绝不允许影响更新本身，所以整段都吞异常。
 */
let updateLogPath = null
function logUpdate(...parts) {
  const line = `[${new Date().toISOString()}] ${parts.join(' ')}`
  // 无论如不成功都留一份到 stdout：开发模式（npm run desktop:dev）能直接看到
  console.log(line)
  try {
    if (!updateLogPath) updateLogPath = path.join(app.getPath('userData'), 'logs', 'update.log')
    fs.mkdirSync(path.dirname(updateLogPath), { recursive: true })
    try {
      if (fs.statSync(updateLogPath).size > UPDATE_LOG_MAX_BYTES) {
        fs.writeFileSync(updateLogPath, fs.readFileSync(updateLogPath, 'utf8').slice(-UPDATE_LOG_MAX_BYTES / 4))
      }
    } catch {
      /* 首次运行时文件还不存在 */
    }
    fs.appendFileSync(updateLogPath, line + '\n')
  } catch {
    /* 日志是诊断手段，不是功能：写不进去也必须继续跑更新 */
  }
}

/** 把 electron-updater 的内部日志也接到同一个文件里 */
function attachUpdaterLogger(updater) {
  updater.logger = {
    info: (m) => logUpdate('[updater:info]', m),
    warn: (m) => logUpdate('[updater:warn]', m),
    error: (m) => logUpdate('[updater:error]', m),
    debug: (m) => logUpdate('[updater:debug]', m),
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

/** 单次 tar 解压。失败时把 tar 的原始输出包进 Error —— 那是唯一的现场证据 */
function tarExtractOnce(zip, destDir) {
  return new Promise((resolve, reject) => {
    execFile(resolveTar(), ['-xf', zip, '-C', destDir], { windowsHide: true }, (err) => {
      if (err) return reject(new Error('内置服务解压失败：' + err.message))
      resolve()
    })
  })
}

/** 解压失败后的重试次数（含首次） */
const EXTRACT_ATTEMPTS = 3

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * 清空 staging 目录但保留目录本身。
 * 清理失败只记日志：下一轮可能因此在同一处再失败，但不能拿它盖掉 tar 的原始错误。
 */
function resetStagingDir(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true })
    fs.mkdirSync(dir, { recursive: true })
  } catch (e) {
    console.warn('[desktop] 清理解压暂存目录失败：', e && e.message ? e.message : e)
  }
}

/**
 * 解压内置服务包，**带退避重试**。
 *
 * 为什么必须重试（2026-09-17 实测）：用户第一次启动 1.3.3 时解压失败，报
 *   `tar.exe: .next/node_modules/pdfkit-<hash>: Can't create '...app.new\...': Invalid argument`
 *   `tar.exe: .next/node_modules/@prisma/client-<hash>: Can't create ...: Invalid argument`
 * 而**把同一条命令原样手动重跑一次就完全成功**（同一份 app.zip、同一个目标路径、
 * 那两个"失败"的目录也正常建出来了），并且 app.zip 里最长的条目路径只有 177 字符
 * （远不到 MAX_PATH），tar.exe / 磁盘空间 / 库版本全都正常。
 * ⇒ **不是包坏了，是当时的环境抖动。** 最可能是杀软（本机是 360 安全卫士，
 * Defender 实时防护反而是关的）恰好在新装完 125 MB 主程序的窗口期扫描安装目录，
 * 拦下了两个目录的创建；并发解压（上一个卡住的进程留下 app.new，新实例又去
 * rmSync + mkdir）也会让某一轮随机几个目录建不出来。
 *
 * 代价极不对称：一个"再试一次就好"的抖动，会让用户看到「AI Network Lab 启动失败」
 * 然后应用直接退出、且**没有任何应用日志**（日志是在解压成功之后的 setupAutoUpdate
 * 里才初始化的）。所以这里做退避重试。
 *
 * 重试前必须把上一轮的半成品清干净 —— tar 失败时已经在 app.new 里留下了部分目录，
 * 不清掉下一轮会在同一位置继续失败。
 */
async function extractZip(zip, destDir) {
  let lastErr = null
  for (let attempt = 1; attempt <= EXTRACT_ATTEMPTS; attempt++) {
    try {
      await tarExtractOnce(zip, destDir)
      if (attempt > 1) console.log(`[desktop] 内置服务解压在第 ${attempt} 次尝试成功`)
      return
    } catch (e) {
      lastErr = e
      console.warn(`[desktop] 内置服务解压失败（第 ${attempt}/${EXTRACT_ATTEMPTS} 次）：`, e.message)
      if (attempt < EXTRACT_ATTEMPTS) {
        resetStagingDir(destDir)
        await delay(1500 * attempt)
      }
    }
  }
  throw lastErr
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
      // 以下几项在 Electron 里默认就是关的，这里显式写出来是为了「改不回去」——
      // 任何一项打开都等于在渲染进程里开一个逃逸口，写死能防住后续误改。
      nodeIntegrationInWorker: false,
      nodeIntegrationInSubFrames: false,
      webviewTag: false,
      allowRunningInsecureContent: false,
      experimentalFeatures: false,
      // 省内存：本应用没有任何需要拼写检查的输入场景
      spellcheck: false,
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

  // 安全加固（DevTools 锁定 + 导航白名单）—— 细节见 desktop/hardening.js
  registerWindowHardening(mainWindow, {
    isPackaged: app.isPackaged,
    trustedOrigin,
  })

  mainWindow.once('ready-to-show', () => mainWindow.show())
  mainWindow.loadURL(`http://127.0.0.1:${port}/`)

  // 窗口重新获得焦点时做一次「是不是又开了别的版本」的复检（内部已按 60s 节流）。
  // 用户切回来这个动作本身往往就意味着他刚点过旧版本的图标。
  mainWindow.on('focus', () => {
    void watchForeignInstances()
  })
}

/**
 * 「静默安装」的观感问题 —— 为什么安装阶段**没有进度条**，以及我们怎么补偿。
 *
 * 根因（不是 bug，是 NSIS 模板的硬约束）：
 *   quitAndInstall(true, true) 实际以 `--updated /S --force-run` 调起安装包，
 *   其中 `/S` 是 NSIS 的**静默安装**开关 ⇒ 安装器全程不绘制任何界面，
 *   自然也就没有任何进度条。而 /S 又**不能去掉**（见下），所以「安装时有进度条」
 *   在架构上就做不到。
 *
 * 更关键的一点：quitAndInstall 会立刻退出应用，等安装器开始干活时本进程已经没了
 *   ⇒ 渲染层连一次 setState 的机会都没有。所以任何「安装中」的 UI 都是幻觉，
 *   我们唯一能做的，是把**反馈前移**：在退出之前用确认框把「将要发生什么」讲清楚。
 *
 * 这也是用户反馈「不知道怎么下的 / 需要重启安装 / 安装没有进度条」的直接答案：
 *   他看到的只有「点了按钮 → 窗口消失 → 几十秒后窗口自己回来」，
 *   中间没有任何解释，所以只能猜。
 *
 * ⚠️ 两个参数都**不能省**，它们是 electron-builder 的 NSIS 模板定下的硬约束
 *    （见 app-builder-lib/templates/nsis/installSection.nsh 末尾）：
 *      · 本项目用的是 assisted 安装器（electron-builder.yml 里 nsis.oneClick=false），
 *        模板中「装完自动拉起应用」的条件是 `${if} ${isForceRun} ${andIf} ${Silent}`
 *        —— **只有静默安装才会把应用拉起来**。所以 isSilent 必须是 true；
 *        否则安装完成后应用不会回来，用户看到的就是「点了更新，应用直接闪退、还得自己开」。
 *      · isForceRunAfter=true 才会带上 --force-run（上面那个条件的一半）。
 *    合起来等价于命令行 `--updated /S --force-run`。
 *
 * ⚠️ 这里刻意**不**提前 kill 内部服务、也不提前置 app.isQuitting：
 *    quitAndInstall 是「立即返回、随后才真正拉起安装器」的，而 install() 可能失败
 *    （更新缓存被清、安装器被安全软件拦下、spawn 报 EACCES 等）。一旦失败应用并不会退出，
 *    而内部服务已经被我们杀掉 ⇒ 界面所有接口全部失败，看起来就是「点完更新，整个界面显示异常」。
 *    交给正常退出流程（before-quit）去收服务即可：app.quit() 紧随 install() 之后，
 *    释放 resources/app 句柄的时机依然早于安装器动手。
 *
 * 另外加一道守护：quitAndInstall 只在 install() 成功时才会真的退出。几秒后我们还活着，
 * 就说明安装压根没起来 —— 明确告诉用户，而不是让他对着一个「点了没反应」的界面猜。
 */
async function applyUpdateAndRestart() {
  if (!autoUpdater) return { ok: false, error: '更新组件不可用' }
  if (!app.isPackaged) return { ok: false, error: '开发模式不安装更新' }

  // ── 退出前把「接下来会发生什么」说清楚 ──────────────────────────────────
  // 这一步是「安装没有进度条」这个反馈的唯一可行解法：安装阶段给不了进度，
  // 所以把预期讲在前面，用户就不会把「窗口消失」误读成崩溃、也不会以为卡死了。
  if (mainWindow && !mainWindow.isDestroyed()) {
    try {
      const { response } = await dialog.showMessageBox(mainWindow, {
        type: 'info',
        buttons: ['现在重启并安装', '稍后'],
        defaultId: 0,
        cancelId: 1,
        title: '准备安装更新',
        message: `即将安装新版本并重启应用`,
        detail:
          '接下来会发生的事：\n' +
          '1. 应用窗口会立即关闭；\n' +
          '2. 安装程序在后台自动完成（静默安装，**不会显示进度条**，这是正常的）；\n' +
          '3. 大约 10–60 秒后应用会自己重新打开，版本即为新版。\n\n' +
          '安装期间请不要手动结束安装程序。如果一分钟后应用没有回来，\n' +
          '可以手动打开「AI Network Lab」图标；版本还是旧的就去发布页手动下载。\n\n' +
          `安装包位置：\n${lastDownloadedFile || '(未知，见更新日志)'}`,
      })
      if (response !== 0) return { ok: true, canceled: true }
    } catch (e) {
      // 对话框弹不出来（极端情况）不应该阻止安装，继续往下走
      console.warn('[update] 安装确认框失败：', e && e.message ? e.message : e)
    }
  }

  updateActionInFlight = true
  logUpdate(`quitAndInstall(isSilent=true, isForceRunAfter=true)，当前版本 ${app.getVersion()}`)
  setImmediate(() => {
    try {
      autoUpdater.quitAndInstall(true, true)
    } catch (e) {
      const info = classifyUpdateError(e)
      updateActionInFlight = false
      logUpdate(`quitAndInstall 抛错：${info.reason} — ${info.message}`)
      sendUpdateStatus({ state: 'error', reason: info.reason, message: info.message, current: app.getVersion() })
      dialog.showErrorBox('安装更新失败', info.message)
      return
    }
    setTimeout(() => {
      // app.isQuitting 只在 before-quit 里置位 ⇒ 到这里还活着就说明退出流程根本没开始
      if (app.isQuitting) return
      updateActionInFlight = false
      const message =
        '更新安装没有启动（应用没有退出）。安装包已经下载好，可以稍后在「设置 → 软件更新」里重试；' +
        '若反复失败，请到发布页手动下载安装包。'
      logUpdate('quitAndInstall 之后应用仍在运行 ⇒ 安装未启动（install() 返回 false 或安装器 spawn 失败）')
      sendUpdateStatus({ state: 'error', reason: 'install-not-started', message, current: app.getVersion() })
      dialog.showErrorBox('安装更新没有启动', message)
    }, 5000)
  })
  return { ok: true }
}

/** 开始下载更新（系统对话框与界面按钮共用同一条路径，行为一致） */
function startUpdateDownload() {
  if (!autoUpdater) return { ok: false, error: '更新组件不可用' }
  if (!app.isPackaged) return { ok: false, error: '开发模式不下载更新' }
  updateActionInFlight = true
  downloadLastPercent = 0
  downloadLoggedBucket = -1
  // 立刻开始计时：连第一个 download-progress 都收不到（DNS 卡死 / 连不上）同样会被判成停滞
  armDownloadStallWatch()
  logUpdate('开始下载更新，当前版本', app.getVersion())
  sendUpdateStatus({
    state: 'downloading',
    current: app.getVersion(),
    percent: 0,
    message: '正在下载更新…',
  })
  autoUpdater.downloadUpdate().catch((e) => {
    clearDownloadStallWatch()
    const info = classifyUpdateError(e)
    // 看门狗可能已经先一步判定「停滞」并推过状态了。这时 Promise 才 reject 属于同一个故障，
    // 再弹一次错误框只会让用户以为坏了两次。
    if (lastUpdateStatus && lastUpdateStatus.state === 'error' && lastUpdateStatus.reason === 'stalled') {
      logUpdate(`下载失败（已按停滞处理过，不重复提示）：${info.reason} — ${info.message}`)
      return
    }
    updateActionInFlight = false
    logUpdate(`下载失败：${info.reason} — ${info.message}`)
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
  attachUpdaterLogger(autoUpdater)
  // ⚠️ 这里以前打印的是 userData/../ai-network-lab-updater（= %APPDATA% 下），但 electron-updater
  //    真正用的基目录是 `app.getPath('cache')`（Windows = %LOCALAPPDATA%），名字才是 `${app.name}-updater`。
  //    按旧日志去找「下载到底落没落盘」会白跑一趟，反而怀疑「下载根本没写文件」。
  //    改成「列候选 + 报哪个真实存在」，宁可啰嗦也不给错地址。
  const updaterCacheCandidates = [
    path.join(app.getPath('cache'), `${app.name}-updater`),
    path.join(app.getPath('cache'), 'ai-network-lab-updater'),
    path.join(app.getPath('userData'), '..', `${app.name}-updater`),
  ].map((p) => path.resolve(p))
  const updaterCacheDir = updaterCacheCandidates.find((p) => fs.existsSync(p))
  logUpdate(
    `自动更新就绪：版本 ${app.getVersion()}，electron ${process.versions.electron}，` +
      `缓存目录 ${updaterCacheDir || `尚未创建（候选：${updaterCacheCandidates.join(' | ')}）`}`,
  )

  autoUpdater.on('update-available', async (info) => {
    logUpdate(`发现新版本 ${info.version}（当前 ${app.getVersion()}）`)
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
    logUpdate(`已是最新版本 ${app.getVersion()}`)
    updateActionInFlight = false
    sendUpdateStatus({
      state: 'latest',
      current: app.getVersion(),
      version: (info && info.version) || app.getVersion(),
      message: '已是最新版本',
    })
  })

  autoUpdater.on('download-progress', (p) => {
    const percent = Math.round(p.percent || 0)
    downloadLastPercent = percent
    // 收到任何进度就说明连接还活着 —— 重新计时（这就是看门狗的「喂狗」动作）
    armDownloadStallWatch()
    const speed = formatSpeed(p.bytesPerSecond)
    // 按 10% 一档落盘：进度以前只走 IPC 给界面，日志里一行都不留。
    // 结果就是「下载花了三分半、日志上只有开始和结束两行」，事后完全无法判断
    // 到底是「一直在慢慢下」还是「中途卡了很久又恢复」——排查时全凭猜。
    const bucket = Math.floor(percent / 10) * 10
    if (bucket > downloadLoggedBucket) {
      downloadLoggedBucket = bucket
      logUpdate(`下载进度 ${percent}%${speed ? `（${speed}）` : ''}`)
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()} — 正在下载更新 ${percent}%${speed ? `（${speed}）` : ''}`)
    }
    sendUpdateStatus({
      state: 'downloading',
      current: app.getVersion(),
      percent,
      speed: Number(p.bytesPerSecond) || 0,
      transferred: Number(p.transferred) || 0,
      total: Number(p.total) || 0,
      message: `正在下载更新 ${percent}%${speed ? `（${speed}）` : ''}`,
    })
  })

  autoUpdater.on('update-downloaded', async (info) => {
    // 下载已经落地，看门狗必须立刻停：否则停在 100% 后 45 秒会误报「卡住」
    clearDownloadStallWatch()
    // 把安装包的真实落盘路径与版本记下来：这是「下载成功但装不上」时唯一能对着查的东西，
    // 也是回答用户「不知道怎么下的」的直接素材（安装包到底在哪）
    lastDownloadedFile = info.downloadedFile || ''
    logUpdate(`更新下载完成 ${info.version}，安装包：${info.downloadedFile || '(未知路径)'}`)
    updateActionInFlight = false
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.setTitle(`AI Network Lab ${app.getVersion()}`)
    }
    sendUpdateStatus({
      state: 'downloaded',
      current: app.getVersion(),
      version: info.version,
      file: lastDownloadedFile,
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
        detail:
          '选择「立即重启并安装」会关闭应用并完成更新；也可以稍后退出时自动安装。\n\n' +
          '安装包已经下载到本机（可在「设置 → 软件更新」里看到确切路径），\n' +
          '所以不需要再联网下载一次。\n\n' +
          '提示：安装前请关闭可能正在占用安装目录的程序（例如把该目录当作工作目录的编辑器或同步工具），' +
          '否则安装器可能卡在「清理旧版本」这一步。',
      })
      if (response === 0) applyUpdateAndRestart()
    } catch (e) {
      console.warn('[update] 安装提示失败：', e && e.message ? e.message : e)
    }
  })

  // 启动时的静默检查失败一律只记日志、不打扰用户（否则每次开机都要被念一遍）。
  // 但**用户主动点过下载/安装之后**的失败必须回传到界面 —— 安装阶段失败尤其隐蔽：
  // 它发生在应用即将退出的窗口期，用户那边只看到「点了没反应」，日志里才有真相。
  autoUpdater.on('error', (e) => {
    clearDownloadStallWatch()
    const info = classifyUpdateError(e)
    logUpdate(`更新出错：${info.reason} — ${info.message}`)
    if (updateActionInFlight) {
      updateActionInFlight = false
      sendUpdateStatus({ state: 'error', reason: info.reason, message: info.message, current: app.getVersion() })
    }
  })

  // 延后 6 秒再查，避免与启动阶段的解压/建库抢磁盘 IO
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => {
      const info = classifyUpdateError(e)
      logUpdate(`启动静默检查未成功：${info.reason} — ${info.message}`)
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
  // 端口确定后受信任源才成立，CSP / 导航白名单都依赖它 —— 因此加固放在这一行之后。
  registerAppHardening({
    isPackaged: app.isPackaged,
    trustedOrigin: `http://127.0.0.1:${port}`,
  })
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
    updateActionInFlight = true
    logUpdate('手动检查更新…')
    const result = await autoUpdater.checkForUpdates()
    const latest = result && result.updateInfo ? result.updateInfo.version : null
    const hasUpdate = Boolean(latest && latest !== app.getVersion())
    logUpdate(`手动检查结果：当前 ${app.getVersion()}，更新源 ${latest}，hasUpdate=${hasUpdate}`)
    updateActionInFlight = false
    if (!hasUpdate) {
      sendUpdateStatus({ state: 'latest', current: app.getVersion(), version: latest, message: '已是最新版本' })
    }
    return { ok: true, current: app.getVersion(), latest, hasUpdate }
  } catch (e) {
    const info = classifyUpdateError(e)
    updateActionInFlight = false
    logUpdate(`手动检查失败：${info.reason} — ${info.message}`)
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
  return applyUpdateAndRestart()
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
