import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import path from 'node:path'

/**
 * 自动更新链路的契约测试。
 *
 * 为什么要有这个文件：更新这条路上有两个「参数少写一个就静默失灵」的坑，
 * 它们**不会**让类型检查或任何现有测试变红，但会让用户看到的是
 * 「点了更新 → 应用闪退 → 版本还是旧的」。2026-09-17 在本机把这条链路
 * 从头到尾查了一遍（见 CHANGELOG 1.3.3），两个坑分别是：
 *
 *  1. `quitAndInstall()` 必须显式传 (true, true)。
 *     electron-builder 的 NSIS 模板里，assisted 安装器（本项目 nsis.oneClick=false）
 *     「装完自动拉起应用」的条件是 `${if} ${isForceRun} ${andIf} ${Silent}`
 *     —— 只有静默安装才会把应用拉回来。少传参数 ⇒ 安装完应用不回来，用户以为闪退。
 *  2. 在确认「安装真的会启动」之前**不能**先杀掉内部 Next 服务。
 *     quitAndInstall 是「立即返回、随后才拉起安装器」，而 install() 可能失败；
 *     一旦失败应用并不退出，而服务已被杀 ⇒ 界面所有接口全挂，用户看到的是
 *     「点完更新，整个界面显示异常」，还得手动关掉这个半死的窗口。
 *
 * 这两条都无法用类型或行为在 CI 里自然覆盖（需要真 Electron），所以这里用 vm
 * 把 main.js 载入受控上下文，直接对 IPC handler 断言。
 */
function harness(options: { isPackaged?: boolean } = {}) {
  const handlers: Record<string, (...args: any[]) => Promise<any>> = {}
  const appendedLines: string[] = []
  const killSpy = vi.fn()
  /** 被推迟执行的「守护定时器」回调；测试里手动触发，避免真等 5 秒 */
  const deferred: Array<() => void> = []

  const autoUpdater = {
    logger: null as unknown,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    quitAndInstall: vi.fn(),
    checkForUpdates: vi.fn(async () => ({ updateInfo: { version: '1.3.3' } })),
    downloadUpdate: vi.fn(async () => undefined),
  }

  const fsMock = {
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    // 模拟「日志文件还不存在」：轮转分支靠 statSync 抛错来跳过
    statSync: vi.fn(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    mkdirSync: vi.fn(),
    appendFileSync: vi.fn((_file: string, line: string) => {
      appendedLines.push(line)
    }),
    existsSync: vi.fn(() => false),
  }

  const electron = {
    app: {
      // 必须「不调用」bootstrap：setupAutoUpdate 会去连网检查，测试里不需要它跑
      whenReady: () => ({ then: () => ({ catch: () => {} }) }),
      on: vi.fn(),
      requestSingleInstanceLock: () => true,
      isPackaged: options.isPackaged ?? true,
      getVersion: () => '1.2.4',
      getPath: () => 'C:/Users/test/AppData/Roaming/ai-network-lab',
    },
    ipcMain: {
      handle: (channel: string, fn: (...args: any[]) => Promise<any>) => {
        handlers[channel] = fn
      },
    },
    dialog: { showSaveDialog: vi.fn(), showErrorBox: vi.fn(), showMessageBox: vi.fn() },
  }

  const context = vm.createContext({
    require: (name: string) => {
      if (name === 'electron') return electron
      if (name === 'fs') return fsMock
      if (name === 'path') return path
      if (name === 'electron-updater') return { autoUpdater }
      if (name === 'child_process') return { spawn: vi.fn(), execFile: vi.fn() }
      return {}
    },
    Buffer,
    ArrayBuffer,
    URL,
    console,
    process,
    // vm 上下文里没有 Node 的定时器；`setImmediate` 同步执行（quitAndInstall 的真实调用点
    // 就在里面），`setTimeout` 只把回调记下来，由测试决定什么时候触发。
    setImmediate: (fn: () => void) => {
      fn()
      return 0
    },
    setTimeout: (fn: () => void) => {
      deferred.push(fn)
      return deferred.length
    },
    clearTimeout: () => {},
    __dirname: path.resolve('desktop'),
  })
  vm.runInContext(readFileSync(path.resolve('desktop/main.js'), 'utf8'), context)
  // 与 save-file.test.ts 同一套做法：top-level 的 let 绑定在同一个 global lexical
  // 环境里，后续 runInContext 能直接给它赋值。
  vm.runInContext(
    "globalThis.__sent = [];" +
      'globalThis.__killSpy = () => {};' +
      'mainWindow = {' +
      '  isDestroyed: () => false,' +
      '  setTitle: () => {},' +
      '  webContents: { mainFrame: { url: "http://127.0.0.1:1234/" }, send: (ch, p) => globalThis.__sent.push({ ch, p }) },' +
      '};' +
      "trustedOrigin = 'http://127.0.0.1:1234';" +
      'globalThis.sender = mainWindow.webContents;' +
      'serverProc = { kill: () => globalThis.__killSpy() };',
    context,
  )
  ;(context as any).__killSpy = killSpy

  const event = { sender: (context as any).sender, senderFrame: (context as any).sender.mainFrame }
  const sent = (context as any).__sent as Array<{ ch: string; p: any }>
  return {
    autoUpdater,
    appendedLines,
    killSpy,
    sent,
    /** 触发「安装没启动」守护定时器 */
    fireDeferred: () => deferred.forEach((fn) => fn()),
    dialog: electron.dialog,
    call: (channel: string) => {
      const fn = handlers[channel]
      if (!fn) throw new Error(`${channel} handler 未注册`)
      return fn(event)
    },
  }
}

describe('自动更新：退出安装的调用契约', () => {
  it('install-update 必须以静默 + 强制重启的方式调用 quitAndInstall', async () => {
    const h = harness()
    await h.call('install-update')
    expect(h.autoUpdater.quitAndInstall).toHaveBeenCalledWith(true, true)
  })

  it('install-update 不得提前杀掉内部服务（否则安装失败时界面会整体报错）', async () => {
    const h = harness()
    await h.call('install-update')
    expect(h.killSpy).not.toHaveBeenCalled()
  })

  it('开发模式不安装更新，且不会去调 quitAndInstall', async () => {
    const h = harness({ isPackaged: false })
    expect(await h.call('install-update')).toEqual({ ok: false, error: '开发模式不安装更新' })
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('把安装请求与结果写进更新日志（排查「点了没反应」的唯一线索）', async () => {
    const h = harness()
    await h.call('install-update')
    const text = h.appendedLines.join('\n')
    expect(text).toContain('quitAndInstall(isSilent=true, isForceRunAfter=true)')
  })

  it('安装没能启动时（应用没退出）明确回传错误，而不是让用户对着没反应的界面猜', async () => {
    const h = harness()
    await h.call('install-update')
    // quitAndInstall 只在 install() 成功时才真的退出应用；模拟「应用还活着」
    h.fireDeferred()
    const err = h.sent.map((s) => s.p).find((p) => p.reason === 'install-not-started')
    expect(err).toBeTruthy()
    expect(err.state).toBe('error')
    expect(h.appendedLines.join('\n')).toContain('安装未启动')
  })
})

describe('自动更新：手动检查更新的回传', () => {
  it('检查到新版本时回传 latest 与 hasUpdate', async () => {
    const h = harness()
    expect(await h.call('check-for-updates')).toEqual({
      ok: true,
      current: '1.2.4',
      latest: '1.3.3',
      hasUpdate: true,
    })
  })

  it('检查失败时把分类后的原因回传，并留日志', async () => {
    const h = harness()
    h.autoUpdater.checkForUpdates.mockRejectedValueOnce(new Error('HttpError: 406 Cannot parse releases feed'))
    const r = await h.call('check-for-updates')
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('no-release')
    expect(h.appendedLines.join('\n')).toContain('no-release')
  })
})

describe('electron-builder 的发布配置', () => {
  // publish 段决定 latest.yml / app-update.yml 会不会生成，与「谁负责上传」无关；
  // 删掉它客户端就再也找不到更新源（曾经按「改用 gh CLI 上传」的直觉删过一次）。
  it('必须保留 publish 段且 releaseType 为 release', () => {
    const yml = readFileSync(path.resolve('electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/^publish:/m)
    expect(yml).toMatch(/releaseType:\s*release/)
    expect(yml).toMatch(/provider:\s*github/)
  })
})
