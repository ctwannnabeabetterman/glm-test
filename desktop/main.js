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

const { app, BrowserWindow, Menu, shell } = require('electron')
const { spawn, execFile } = require('child_process')
const net = require('net')
const http = require('http')
const path = require('path')
const fs = require('fs')
const { migrateDatabase } = require('./migrate-database')

let mainWindow = null
let serverProc = null

/** 读取 zip 内 BUILD_ID（Next 每次构建都会生成不同值，用作版本标识）；失败返回 null */
function readZipBuildId(zip) {
  return new Promise((resolve) => {
    execFile('tar', ['-xOf', zip, '.next/BUILD_ID'], { windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null)
      resolve(String(stdout).trim())
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
 * 解压随包携带的 resources/app.zip 到 resources/app（standalone 服务本体）。
 * 以 BUILD_ID 为版本标识：仅当「已解压目录的版本 == 当前 zip 的版本」时跳过；
 * 版本不一致（升级/重装，zip 更新过而旧目录仍是旧代码）则删除旧目录重新解压，
 * 确保每次更新后客户端加载最新代码，而不是残留上一次解压的旧版本。
 */
function ensureAppExtracted() {
  if (!app.isPackaged) return Promise.resolve()
  const resDir = process.resourcesPath
  const appDir = path.join(resDir, 'app')
  const zip = path.join(resDir, 'app.zip')

  return readZipBuildId(zip).then((zipBuildId) => {
    const serverJs = path.join(appDir, 'server.js')
    const appBuildId = readAppBuildId(appDir)

    // 已解压且版本与当前 zip 一致 → 直接复用，无需重解压
    if (zipBuildId && serverJs && fs.existsSync(serverJs) && appBuildId === zipBuildId) {
      return
    }
    // 缺 zip 且从未解压过 → 安装不完整
    if (!fs.existsSync(zip)) {
      if (serverJs && fs.existsSync(serverJs)) return // 有旧解压产物可兜底
      throw new Error('安装不完整：缺少内置服务包 app.zip')
    }

    // 版本不一致或缺失 → 删除旧目录重新解压
    fs.rmSync(appDir, { recursive: true, force: true })
    fs.mkdirSync(appDir, { recursive: true })
    return new Promise((resolve, reject) => {
      execFile('tar', ['-xf', zip, '-C', appDir], { windowsHide: true }, (err) => {
        if (err) return reject(new Error('内置服务解压失败：' + err.message))
        resolve()
      })
    })
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
  migrateDatabase(dbPath)
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

async function bootstrap() {
  await ensureAppExtracted()
  const port = await getFreePort()
  const dbPath = ensureDatabase()
  startInternalServer(port, dbPath)
  await waitForServer(`http://127.0.0.1:${port}/api/settings/llm`)
  createWindow(port)
}

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
