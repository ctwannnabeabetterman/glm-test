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
  /** 实时下载速度（字节/秒），仅 downloading 时有意义 */
  speed?: number
  /** 已下载字节数 */
  transferred?: number
  /** 安装包总字节数 */
  total?: number
  /**
   * 已下载安装包在本机的绝对路径（仅 state === 'downloaded' 时有值）。
   *
   * 为什么要有：用户反馈「不知道怎么下的」—— 下载过程中的进度只存在于窗口标题
   * 和「设置 → 软件更新」卡片里，而下载完成后的原生对话框只说了「已下载」，
   * 没说文件在哪。把路径随状态推上来，界面就能直接告诉他安装包落在哪。
   */
  file?: string
  /**
   * 失败分类：
   * no-release / no-channel / upstream / network / unknown / dev / no-updater / untrusted
   * / stalled（45 秒无任何进度，判定网络卡死，可重试）
   *
   * `upstream` 是 2026-09-21 加的：更新源（GitHub）瞬时 5xx。以前它落到 `unknown`，
   * 用户看到的是「更新出错：unknown — 504」—— 既不知道是谁的锅，也不知道能不能重试。
   */
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
