/**
 * 壳层（Electron 主进程）「检查更新」能力的浏览器侧封装。
 *
 * 所有调用都做存在性判断：同一套前端也会直接跑在浏览器里（npm run dev），
 * 那里没有 window.electronXxx，不能直接调，否则一进页面就报错。
 */

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'latest'
  | 'downloading'
  | 'downloaded'
  | 'error'
  /** 主进程发现「另一个版本正在运行」时的告警（不是更新链路的状态） */
  | 'conflict'

export interface UpdateStatusPayload {
  state: UpdateState
  /** 当前版本 */
  current?: string
  /** 更新源上的版本 */
  version?: string
  /** 下载进度 0-100 */
  percent?: number
  /** 失败分类：no-release / no-channel / network / unknown / dev / no-updater / untrusted */
  reason?: string
  /** 面向用户的一句话说明 */
  message?: string
}

export interface AppInfo {
  ok: boolean
  version?: string
  isPackaged?: boolean
  platform?: string
  electron?: string
  updateStatus?: UpdateStatusPayload
  error?: string
}

export interface UpdateCheckResult {
  ok: boolean
  current?: string
  latest?: string | null
  hasUpdate?: boolean
  reason?: string
  error?: string
}

export interface SimpleResult {
  ok: boolean
  error?: string
}

interface DesktopBridge {
  electronAppInfo?: () => Promise<AppInfo>
  electronCheckUpdates?: () => Promise<UpdateCheckResult>
  electronDownloadUpdate?: () => Promise<SimpleResult>
  electronInstallUpdate?: () => Promise<SimpleResult>
  electronOnUpdateStatus?: (cb: (p: UpdateStatusPayload) => void) => number
  electronOffUpdateStatus?: (id: number) => void
}

function bridge(): DesktopBridge {
  if (typeof window === 'undefined') return {}
  return (window as unknown as DesktopBridge) || {}
}

/** 是否跑在桌面壳里（有更新能力） */
export function hasDesktopUpdate(): boolean {
  return typeof bridge().electronCheckUpdates === 'function'
}

export async function getAppInfo(): Promise<AppInfo | null> {
  const fn = bridge().electronAppInfo
  if (typeof fn !== 'function') return null
  try {
    return await fn()
  } catch {
    return null
  }
}

export async function checkForUpdates(): Promise<UpdateCheckResult> {
  const fn = bridge().electronCheckUpdates
  if (typeof fn !== 'function') {
    return { ok: false, reason: 'no-bridge', error: '当前是浏览器环境，没有检查更新的能力' }
  }
  try {
    return await fn()
  } catch (e) {
    return { ok: false, reason: 'unknown', error: e instanceof Error ? e.message : String(e) }
  }
}

export async function downloadUpdate(): Promise<SimpleResult> {
  const fn = bridge().electronDownloadUpdate
  if (typeof fn !== 'function') return { ok: false, error: '当前环境不支持下载更新' }
  try {
    return await fn()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export async function installUpdate(): Promise<SimpleResult> {
  const fn = bridge().electronInstallUpdate
  if (typeof fn !== 'function') return { ok: false, error: '当前环境不支持安装更新' }
  try {
    return await fn()
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

/**
 * 订阅主进程推来的更新状态，返回退订函数。
 * 不在桌面环境时返回一个空操作，调用方不需要写 if。
 */
export function onUpdateStatus(cb: (p: UpdateStatusPayload) => void): () => void {
  const on = bridge().electronOnUpdateStatus
  const off = bridge().electronOffUpdateStatus
  if (typeof on !== 'function') return () => {}
  const id = on(cb)
  return () => {
    if (typeof off === 'function' && id) off(id)
  }
}
