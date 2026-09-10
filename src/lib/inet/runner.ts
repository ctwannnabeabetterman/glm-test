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
      this.child = spawn(request.manifest.oppRunPath, args, { cwd: request.manifest.projectRoot, shell: false })
      this.child.stdout.on('data', (d) => stdout.push(String(d))); this.child.stderr.on('data', (d) => stderr.push(String(d)))
      this.timer = setTimeout(() => { this.cancel(); resolve({ status: 'failed', exitCode: null, stdout: stdout.join(''), stderr: `${stderr.join('')}\nTimed out`, result: parseResultDirectory(out), artifactHash: '' }) }, request.timeoutMs ?? 10 * 60 * 1000)
      this.child.on('close', (code, signal) => {
        if (this.timer) clearTimeout(this.timer); this.child = null
        const status: InetRunStatus = signal ? 'cancelled' : code === 0 ? 'succeeded' : 'failed'
        const files = fs.readdirSync(out).map((f) => path.join(out, f)).filter((f) => fs.statSync(f).isFile())
        const hash = files.length ? crypto.createHash('sha256').update(files.map(sha256).join('|')).digest('hex') : ''
        resolve({ status, exitCode: code, stdout: stdout.join(''), stderr: stderr.join(''), result: parseResultDirectory(out), artifactHash: hash })
      })
    })
  }
}
