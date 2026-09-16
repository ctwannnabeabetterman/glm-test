import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const {
  pickForeignInstances,
  buildConflictDetail,
  normalizePath,
  queryLabProcesses,
  hasSameNamedProcess,
} = require('../../desktop/instance-guard.js')

const SELF_PID = 1000
const SELF_EXE = 'C:\\Users\\me\\AppData\\Local\\Programs\\AI Network Lab\\AI Network Lab.exe'
const EXE_NAME = 'AI Network Lab.exe'

type FakeStep = { stdout?: string; err?: Error | null }

/**
 * 造一个假的 execFile：**按命令名分派**返回预设结果。
 * 必须按命令名分派 —— 早先的版本按「调用序号」取结果，于是重试时的
 * powershell.exe 调用拿到了 tasklist 的输出，被解析成失败，测出了一个假的行为。
 */
function fakeExec(plan: Record<string, FakeStep[]>) {
  const calls: string[] = []
  const taken: Record<string, number> = {}
  const impl = (file: string, _args: string[], _opts: unknown, cb: (e: unknown, out: string) => void) => {
    calls.push(file)
    const queue = plan[file] ?? [{ stdout: '' }]
    const idx = Math.min(taken[file] ?? 0, queue.length - 1)
    taken[file] = (taken[file] ?? 0) + 1
    const step = queue[idx]
    cb(step.err ?? null, step.stdout ?? '')
  }
  return { impl, calls }
}

const cimRow = (pid: number, exePath: string) =>
  JSON.stringify([{ ProcessId: pid, ExecutablePath: exePath, CommandLine: `"${exePath}"` }])

// tasklist 在「有匹配」时输出 CSV；「无匹配」时输出本地化提示（且第一列不是带引号的镜像名）
const TASKLIST_HIT = `"${EXE_NAME}","4242","Console","1","244,000 K"\n`
const TASKLIST_MISS = '信息: 没有运行的任务匹配指定标准。\n'
const TASKLIST_MISS_EN = 'INFO: No tasks are running which match the specified criteria.\n'
const PS = 'powershell.exe'
const TL = 'tasklist'

function row(pid: number, exePath: string, commandLine: string) {
  return { ProcessId: pid, ExecutablePath: exePath, CommandLine: commandLine }
}

describe('desktop single-version guard', () => {
  it('把另一个安装目录下的同名主进程判为冲突', () => {
    const rows = [row(4242, 'E:\\opencode\\ai-network-lab\\release\\win-unpacked\\AI Network Lab.exe', '"E:\\opencode\\ai-network-lab\\release\\win-unpacked\\AI Network Lab.exe"')]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([
      { pid: 4242, exePath: 'E:\\opencode\\ai-network-lab\\release\\win-unpacked\\AI Network Lab.exe' },
    ])
  })

  it('排除自己这个 pid', () => {
    const rows = [row(SELF_PID, SELF_EXE, `"${SELF_EXE}"`)]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('同路径的第二个实例交给 requestSingleInstanceLock，不在这里重复拦截', () => {
    // 升级后自动重启时旧进程可能还没退干净，这里若也拦会把自动更新卡死
    const rows = [row(2000, SELF_EXE, `"${SELF_EXE}"`), row(2001, SELF_EXE.toUpperCase(), `"${SELF_EXE}"`)]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('排除 Electron 的渲染/GPU/utility 子进程（命令行带 --type=）', () => {
    const rows = [
      row(3001, SELF_EXE, `"${SELF_EXE}" --type=renderer --param=1`),
      row(3002, SELF_EXE, `"${SELF_EXE}" --type=gpu-process`),
      row(3003, SELF_EXE, `"${SELF_EXE}" --type=utility --utility-sub-type=network.mojom.NetworkService`),
    ]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('排除内部 Next 服务子进程（同名 exe，但命令行跑的是 server.js）', () => {
    const other = 'E:\\opencode\\ai-network-lab\\release\\win-unpacked\\AI Network Lab.exe'
    const rows = [
      row(4001, SELF_EXE, `"${SELF_EXE}" "C:\\Users\\me\\AppData\\Local\\Programs\\AI Network Lab\\resources\\app\\server.js"`),
      row(4002, other, `"${other}" "E:\\opencode\\ai-network-lab\\release\\win-unpacked\\resources\\app\\server.js"`),
    ]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('真实混合场景：只挑出那个别版本的主进程', () => {
    const other = 'D:\\LabOld\\AI Network Lab.exe'
    const rows = [
      row(SELF_PID, SELF_EXE, `"${SELF_EXE}"`),
      row(5100, SELF_EXE, `"${SELF_EXE}" --type=renderer`),
      row(5101, SELF_EXE, `"${SELF_EXE}" "C:\\Users\\me\\AppData\\Local\\Programs\\AI Network Lab\\resources\\app\\server.js"`),
      row(5102, other, `"${other}"`),
      row(5103, other, `"${other}" --type=utility`),
      row(5104, other, `"${other}" "D:\\LabOld\\resources\\app\\server.js"`),
    ]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([{ pid: 5102, exePath: other }])
  })

  it('读不到 exe 路径的进程放行（安全软件常挡这类查询，误报会让应用完全打不开）', () => {
    const rows = [{ ProcessId: 6001, CommandLine: '"AI Network Lab.exe"' }]
    expect(pickForeignInstances(rows, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('输入不是数组时安全返回空', () => {
    expect(pickForeignInstances(null as never, SELF_PID, SELF_EXE)).toEqual([])
    expect(pickForeignInstances(undefined as never, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('忽略非法 pid', () => {
    const other = 'D:\\LabOld\\AI Network Lab.exe'
    const rows = [
      { ProcessId: 0, ExecutablePath: other, CommandLine: `"${other}"` },
      { ProcessId: 'abc', ExecutablePath: other, CommandLine: `"${other}"` },
      { ProcessId: undefined, ExecutablePath: other, CommandLine: `"${other}"` },
    ]
    expect(pickForeignInstances(rows as never, SELF_PID, SELF_EXE)).toEqual([])
  })

  it('冲突说明里要带上 PID 与路径，用户才知道该关谁', () => {
    const detail = buildConflictDetail([{ pid: 4242, exePath: 'D:\\LabOld\\AI Network Lab.exe' }], SELF_EXE)
    expect(detail).toContain('PID 4242')
    expect(detail).toContain('D:\\LabOld\\AI Network Lab.exe')
    expect(detail).toContain(SELF_EXE)
    expect(detail).toContain('任务管理器')
  })

  it('路径归一化忽略分隔符风格、大小写与结尾斜杠', () => {
    expect(normalizePath('C:\\Program Files\\Lab\\lab.exe')).toBe(normalizePath('c:/program files/lab/lab.exe'))
    expect(normalizePath('C:\\A\\')).toBe(normalizePath('c:/a'))
    expect(normalizePath('')).toBe('')
  })

  describe('同名进程查询的健壮性（WMI 会偶发返回空结果）', () => {
    it('tasklist 按 CSV 第一列比对镜像名，不受本地化提示文案影响', async () => {
      expect(await hasSameNamedProcess(EXE_NAME, fakeExec({ [TL]: [{ stdout: TASKLIST_MISS }] }).impl)).toBe(false)
      expect(await hasSameNamedProcess(EXE_NAME, fakeExec({ [TL]: [{ stdout: TASKLIST_MISS_EN }] }).impl)).toBe(false)
      expect(await hasSameNamedProcess(EXE_NAME, fakeExec({ [TL]: [{ stdout: TASKLIST_HIT }] }).impl)).toBe(true)
    })

    it('tasklist 不会把别的进程名当成命中（避免子串误匹配）', async () => {
      const impl = fakeExec({ [TL]: [{ stdout: '"Old AI Network Lab.exe","1","Console","1","1 K"\n' }] }).impl
      expect(await hasSameNamedProcess(EXE_NAME, impl)).toBe(false)
    })

    it('tasklist 执行失败时返回 null（表示「这次判断没成功」，而不是「没有」）', async () => {
      const impl = fakeExec({ [TL]: [{ err: new Error('spawn failed') }] }).impl
      expect(await hasSameNamedProcess(EXE_NAME, impl)).toBe(null)
    })

    it('CIM 偶发返回空结果时，会重试并最终拿到真实进程（这正是守卫静默失效的根因）', async () => {
      const { impl, calls } = fakeExec({
        [PS]: [{ stdout: '' }, { stdout: cimRow(4242, 'D:\\LabOld\\AI Network Lab.exe') }],
        [TL]: [{ stdout: TASKLIST_HIT }],
      })
      const rows = await queryLabProcesses(EXE_NAME, impl)
      expect(rows).toEqual([
        { ProcessId: 4242, ExecutablePath: 'D:\\LabOld\\AI Network Lab.exe', CommandLine: '"D:\\LabOld\\AI Network Lab.exe"' },
      ])
      expect(calls.filter((f) => f === PS)).toHaveLength(2)
    })

    it('CIM 空 + tasklist 也说没有 ⇒ 立刻返回空，不浪费重试', async () => {
      const { impl, calls } = fakeExec({ [PS]: [{ stdout: '' }], [TL]: [{ stdout: TASKLIST_MISS }] })
      expect(await queryLabProcesses(EXE_NAME, impl)).toEqual([])
      expect(calls.filter((f) => f === PS)).toHaveLength(1)
    })

    it('CIM 一直空、tasklist 一直说有 ⇒ 返回 null（宁可不拦，也不能误报把用户挡在外面）', async () => {
      const { impl, calls } = fakeExec({ [PS]: [{ stdout: '' }], [TL]: [{ stdout: TASKLIST_HIT }] })
      expect(await queryLabProcesses(EXE_NAME, impl)).toBe(null)
      // 3 次尝试 × (1 次 CIM + 1 次 tasklist)
      expect(calls.filter((f) => f === PS)).toHaveLength(3)
      expect(calls.filter((f) => f === TL)).toHaveLength(3)
    })

    it('CIM 直接报错也会重试，随后成功', async () => {
      const { impl, calls } = fakeExec({ [PS]: [{ err: new Error('exit 1') }, { stdout: cimRow(77, SELF_EXE) }] })
      expect(await queryLabProcesses(EXE_NAME, impl)).toHaveLength(1)
      expect(calls.filter((f) => f === PS)).toHaveLength(2)
    })

    it('拿不到可信结果时，findForeignLabInstances 返回 null 而不是空数组', async () => {
      const { findForeignLabInstances } = require('../../desktop/instance-guard.js')
      const impl = fakeExec({ [PS]: [{ stdout: '' }], [TL]: [{ stdout: TASKLIST_HIT }] }).impl
      const r = await findForeignLabInstances(SELF_PID, SELF_EXE, impl)
      if (process.platform === 'win32') {
        expect(r).toBe(null)
      } else {
        expect(r).toEqual([]) // 非 Windows 直接短路
      }
    })
  })
})
