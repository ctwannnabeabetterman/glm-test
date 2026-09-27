import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import path from 'node:path'
// ⚠️ js-yaml 目前是**传递依赖**（由运行时依赖 electron-updater 的 ^4.1.0 引入，
//    见 package-lock.json），因此生产和 CI 里必然存在。用它而不是子串匹配，
//    是因为「门禁测试」如果只查字符串，改个同义词就红、语义变了却照样绿 ——
//    那等于没有门禁。若将来 electron-updater 不再依赖它，把 js-yaml 显式加进
//    devDependencies 即可（本机 npm 跑不动依赖重算，故先沿用现成的）。
import yaml from 'js-yaml'

const nodeRequire = createRequire(import.meta.url)

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
function harness(options: { isPackaged?: boolean; confirmInstall?: boolean; migrationError?: Error; missingUpdater?: boolean } = {}) {
  const handlers: Record<string, (...args: any[]) => Promise<any>> = {}
  const appendedLines: string[] = []
  const migrateDatabase = vi.fn(() => { if (options.migrationError) throw options.migrationError })
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
    downloadUpdate: vi.fn(async (_token?: { cancelled: boolean; cancel: () => void }): Promise<undefined> => undefined),
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
    existsSync: vi.fn(() => true),
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
    dialog: {
      showSaveDialog: vi.fn(),
      showErrorBox: vi.fn(),
      // 默认返回「确认」（response 0 = 第一个按钮）。
      // 2026-09-18 起 install-update 会先弹一个「即将安装」确认框，
      // 不返回 0 就会走成「用户取消」，把原有契约测试全带偏。
      //
      // 显式标注参数类型：electron 的 dialog 类型签名在 vm 模拟里推不出来，
      // 不标的话 `mock.calls[0][1]` 会被推断成 `never`（元组长度为 0），
      // 后继断言全报 TS2493 —— 这是纯粹的类型噪音，不是逻辑问题。
      showMessageBox: vi.fn(
        async (
          _win: unknown,
          _opts: { detail?: string; message?: string; buttons?: string[] },
        ): Promise<{ response: number }> => ({
          response: options.confirmInstall === false ? 1 : 0,
        }),
      ),
    },
  }

  const context = vm.createContext({
    require: (name: string) => {
      if (name === 'electron') return electron
      if (name === 'fs') return fsMock
      if (name === 'path') return path
      if (name === 'electron-updater') {
        if (options.missingUpdater) throw new Error('updater missing')
        return { autoUpdater }
      }
      if (name === 'builder-util-runtime') return nodeRequire('builder-util-runtime')
      // 2026-09-21 起 main.js 会 require 这个模块做退避重试；桩里必须给**真模块**，
      // 否则 retryDelays 是 undefined，检查更新会以「TypeError」的形式失败（看起来像分类错乱）。
      if (name === './update-retry') return nodeRequire('../../desktop/update-retry.js')
      if (name === './migrate-database') return {
        migrateDatabase,
        readDatabaseVersion: () => 0,
        encodeVersion: () => 10204,
        formatVersion: () => '',
      }
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
    migrateDatabase,
    ensureDatabase: () => vm.runInContext('ensureDatabase()', context) as string,
    setupAutoUpdate: () => vm.runInContext('setupAutoUpdate()', context),
    /** 触发「安装没启动」或「下载停滞」守护定时器 */
    fireDeferred: () => deferred.splice(0).forEach((fn) => fn()),
    emitUpdater: (event: string, data: unknown) => {
      for (const [name, fn] of autoUpdater.on.mock.calls) {
        if (name === event) (fn as (data: unknown) => void)(data)
      }
    },
    dialog: electron.dialog,
    call: (channel: string) => {
      const fn = handlers[channel]
      if (!fn) throw new Error(`${channel} handler 未注册`)
      // 断言里要用到 canceled / reason / latest 这类可选字段，所以这里放宽成
      // 「带常见可选字段的结果对象」，而不是精确到每个 handler 的联合类型。
      return fn(event) as Promise<{
        ok: boolean
        error?: string
        canceled?: boolean
        reason?: string
        current?: string
        latest?: string | null
        hasUpdate?: boolean
      }>
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

/**
 * 「安装没有进度条」的补偿契约（2026-09-18 用户实测反馈）。
 *
 * 背景：用户走通首次自更新后反馈「不知道怎么下的，需要重启安装，然后安装没有进度条之类的」。
 * 查证结论是「安装阶段不可能有进度条」——quitAndInstall(true, true) 会以 `/S`
 * （NSIS 静默开关）调起安装器，静默安装本身不绘制任何界面；而且应用在 quitAndInstall
 * 之后立刻退出，渲染层连一次 setState 的机会都没有。
 *
 * `/S` 又不能去掉：assisted 安装器里「装完自动拉起应用」的条件是
 * `${isForceRun} AND ${Silent}`，去掉就变成「点更新 → 应用消失 → 不回来自动」。
 *
 * 所以唯一的补偿点是在**退出之前**把预期讲清楚。这一组测试锁住这条：
 * 确认框必须先出现、文案必须承认「没有进度条」、用户取消时绝不能安装。
 */
describe('自动更新：安装前的预期说明（补偿「安装没有进度条」）', () => {
  it('安装前必须先弹确认框，把「会怎样」讲在退出之前', async () => {
    const h = harness()
    await h.call('install-update')
    expect(h.dialog.showMessageBox).toHaveBeenCalled()
    const arg = h.dialog.showMessageBox.mock.calls[0]![1]!
    // 静默安装没有进度条是事实，必须提前说明，否则用户会把「窗口消失」当成崩溃
    expect(arg.detail).toContain('静默安装')
    expect(arg.detail).toContain('不会显示进度条')
    // 还要给出恢复预期，避免用户以为要自己手动开
    expect(arg.detail).toContain('重新打开')
  })

  it('用户在确认框选了「稍后」⇒ 不调用 quitAndInstall，应用继续运行', async () => {
    const h = harness({ confirmInstall: false })
    const r = await h.call('install-update')
    expect(r.ok).toBe(true)
    expect(r.canceled).toBe(true)
    expect(h.autoUpdater.quitAndInstall).not.toHaveBeenCalled()
  })

  it('确认框里带上安装包的本机路径（回答「不知道怎么下的」）', async () => {
    const h = harness()
    await h.call('install-update')
    const arg = h.dialog.showMessageBox.mock.calls[0]![1]!
    expect(arg.detail).toContain('安装包位置')
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

describe('启动数据库闸门', () => {
  it('迁移失败时不返回数据库路径，禁止启动服务写入半迁移库', () => {
    const h = harness({ migrationError: new Error('DDL failed') })
    expect(h.ensureDatabase).toThrow('DDL failed')
    expect(h.migrateDatabase).toHaveBeenCalledOnce()
  })
})

describe('自动更新：更新组件缺失', () => {
  it('启动时记录可恢复错误并通知界面，而不是静默成为无更新能力', () => {
    const h = harness({ missingUpdater: true })
    h.setupAutoUpdate()
    expect(h.sent.at(-1)?.p).toMatchObject({
      state: 'error', reason: 'no-updater', current: '1.2.4',
    })
    expect(h.sent.at(-1)?.p.message).toContain('更新组件缺失')
  })
})

describe('自动更新：下载停滞取消', () => {
  it('停滞时取消底层请求，在 Promise 结束前拒绝复用，并且不会二次报错', async () => {
    const h = harness()
    const tokens: Array<{ cancelled: boolean; cancel: () => void }> = []
    let rejectFirst!: (error: Error) => void
    h.autoUpdater.downloadUpdate.mockImplementationOnce((token) => {
      tokens.push(token!)
      return new Promise<undefined>((_resolve, reject) => { rejectFirst = reject })
    })
    expect(await h.call('download-update')).toEqual({ ok: true })
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    h.fireDeferred() // 45s 看门狗
    expect(tokens[0]?.cancelled).toBe(true)
    expect(h.sent.at(-1)?.p).toMatchObject({ state: 'error', reason: 'stalled' })
    expect((await h.call('download-update')).ok).toBe(false)
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)
    h.emitUpdater('download-progress', { percent: 75 })
    expect(h.sent.at(-1)?.p.reason).toBe('stalled')
    rejectFirst(new Error('cancelled'))
    await vi.waitFor(() => expect(h.appendedLines.join('\n')).toContain('已取消停滞下载'))
    expect(h.dialog.showErrorBox).not.toHaveBeenCalled()
    expect(await h.call('download-update')).toEqual({ ok: true })
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
  })

  it('取消后底层 Promise 不兑现时，宽限期一到就强制清锁，把「重试下载」还给用户', async () => {
    // 这条守的是「更新一直不来」里最难查的一种：cancel() 之后 downloadPromise
    // **永不 settle**，于是 activeDownload 永不为空，用户点「重试下载」永远收到
    // 「上一次下载尚未结束」，而他只看到「没有更新」。
    const h = harness()
    const tokens: Array<{ cancelled: boolean; cancel: () => void }> = []
    h.autoUpdater.downloadUpdate.mockImplementationOnce((token) => {
      tokens.push(token!)
      // 刻意的永不 settle：既不给 resolve 也不给 reject 的引用
      return new Promise<undefined>(() => {})
    })
    expect(await h.call('download-update')).toEqual({ ok: true })
    h.fireDeferred() // 45s 停滞看门狗 → 取消底层请求
    expect(tokens[0]?.cancelled).toBe(true)

    // 取消已发出，但 Promise 没结束 ⇒ 此刻重试必须仍被挡住（不能复用未结束的任务）
    expect((await h.call('download-update')).ok).toBe(false)
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(1)

    h.fireDeferred() // 20s 宽限期到 → 强制清锁
    expect(h.appendedLines.join('\n')).toContain('强制清除下载锁')
    expect(await h.call('download-update')).toEqual({ ok: true })
    expect(h.autoUpdater.downloadUpdate).toHaveBeenCalledTimes(2)
  })
})

/**
 * 把工作流里某个 step 的 `run` 脚本取出来（按 step 的 name 精确匹配）。
 * 断言「脚本里做了什么」比断言「整个 YAML 里出现过某个词」可靠得多。
 */
type WorkflowStep = { name?: string; uses?: string; run?: string; with?: Record<string, unknown>; if?: string }
type WorkflowJob = { needs?: string | string[]; if?: string; steps?: WorkflowStep[]; permissions?: Record<string, unknown>; name?: string }
type Workflow = { concurrency?: { group?: string }; jobs?: Record<string, WorkflowJob> }

const loadWorkflow = (file: string): Workflow =>
  yaml.load(readFileSync(path.resolve('.github/workflows', file), 'utf8')) as Workflow

const stepScript = (job: WorkflowJob | undefined, namePart: string): string => {
  const step = (job?.steps ?? []).find((s) => (s.name ?? '').includes(namePart))
  expect(step, `工作流里找不到名字包含「${namePart}」的步骤`).toBeTruthy()
  return step!.run ?? ''
}

const stepIndex = (job: WorkflowJob | undefined, namePart: string): number =>
  (job?.steps ?? []).findIndex((s) => (s.name ?? '').includes(namePart))

describe('发行流水线门禁与更新通道', () => {
  it('发布必须串行且与清理共享同一互斥组（generic 的 latest 是全仓库共享指针）', () => {
    for (const file of ['release.yml', 'release-cleanup.yml']) {
      const wf = loadWorkflow(file)
      expect(wf.concurrency?.group, `${file} 的并发组必须是固定值`).toBe('release-publication')
      // 按 ref 分组会让不同 tag 同时改同一个 latest 通道（P1-13 点名的问题）。
      expect(wf.concurrency?.group).not.toContain('github.ref')
    }
  })

  it('发布前必须等同一提交的 main push CI 通过，且要求 verify(20/22) 与 e2e 都成功', () => {
    const wf = loadWorkflow('release.yml')
    const gate = wf.jobs?.['ci-gate']
    expect(gate, '缺少 ci-gate 作业').toBeTruthy()
    // 发布作业必须依赖门禁，且门禁失败时不发布（workflow_dispatch 手动试产除外）。
    expect(wf.jobs?.release?.needs).toEqual('ci-gate')
    expect(wf.jobs?.release?.if).toContain('needs.ci-gate.result')

    const script = stepScript(gate, 'Wait for successful')
    // 只看**同一提交**的 main push 事件 —— PR merge ref 或相邻提交都不能代替。
    expect(script).toContain('head_sha=$sha')
    expect(script).toContain('event == "push"')
    expect(script).toContain('head_branch == "main"')
    // E2E 与两个 Node 版本的 verify 必须逐个断言成功，而不是只判总状态。
    for (const job of ['verify (node 20)', 'verify (node 22)', 'e2e (playwright)']) {
      expect(script, `门禁没有校验 ${job}`).toContain(job)
    }
    expect(script).toContain('conclusion == "success"')
    // 等不到就必须失败，不能静默放行。
    expect(script).toMatch(/exit 1/)
    // 门禁自己不需要写权限。
    expect(gate?.permissions?.contents).toBe('read')
  })

  it('打包产物必须真启动一次（解压 app.zip → 起服务 → 打接口），而非只看文件在不在', () => {
    const wf = loadWorkflow('release.yml')
    // ⚠️ 这条门禁的意义：v1.4.1 之前出现过「解压后外部化依赖是空目录，
    //    app.zip 的静态自检全过但服务起不来」。只有真起一次才拦得住。
    const idx = stepIndex(wf.jobs?.release, 'Smoke test packaged standalone')
    expect(idx, '缺少成品冒烟步骤').toBeGreaterThan(-1)
    const script = stepScript(wf.jobs?.release, 'Smoke test packaged standalone')
    expect(script, '冒烟必须先解压真实 app.zip').toContain('resources/app.zip')
    expect(script, '冒烟必须真的启动 server.js').toContain('server.js')
    expect(script, '冒烟必须打一个真实接口').toContain('/api/backup')
    // 必须在打包 NSIS 之前 —— 冒烟不过就不该产出安装包。
    expect(idx).toBeLessThan(stepIndex(wf.jobs?.release, 'Package Windows installer'))
  })

  it('资产流程必须是「先建草稿 → 上传 → 验收 → 才公开」，公开前对客户端不可见', () => {
    const wf = loadWorkflow('release.yml')
    const job = wf.jobs?.release
    const draft = stepIndex(job, 'Create draft and upload assets')
    const verify = stepIndex(job, 'Verify draft assets')
    const publish = stepIndex(job, 'Publish verified draft')
    expect(draft).toBeGreaterThan(-1)
    expect(verify).toBeGreaterThan(draft)
    expect(publish).toBeGreaterThan(verify)

    expect(stepScript(job, 'Create draft and upload assets')).toContain('--draft')
    // 只允许 clobber 尚未公开的草稿：已公开的 Release 可能正被旧客户端下载。
    const uploadScript = stepScript(job, 'Create draft and upload assets')
    expect(uploadScript).toContain('$existing.draft')
    expect(uploadScript).toMatch(/拒绝覆盖/)
    // 不能把比当前 latest 更旧的版本公开出去。
    expect(uploadScript).toMatch(/publishedVersion -ge \$candidateVersion/)
    const publishScript = stepScript(job, 'Publish verified draft')
    expect(publishScript).toMatch(/--draft=false/)
    // 公开必须排在验收之后：验收脚本失败会中止这一步，公开步骤拿不到执行机会。
    // ⚠️ 断言「用 Write-Error 而不是 throw」是**可诊断性**要求，不是风格问题：
    //    `throw` 的文案不会进 GitHub 的 annotation，远端只能看到
    //    「Process completed with exit code 1」—— 2026-09-27 就因为这一点
    //    完全查不出草稿验收为什么失败，白烧了一轮。Write-Error 会带上文案。
    const verifyScript = stepScript(job, 'Verify draft assets')
    expect(verifyScript, '验收失败必须带文案（Write-Error），不能只是 throw').toMatch(/Write-Error/)
    // ⚠️ 断言前必须**剥掉注释行**：说明「为什么不用 throw」的注释本身就含这个词，
    //    直接对整段做子串匹配会把自己写死 —— 这与「门禁只查字符串」是同一类错误。
    const verifyCode = verifyScript
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n')
    expect(verifyCode, '验收失败不允许只用裸 throw（远端读不到原因）').not.toMatch(/\bthrow\b/)
    // 每次重试都要把资产状态打出来，否则远端无从判断差在哪
    expect(verifyScript).toMatch(/Write-Warning/)
  })

  it('cleanup 把未信任 tag 经环境变量传入并逐条校验，且权限错误不得伪装成「资源不存在」', () => {
    const cleanup = readFileSync(path.resolve('.github/workflows/release-cleanup.yml'), 'utf8')
    const wf = loadWorkflow('release-cleanup.yml')
    expect(cleanup).toContain('TAGS: ${{ inputs.tags }}')
    // 直接插进单引号表达式会被 tag 里的特殊字符逃逸出去。
    expect(cleanup).not.toContain("'${{ inputs.tags }}'")
    // 先收集「已通过校验」的 tag，再统一删除。
    expect(cleanup).toContain('validated+=("$t")')
    expect(cleanup.indexOf('validated+=("$t")')).toBeLessThan(cleanup.indexOf('gh release delete "$t"'))
    // 必须用固定互斥组，避免与发布同时动 Releases。
    expect(wf.concurrency?.group).toBe('release-publication')
  })

  it('generic provider 的相对 URL 会跟随 latest 浮动；保持旧客户端兼容，不误认为已固定版本', () => {
    const { GenericProvider } = nodeRequire('electron-updater/out/providers/GenericProvider')
    const base = 'https://github.com/ctwannnabeabetterman/glm-test/releases/latest/download'
    const provider = new GenericProvider({ url: base, channel: 'latest' }, {}, { platform: 'win32', executor: {} })
    expect(provider.resolveFiles({ files: [{ url: 'AI-Network-Lab-Setup-1.4.2.exe', sha512: 'digest' }] })[0].url.href)
      .toBe(`${base}/AI-Network-Lab-Setup-1.4.2.exe`)
  })
})

describe('electron-builder 的发布配置', () => {
  // publish 段决定 latest.yml / app-update.yml 会不会生成，与「谁负责上传」无关；
  // 删掉它客户端就再也找不到更新源（曾经按「改用 gh CLI 上传」的直觉删过一次）。
  it('必须保留 publish 段，且更新源是 generic（绕开 releases.atom）', () => {
    const yml = readFileSync(path.resolve('electron-builder.yml'), 'utf8')
    expect(yml).toMatch(/^publish:/m)
    // ⚠️ 2026-09-21 从 github 换成 generic：github provider 每次检查都要先拉 `releases.atom`
    //    （动态 feed、偶发 5xx），实测一次 504 就让整次启动不再检查更新。
    //    generic 直接取 <url>/latest.yml，资产走 <url>/<latest.yml 里的 path>。
    expect(yml).toMatch(/provider:\s*generic/)
    expect(yml).toMatch(
      /url:\s*https:\/\/github\.com\/ctwannnabeabetterman\/glm-test\/releases\/latest\/download/,
    )
    expect(yml).toMatch(/channel:\s*latest/)
    // 不能再退回 github provider（那正是「先拉 atom」的行为）
    expect(yml).not.toMatch(/provider:\s*github/)
  })
})
