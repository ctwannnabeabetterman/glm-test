import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import vm from 'node:vm'

/**
 * 「更新检查失败要重试」的契约。
 *
 * 为什么要有这个文件（2026-09-21 现场）：用户机上 `update.log` 显示
 *
 *   [15:23:58] [updater:error] HttpError: 504  GET .../releases.atom
 *   [15:23:58] 启动静默检查未成功：unknown — 504
 *
 * 更新源用 GitHub provider 时每次检查都要先拉 `releases.atom`（动态 feed、偶发 5xx），
 * 而启动检查**只跑一次**、失败只写日志 ⇒ 那一次启动就等于「不更新」，
 * 用户侧的观感是「客户端不会自动更新」，且没有任何重试的机会。
 *
 * 两件事都要守住：
 *  ① 瞬时故障（5xx/超时/连接类）必须退避重试，且启动与手动两种模式节奏不同；
 *  ② 永久故障（404 / 发布侧没有正式版本 / 版本回退）**不许重试** ——
 *    白等还把「发布侧的问题」伪装成「网络问题」，比不重试更误导人。
 *
 * 手法沿用 tests/desktop/extract-retry.test.ts：vm 载入 desktop/main.js，
 * 定时器同步化（退避不会真的睡），`./update-retry` 接**真模块**（策略本身要一起被测）。
 */

const MAIN_JS = readFileSync(path.join(process.cwd(), 'desktop', 'main.js'), 'utf8')
const nodeRequire = createRequire(import.meta.url)
const retryModule = nodeRequire('../../desktop/update-retry.js') as {
  classifyRetry: (e: unknown) => { retry: boolean; reason: string }
  retryDelays: (mode?: string) => number[]
  STARTUP_RETRY_DELAYS: number[]
  MANUAL_RETRY_DELAYS: number[]
}

describe('重试策略（纯模块，不依赖 electron）', () => {
  it('HTTP 5xx / 连接类错误判为可重试', () => {
    for (const msg of [
      'HttpError: 504 Gateway Time-out',
      'HttpError: 502',
      'Error: connect ETIMEDOUT 140.82.113.4:443',
      'Error: socket hang up',
      'getaddrinfo EAI_AGAIN github.com',
    ]) {
      expect(retryModule.classifyRetry(new Error(msg))).toMatchObject({ retry: true })
    }
    // 用户机上那一整段原文（含 HTML 与请求头）也要能认出来
    expect(
      retryModule.classifyRetry({
        message: 'HttpError: 504 \n"method: GET url: https://github.com/x/y/releases.atom\n\n Data:\n<html><body><h1>504 Gateway Time-out</h1>',
      }),
    ).toMatchObject({ retry: true, reason: 'transient' })
  })

  it('发布侧/资源类错误判为不可重试（重试一百次也一样）', () => {
    for (const msg of [
      'HttpError: 406 Cannot parse releases feed',
      'Cannot find latest.yml update info: HttpError: 404',
      'Error: Update for version 1.3.8 is not available (downgrade is disallowed)',
      'LATEST_VERSION_NOT_FOUND',
    ]) {
      expect(retryModule.classifyRetry(new Error(msg))).toMatchObject({ retry: false, reason: 'permanent' })
    }
  })

  it('认不出来时倾向重试（拿不到新版比多试两次更糟）', () => {
    expect(retryModule.classifyRetry(new Error('something odd'))).toMatchObject({ retry: true })
    expect(retryModule.classifyRetry(null)).toMatchObject({ retry: true })
  })

  it('两种模式节奏不同：启动慢（用户不在等），手动快（人在等）', () => {
    expect(retryModule.retryDelays('startup')).toEqual([0, 30_000, 120_000])
    expect(retryModule.retryDelays('manual')).toEqual([0, 3_000, 8_000])
    expect(retryModule.retryDelays()).toEqual(retryModule.STARTUP_RETRY_DELAYS)
    // 返回副本：调用方改它不会污染模块内部
    const a = retryModule.retryDelays()
    a.push(999)
    expect(retryModule.retryDelays()).toEqual(retryModule.STARTUP_RETRY_DELAYS)
  })
})

/** 把 main.js 载入受控上下文，注入可编排的 checkForUpdates 与同步定时器 */
function loadMain(failures: Array<Error | null>) {
  const delays: number[] = []
  let call = 0
  const autoUpdater = {
    logger: null,
    autoDownload: false,
    autoInstallOnAppQuit: true,
    on: vi.fn(),
    checkForUpdates: vi.fn(async () => {
      const err = failures[Math.min(call, failures.length - 1)]
      call += 1
      if (err) throw err
      return { updateInfo: { version: '9.9.9' } }
    }),
  }

  const context = vm.createContext({
    require: (name: string) => {
      if (name === 'electron')
        return {
          app: {
            whenReady: () => ({ then: () => ({ catch: () => {} }) }),
            on: vi.fn(),
            requestSingleInstanceLock: () => true,
            isPackaged: false,
            getVersion: () => '1.3.11',
            getPath: () => 'C:/tmp/ai-network-lab',
            exit: vi.fn(),
          },
          ipcMain: { handle: vi.fn() },
          dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
        }
      if (name === './update-retry') return retryModule
      if (name === 'path') return path
      if (name === 'fs')
        return {
          appendFileSync: vi.fn(),
          existsSync: vi.fn(() => false),
          mkdirSync: vi.fn(),
          readFileSync: vi.fn(() => ''),
          writeFileSync: vi.fn(),
          statSync: vi.fn(() => {
            throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
          }),
          rmSync: vi.fn(),
        }
      if (name === 'electron-updater') return { autoUpdater }
      if (name === './migrate-database')
        return { migrateDatabase: vi.fn(), readDatabaseVersion: () => 0, encodeVersion: () => 0, formatVersion: () => '' }
      if (name === './instance-guard') return { findForeignLabInstances: async () => [], buildConflictDetail: () => '' }
      return {}
    },
    Buffer,
    ArrayBuffer,
    URL,
    console,
    process,
    // 同步化：退避（30s / 2min）不会真的睡；顺手把延迟记下来做断言
    setTimeout: (fn: () => void, ms?: number) => {
      if (typeof ms === 'number' && ms > 0) delays.push(ms)
      fn()
      return 0
    },
    setImmediate: (fn: () => void) => {
      fn()
      return 0
    },
    clearTimeout: () => {},
  })

  vm.runInContext(MAIN_JS, context, { filename: 'desktop/main.js' })
  return { context, autoUpdater, delays }
}

type RetryFn = (o: { label: string; mode?: string }) => Promise<{
  ok: boolean
  attempts: number
  reason?: string
  message?: string
  result?: unknown
}>

describe('checkForUpdatesWithRetry（vm 载入 main.js，行为级）', () => {
  it('第一次 504、第二次成功：重试一次就拿到结果', async () => {
    const { context, autoUpdater, delays } = loadMain([new Error('HttpError: 504 Gateway Time-out'), null])
    const out = await (context as unknown as Record<string, RetryFn>).checkForUpdatesWithRetry({
      label: '启动静默检查',
      mode: 'startup',
    })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(2)
    expect(out).toMatchObject({ ok: true, attempts: 2 })
    // 第二次之前等了一次退避
    expect(delays).toEqual([30_000])
  })

  it('三次都 504：按启动节奏退避两轮后放弃，并给出 upstream 分类', async () => {
    const { context, autoUpdater, delays } = loadMain([
      new Error('HttpError: 504 Gateway Time-out'),
      new Error('HttpError: 503'),
      // 最后一次也是 5xx：上报的 reason 取的是**最后一次**尝试的分类（全部尝试都写进了 update.log）
      new Error('HttpError: 500'),
    ])
    const out = await (context as unknown as Record<string, RetryFn>).checkForUpdatesWithRetry({
      label: '启动静默检查',
      mode: 'startup',
    })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(3)
    expect(out.ok).toBe(false)
    expect(out.attempts).toBe(3)
    // 5xx 现在有自己的分类，不再落到「unknown — 504」
    expect(out.reason).toBe('upstream')
    expect(delays).toEqual([30_000, 120_000])
  })

  it('永久性错误只试一次（不把发布侧的问题伪装成网络问题）', async () => {
    const { context, autoUpdater, delays } = loadMain([
      new Error('Cannot find latest.yml update info: HttpError: 404'),
      null,
    ])
    const out = await (context as unknown as Record<string, RetryFn>).checkForUpdatesWithRetry({
      label: '手动检查',
      mode: 'manual',
    })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(out.ok).toBe(false)
    expect(out.attempts).toBe(1)
    expect(delays).toEqual([])
  })

  it('手动模式用更快的退避（人在等）', async () => {
    const { context, delays } = loadMain([new Error('ETIMEDOUT'), new Error('ETIMEDOUT'), new Error('ETIMEDOUT')])
    await (context as unknown as Record<string, RetryFn>).checkForUpdatesWithRetry({
      label: '手动检查',
      mode: 'manual',
    })
    expect(delays).toEqual([3_000, 8_000])
  })

  it('第一次就成功时只查一次、不等待', async () => {
    const { context, autoUpdater, delays } = loadMain([null])
    const out = await (context as unknown as Record<string, RetryFn>).checkForUpdatesWithRetry({ label: 'x' })
    expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
    expect(out).toMatchObject({ ok: true, attempts: 1 })
    expect(delays).toEqual([])
  })
})

describe('接线契约（源码级，补足 vm 覆盖不到的部分）', () => {
  const main = readFileSync(path.join(process.cwd(), 'desktop', 'main.js'), 'utf8')
  const yml = readFileSync(path.join(process.cwd(), 'electron-builder.yml'), 'utf8')
  const settings = readFileSync(
    path.join(process.cwd(), 'src', 'components', 'sections', 'settings-section.tsx'),
    'utf8',
  )

  it('启动静默检查走带重试的版本，且最终失败要推给界面（不能只躺日志里）', () => {
    expect(main).toMatch(/checkForUpdatesWithRetry\(\{ label: '启动静默检查', mode: 'startup' \}\)/)
    expect(main).toMatch(/自动检查更新失败（已重试/)
    expect(main).toMatch(/state: 'error'/)
  })

  it('手动检查也走同一条重试逻辑', () => {
    expect(main).toMatch(/checkForUpdatesWithRetry\(\{ label: '手动检查', mode: 'manual' \}\)/)
  })

  it('5xx 的分类要排在 406/404 之前（原来 504 会落到 unknown）', () => {
    const fn = main.slice(main.indexOf('function classifyUpdateError'))
    const upstreamAt = fn.indexOf("reason: 'upstream'")
    const noReleaseAt = fn.indexOf("reason: 'no-release'")
    expect(upstreamAt).toBeGreaterThan(-1)
    expect(noReleaseAt).toBeGreaterThan(-1)
    expect(upstreamAt).toBeLessThan(noReleaseAt)
  })

  it('更新源已换成 generic（绕开 releases.atom），且 URL 指向 /releases/latest/download', () => {
    const publishAt = yml.indexOf('\npublish:')
    expect(publishAt).toBeGreaterThan(-1)
    const block = yml.slice(publishAt)
    expect(block).toMatch(/provider: generic/)
    expect(block).toMatch(
      /url: https:\/\/github\.com\/ctwannnabeabetterman\/glm-test\/releases\/latest\/download/,
    )
    expect(block).toMatch(/channel: latest/)
    // 不能再留着 github provider（它就是要绕开的那种「先拉 atom」行为）
    expect(block).not.toMatch(/provider: github/)
  })

  it('界面认得 upstream 这个失败分类（否则又变成一句没人看得懂的 unknown）', () => {
    expect(settings).toMatch(/case 'upstream':/)
    expect(settings).toMatch(/HTTP 5xx/)
  })
})
