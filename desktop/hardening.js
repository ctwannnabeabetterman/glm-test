'use strict'

/**
 * Electron 壳层安全加固 —— 集中在一处，便于审阅与回归。
 *
 * 背景：本应用把「Next 自包含服务」跑在 127.0.0.1 的随机端口上，窗口加载该地址。
 * 这意味着渲染进程本质上是一个**完整浏览器**，且同源下就是应用后端。
 * 默认配置并不会替我们收紧什么，因此需要显式关闭一批攻击面。
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 已有的基线（此前就在 main.js 里，这里只是补齐其余部分）
 * ═══════════════════════════════════════════════════════════════════════════
 *   · webPreferences.contextIsolation = true   —— 页面脚本拿不到 Node 的 require
 *   · webPreferences.nodeIntegration  = false
 *   · webPreferences.sandbox          = true
 *   · Menu.setApplicationMenu(null)            —— 去掉 View → Toggle Developer Tools
 *   · setWindowOpenHandler                     —— 外链交给系统浏览器，不在壳内开新窗
 *   · guardSender()                            —— 每个 IPC handler 校验调用方主框架 + 来源
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * 本模块补上的部分
 * ═══════════════════════════════════════════════════════════════════════════
 *   1. 生产环境**关死 DevTools**（含 F12/Ctrl+Shift+I/J/C、Ctrl+U 查源码）
 *      —— 开着 DevTools 等于把「读内存里的 API Key、改前端逻辑绕过校验」
 *         变成点两下就能干的事。
 *   2. 导航白名单：任何非受信任源的跳转一律拒绝
 *      —— 防止页面被注入的链接把窗口导航到外部站点（那样外部站点就获得了
 *         与内部服务同源的……不，是同窗口；真正的风险是它随后能通过
 *         window.open 之外的路径触碰 preload 暴露的 IPC 通道）。
 *   3. 拒绝一切权限请求（摄像头/麦克风/定位/通知/剪贴板读…）
 *      —— 科研工作台不需要这些，全部关掉比逐个评估更安全。
 *   4. CSP 响应头：限制渲染进程能加载与连接的目标
 *      —— 见 applyCsp 的详细说明（含为什么必须留 'unsafe-inline'）。
 *   5. 关闭 webview / 子框架 Node / 不安全内容 / 拼写检查
 *
 * ⚠️ 设计原则：**这里只做「收紧」，不做任何可能影响正常功能的行为**。
 *    唯一的例外是 CSP，它确实可能拦掉合法资源 —— 因此它的策略被写成
 *    与实测产物匹配的形式，并在改版后必须重新跑一次截图验证。
 */

/**
 * 本模块**刻意不在顶层 require('electron')** —— 否则它就无法在 vitest 这样的
 * 纯 Node 环境下被单测（顶层一 require 就把运行时绑死了）。所有 electron 依赖
 * 都在用到时取，或由调用方注入替身。
 */

/** 生产构建里 CSP 允许的来源。改这里前先读 applyCsp 的注释。 */
function buildCsp() {
  return [
    "default-src 'self'",
    // Next.js 的 App Router 会在 HTML 里内联一段引导脚本（本项目的主题初始化
    // 也是内联脚本，见 src/app/layout.tsx），无法用 nonce 覆盖所有情况，
    // 因此必须保留 'unsafe-inline'。这是本项目 CSP 里唯一的让步。
    // 之所以可接受：页面内容全部来自本地打包产物，不存在第三方注入面；
    // 真正的攻击面前提「能往页面里插脚本」在当前架构下并不成立。
    "script-src 'self' 'unsafe-inline'",
    // Radix / sonner 等组件会注入行内 style 属性
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    // 渲染进程只需要访问同源的 /api/*；所有外部网络请求都发生在服务端
    // （LLM 调用、Zotero 同步等），因此这里可以收得很紧。
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ')
}

/**
 * 给受信任源的响应加上 CSP。
 *
 * 只对 `trustedOrigin` 生效：内部服务是唯一被加载的源，其他响应（比如
 * 将来若引入的任何外部资源）不应该被套上本应用的策略。
 */
function applyCsp(trustedOrigin, sessionRef) {
  if (!trustedOrigin) return
  const csp = buildCsp()
  sessionRef.webRequest.onHeadersReceived((details, callback) => {
    if (!details.url || !details.url.startsWith(trustedOrigin)) {
      callback({ responseHeaders: details.responseHeaders })
      return
    }
    const headers = Object.assign({}, details.responseHeaders)
    // 覆盖而非追加：重复的 CSP 头在浏览器里是「取交集」，会让策略变得难以预测
    for (const k of Object.keys(headers)) {
      if (k.toLowerCase() === 'content-security-policy') delete headers[k]
    }
    headers['Content-Security-Policy'] = [csp]
    headers['X-Content-Type-Options'] = ['nosniff']
    callback({ responseHeaders: headers })
  })
}

/**
 * 开发态**不启用 CSP**。
 *
 * 原因：`next dev` 的 Turbopack HMR 走 eval 动态求值，`script-src` 里没有
 * 'unsafe-eval' 会直接把开发服务器打死 —— 得先能干活，才谈得上加固。
 *
 * ⚠️ 代价是「CSP 在开发期不受检验」，所以配了两道补偿：
 *   ① `ANL_FORCE_CSP=1` 可在开发态强行打开，用于本地验证策略是否兼容；
 *   ② 打包态会挂 CSP 违规监听（见 watchCspViolations），一旦真有资源被拦，
 *      日志里能直接看到是哪条指令拦了哪个 URL —— 而不是只对着一个白屏猜。
 */
function shouldApplyCsp(isPackaged) {
  if (process.env.ANL_FORCE_CSP === '1') return true
  if (process.env.ANL_FORCE_CSP === '0') return false
  return Boolean(isPackaged)
}

/**
 * 监听渲染层的 CSP 违规并写进日志。
 *
 * 这是 CSP 唯一的「自证清白」手段：策略一旦拦错东西，用户看到的是白屏或
 * 某块功能静默失效，光看现象根本定位不到。把违规原样记下来，
 * 下次排查直接 grep 'CSP' 就有答案。
 */
function watchCspViolations(win) {
  win.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    if (typeof message !== 'string') return
    // Chromium 把 CSP 违规以 error 级 console 消息抛出
    if (/Content Security Policy|Refused to (load|connect|execute|apply)/i.test(message)) {
      console.error(`[security][CSP] ${message}${sourceId ? ` (${sourceId}:${line})` : ''}`)
    }
  })
}

/** 拒绝所有权限请求（默认拒绝，不做任何例外） */
function denyAllPermissions(sessionRef) {
  sessionRef.setPermissionRequestHandler((_wc, _permission, callback) => callback(false))
  // 同步查询路径也要拒 —— 有些 API 不经过 request handler
  sessionRef.setPermissionCheckHandler(() => false)
  // 设备选择器（USB / 串口 / HID）同样关闭
  if (typeof sessionRef.setDevicePermissionHandler === 'function') {
    sessionRef.setDevicePermissionHandler(() => false)
  }
}

/**
 * 关死 DevTools，并拦掉打开它的快捷键。
 *
 * 分两层：
 *  ① `devtools-opened` → 立刻 closeDevTools()。兜住所有「已经开出来」的路径
 *     （包含用户装的外部插件、命令行开关等）。
 *  ② `before-input-event` → 拦掉快捷键本身。因为 ① 会造成「闪一下又关」的观感，
 *     而且在 DevTools 里已经能读到内存，闪一下也可能够用。两层一起上。
 *
 * 只在 `isPackaged`（打包态）生效，开发时照常可调试。
 */
function lockDownDevTools(win, isPackaged) {
  if (!isPackaged) return
  const wc = win.webContents

  wc.on('devtools-opened', () => {
    console.warn('[security] 检测到 DevTools 被打开，已强制关闭')
    try {
      wc.closeDevTools()
    } catch {
      /* 可能已经关了 */
    }
  })

  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const key = (input.key || '').toLowerCase()
    const ctrl = input.control || input.meta
    const blocked =
      key === 'f12' ||
      (ctrl && input.shift && (key === 'i' || key === 'j' || key === 'c')) ||
      (ctrl && key === 'u')
    if (blocked) {
      event.preventDefault()
      console.warn(`[security] 已拦截调试快捷键: ${input.key}`)
    }
  })
}

/**
 * 延迟取 electron 的 shell。
 *
 * 不用模块顶层 `require('electron')` 是因为这样一个纯逻辑模块就没法在
 * vitest 里直接单测了 —— 顶层一旦 require 就绑死了运行时。
 * 这里改成用到时才取，并允许调用方传入替身（见 guardNavigation 的 shellRef 参数）。
 */
function electronShell() {
  try {
    return require('electron').shell
  } catch {
    return null
  }
}

/**
 * 导航白名单：窗口只允许停留在受信任源上。
 *
 * 页面里确实有大量 `<a href="https://..." target="_blank">`（论文链接、IEEE 检索等），
 * 但那类链接走的是 window.open 路径，由 `setWindowOpenHandler` 交给系统浏览器。
 * 真正要拦的是**当前窗口自身**被导航走：一旦导航到外部站点，该站点的脚本就跑在
 * 一个挂着我们 preload 的窗口里，能直接调用 electronSaveFile / electronInstallUpdate
 * 这些 IPC 通道（guardSender 会因来源不符而拒绝，但不能把安全性只押在一层上）。
 */
function guardNavigation(win, trustedOrigin, shellRef) {
  if (!trustedOrigin) return
  const openExternal = (url) => {
    const sh = shellRef || electronShell()
    if (sh && /^https?:\/\//.test(url)) {
      try {
        sh.openExternal(url)
      } catch {
        /* 打不开就算了，绝不能让"顺手打开浏览器"失败反过来影响主流程 */
      }
    }
  }

  win.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith(trustedOrigin)) return
    event.preventDefault()
    console.warn('[security] 已阻止窗口导航到外部地址:', url)
    openExternal(url)
  })

  // 子框架（iframe）一律不放行到外部
  win.webContents.on('will-frame-navigate', (event) => {
    const url = event.url || ''
    if (url && !url.startsWith(trustedOrigin)) {
      event.preventDefault()
      console.warn('[security] 已阻止子框架导航:', url)
    }
  })
}

/**
 * 统一的加固入口。
 *
 * 调用时机：`app.whenReady()` 之后、创建窗口之前（session 已可用），
 * 窗口相关的部分在 createWindow 内调用 registerWindowHardening()。
 */
function registerAppHardening({ isPackaged, trustedOrigin, sessionRef, shellRef }) {
  const ses = sessionRef || require('electron').session.defaultSession

  // 关掉拼写检查：既是省内存，也避免输入内容被系统检查器读走
  try {
    ses.setSpellCheckerEnabled(false)
  } catch {
    /* 老版本 Electron 没有这个方法 */
  }

  denyAllPermissions(ses)

  const cspOn = shouldApplyCsp(isPackaged)
  if (cspOn) applyCsp(trustedOrigin, ses)

  // 禁止任何 webview 挂载（本项目未使用，但默认是允许的）
  const { app } = require('electron')
  app.on('web-contents-created', (_e, contents) => {
    contents.on('will-attach-webview', (event) => {
      event.preventDefault()
      console.warn('[security] 已阻止 webview 挂载')
    })
  })

  console.log(
    `[security] 加固已启用：权限全拒${isPackaged ? ' / DevTools 锁定 / 导航白名单' : ''}` +
      ` / CSP ${cspOn ? '生效' : '未启用（开发态）'}`,
  )
  return { shellRef }
}

/** 窗口级加固，在 BrowserWindow 创建后调用 */
function registerWindowHardening(win, { isPackaged, trustedOrigin, shellRef }) {
  lockDownDevTools(win, isPackaged)
  guardNavigation(win, trustedOrigin, shellRef)
  watchCspViolations(win)
}

module.exports = {
  registerAppHardening,
  registerWindowHardening,
  buildCsp,
  shouldApplyCsp,
  lockDownDevTools,
  guardNavigation,
  denyAllPermissions,
  applyCsp,
  watchCspViolations,
}
