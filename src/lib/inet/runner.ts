import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { parseResultDirectory, type ResultSummary } from './results'
import type { InetManifest } from './manifest'

export type InetRunStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
export interface InetRunRequest { manifest: InetManifest; iniPath?: string; configName?: string; parameters?: Record<string, string | number | boolean>; timeoutMs?: number; outputDir: string }
export interface InetRunResult { status: InetRunStatus; exitCode: number | null; stdout: string; stderr: string; result: ResultSummary; artifactHash: string }

function sha256(file: string): string { return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') }

export class InetRunner {
  private child: ChildProcessWithoutNullStreams | null = null
  private timer: NodeJS.Timeout | null = null
  cancel() { if (this.child) { this.child.kill(); this.child = null } if (this.timer) clearTimeout(this.timer) }
  run(request: InetRunRequest): Promise<InetRunResult> {
    const out = path.resolve(request.outputDir); fs.mkdirSync(out, { recursive: true })
    const ini = path.resolve(request.iniPath ?? request.manifest.iniPath)
    const args = ['-u', 'Cmdenv', '-f', ini]
    if (request.configName) args.push('-c', request.configName)
    for (const [key, value] of Object.entries(request.parameters ?? {})) args.push(`--${key}=${String(value)}`)
    return new Promise((resolve) => {
      const stdout: string[] = []; const stderr: string[] = []
      let settled = false
      const settle = (r: InetRunResult) => { if (settled) return; settled = true; if (this.timer) clearTimeout(this.timer); this.timer = null; resolve(r) }
      // 启动失败统一走这里，保证两种失败模式的错误信息对用户同样可读、可操作
      const failToStart = (detail: string) => {
        this.child = null
        settle({ status: 'failed', exitCode: null, stdout: stdout.join(''), stderr: `${stderr.join('')}\n${detail}`, result: parseResultDirectory(out), artifactHash: '' })
      }

      let child: ChildProcessWithoutNullStreams
      try {
        child = spawn(request.manifest.oppRunPath, args, { cwd: request.manifest.projectRoot, shell: false })
      } catch (e) {
        // Windows 上「路径存在但不是可执行文件」时 spawn 会**同步抛出**（如 EFTYPE），
        // 不走 'error' 事件。不兜住的话，数据库里只会留下一句 raw 的 "spawn EFTYPE"。
        failToStart(`无法启动 opp_run：${(e as Error).message}（请确认该路径是可执行文件，而非同名占位文件）`)
        return
      }
      this.child = child
      child.stdout.on('data', (d) => stdout.push(String(d))); child.stderr.on('data', (d) => stderr.push(String(d)))
      // 必须监听 'error'：spawn 失败（ENOENT 等）时 ChildProcess 只 emit 'error'、不再 emit 'close'；
      // EventEmitter 在无监听者时会把它抛成未捕获异常，直接打崩常驻的 Next 服务进程。
      child.on('error', (err) => failToStart(`无法启动 opp_run：${err.message}`))
      this.timer = setTimeout(() => { this.cancel(); settle({ status: 'failed', exitCode: null, stdout: stdout.join(''), stderr: `${stderr.join('')}\nTimed out`, result: parseResultDirectory(out), artifactHash: '' }) }, request.timeoutMs ?? 10 * 60 * 1000)
      child.on('close', (code, signal) => {
        this.child = null
        const status: InetRunStatus = signal ? 'cancelled' : code === 0 ? 'succeeded' : 'failed'
        const files = fs.readdirSync(out).map((f) => path.join(out, f)).filter((f) => fs.statSync(f).isFile())
        const hash = files.length ? crypto.createHash('sha256').update(files.map(sha256).join('|')).digest('hex') : ''
        settle({ status, exitCode: code, stdout: stdout.join(''), stderr: stderr.join(''), result: parseResultDirectory(out), artifactHash: hash })
      })
    })
  }
}
