import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { InetRunner } from '../../src/lib/inet/runner'
import type { InetManifest } from '../../src/lib/inet/manifest'

function makeManifest(dir: string, oppRunPath: string): InetManifest {
  return {
    projectRoot: dir,
    omnetppVersion: '6.0',
    inetVersion: '4.5',
    oppRunPath,
    iniPath: path.join(dir, 'omnetpp.ini'),
    nedPath: path.join(dir, 'src'),
    resultDir: dir,
  }
}

describe('INET runner', () => {
  it('is constructible and exposes cancellation', () => {
    const runner = new InetRunner()
    expect(typeof runner.run).toBe('function')
    expect(() => runner.cancel()).not.toThrow()
  })

  /**
   * 回归测试（模式一 · 异步 'error' 事件）：
   * 目标文件不存在时，ChildProcess 只 emit 'error'、**不会** emit 'close'。
   * 早期实现没有监听 'error'，Node 会把它抛成未捕获异常——
   * 在常驻的 Next 服务里等于「一次失败的 INET 运行把整个后端打崩」。
   * 契约：run() 必须 resolve 成 failed，既不 reject 也不抛未捕获异常。
   */
  it('opp_run 不存在时 resolve 为 failed，而不是抛未捕获异常', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'inet-runner-'))
    const runner = new InetRunner()
    const result = await runner.run({
      manifest: makeManifest(dir, path.join(dir, 'definitely-not-a-real-binary-xyz')),
      outputDir: path.join(dir, 'out'),
      timeoutMs: 5000,
    })

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toMatch(/无法启动 opp_run/)
    expect(result.artifactHash).toBe('')
  })

  /**
   * 回归测试（模式二 · 同步抛出）：
   * Windows 上「路径存在但不是可执行文件」时，spawn 会**同步抛出** EFTYPE，
   * 既不走 'error' 事件，也会让 Promise 直接 reject——
   * 调用方拿到的只是一句 raw 的 "spawn EFTYPE"，对用户毫无指导意义。
   * 契约：同样 resolve 成 failed，且错误信息可操作。
   */
  it('opp_run 存在但不可执行时 resolve 为 failed 且给出可操作提示', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'inet-runner-'))
    mkdirSync(path.join(dir, 'src'), { recursive: true })
    const fakeOpp = path.join(dir, 'opp_run.txt')
    writeFileSync(fakeOpp, 'not an executable', 'utf8')

    const runner = new InetRunner()
    const result = await runner.run({
      manifest: makeManifest(dir, fakeOpp),
      outputDir: path.join(dir, 'out'),
      timeoutMs: 5000,
    })

    expect(result.status).toBe('failed')
    expect(result.exitCode).toBeNull()
    expect(result.stderr).toMatch(/无法启动 opp_run/)
    expect(result.stderr).toMatch(/可执行文件/)
  })
})
