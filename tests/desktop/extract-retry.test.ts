import { describe, expect, it, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'

/**
 * 内置服务包解压（extractZip）的重试契约。
 *
 * 为什么需要这个文件：2026-09-17 用户第一次启动 1.3.3 时直接看到
 * 「AI Network Lab 启动失败」，内容是
 *   `tar.exe: .next/node_modules/pdfkit-<hash>: Can't create '...app.new\...': Invalid argument`
 *   `tar.exe: .next/node_modules/@prisma/client-<hash>: Can't create ...: Invalid argument`
 * 而**把同一条 tar 命令原样手动重跑一次就完全成功**（同一份 app.zip、同一个目标路径、
 * 那两个"失败"的目录也正常建出来了）；同时 app.zip 里最长条目路径只有 177 字符
 * （远不到 MAX_PATH）、tar.exe 可用、磁盘空间充足、数据库版本闸门也放行。
 *
 * ⇒ 结论是「环境抖动」（最可能是杀软在安装刚结束的窗口期扫描安装目录拦下了目录创建，
 *   或并发解压时 rmSync(app.new) 与 mkdir 互相拆台），**不是包坏了**。
 *
 * 代价却极不对称：抖一次就让应用起不来、而且**应用侧一行日志都没有**（更新日志是在
 * 解压成功之后的 setupAutoUpdate 里才初始化）。所以改成退避重试，这个文件守住它别再退化。
 *
 * 手法沿用 tests/desktop/updater-contract.test.ts：用 vm 把 desktop/main.js 载入受控
 * 上下文，直接调用顶层函数；定时器注入成同步执行，测试不会真的等 1.5s/3s。
 */
const MAIN_JS = readFileSync(path.join(process.cwd(), 'desktop', 'main.js'), 'utf8')

function loadMain(failFirstN: number) {
  const execFile = vi.fn(
    (
      file: string,
      args: string[],
      _options: unknown,
      cb: (err: Error | null) => void,
    ) => {
      if (failFirstN > 0) {
        failFirstN -= 1
        cb(
          Object.assign(
            new Error(
              `Command failed: ${file} ${args.join(' ')}\n` +
                `tar.exe: .next/node_modules/pdfkit-d5967b64ee09fcf0: Can't create ` +
                `'\\\\?\\C:\\tmp\\app.new\\.next\\node_modules\\pdfkit-d5967b64ee09fcf0': Invalid argument`,
            ),
          ),
        )
        return
      }
      cb(null)
    },
  )

  const rmSync = vi.fn()
  const mkdirSync = vi.fn()
  const fsMock = {
    rmSync,
    mkdirSync,
    existsSync: vi.fn(() => false),
    writeFileSync: vi.fn(),
    readFileSync: vi.fn(() => ''),
    statSync: vi.fn(() => {
      throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' })
    }),
    appendFileSync: vi.fn(),
  }

  const electron = {
    app: {
      // 不让 bootstrap 跑起来：这里只测解压这一层
      whenReady: () => ({ then: () => ({ catch: () => {} }) }),
      on: vi.fn(),
      requestSingleInstanceLock: () => true,
      isPackaged: true,
      getVersion: () => '1.3.3',
      getPath: () => 'C:/tmp/ai-network-lab',
    },
    ipcMain: { handle: vi.fn() },
    dialog: { showErrorBox: vi.fn(), showMessageBox: vi.fn(), showSaveDialog: vi.fn() },
  }

  const context = vm.createContext({
    require: (name: string) => {
      if (name === 'electron') return electron
      if (name === 'child_process') return { spawn: vi.fn(), execFile }
      if (name === 'path') return path
      if (name === 'fs') return fsMock
      if (name === 'net') return { createServer: vi.fn() }
      if (name === 'http') return { request: vi.fn() }
      if (name === './migrate-database')
        return {
          migrateDatabase: vi.fn(),
          readDatabaseVersion: () => 0,
          encodeVersion: () => 0,
          formatVersion: () => '',
        }
      if (name === './instance-guard')
        return { findForeignLabInstances: async () => [], buildConflictDetail: () => '' }
      if (name === 'electron-updater') return { autoUpdater: { on: vi.fn(), logger: null } }
      return {}
    },
    Buffer,
    ArrayBuffer,
    URL,
    console,
    process,
    // 定时器同步化：delay(1500 * n) 不会真的睡
    setTimeout: (fn: () => void) => {
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
  return { context, execFile, rmSync, mkdirSync }
}

const ZIP = 'C:/install/resources/app.zip'
const DEST = 'C:/install/resources/app.new'

describe('内置服务包解压的重试', () => {
  it('第一次失败时会重试，第二次成功后不再抛错', async () => {
    const { context, execFile, rmSync, mkdirSync } = loadMain(1)

    await expect(
      (context as unknown as { extractZip: (a: string, b: string) => Promise<void> }).extractZip(
        ZIP,
        DEST,
      ),
    ).resolves.toBeUndefined()

    expect(execFile).toHaveBeenCalledTimes(2)
    // 重试前必须清掉上一轮留下的半成品，否则下一轮会在同一位置继续失败
    expect(rmSync).toHaveBeenCalledWith(DEST, { recursive: true, force: true })
    expect(mkdirSync).toHaveBeenCalledWith(DEST, { recursive: true })
  })

  it('三次都失败时，把最后一次的 tar 原始输出抛出去', async () => {
    const { context, execFile } = loadMain(3)

    await expect(
      (context as unknown as { extractZip: (a: string, b: string) => Promise<void> }).extractZip(
        ZIP,
        DEST,
      ),
    ).rejects.toThrow(/内置服务解压失败/)

    expect(execFile).toHaveBeenCalledTimes(3)
  })

  it('第一次就成功时只调用一次 tar，不做多余的清理', async () => {
    const { context, execFile, rmSync } = loadMain(0)

    await (context as unknown as { extractZip: (a: string, b: string) => Promise<void> }).extractZip(
      ZIP,
      DEST,
    )

    expect(execFile).toHaveBeenCalledTimes(1)
    expect(rmSync).not.toHaveBeenCalled()
  })
})
