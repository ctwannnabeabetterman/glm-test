'use client'

/**
 * Obsidian 集成的渲染层调用封装。
 *
 * 两条链路：
 * - 配置读写 / 写入 vault → 内部服务（Next API），服务端直接落盘；
 * - 「选择目录」→ Electron 壳层 IPC（浏览器拿不到目录绝对路径），
 *   非 Electron 环境返回 available=false，UI 需退回手填路径。
 */

export interface ObsidianStatus {
  vaultPath: string
  subfolder: string
  enabled: boolean
  vaultExists: boolean
  vaultIsDir: boolean
  vaultError: string | null
  ready: boolean
}

export interface ObsidianSyncResult {
  ok: boolean
  dir?: string
  total?: number
  writtenCount?: number
  skipped?: number
  written?: Array<{ filename: string; path: string; bytes: number }>
  errors?: Array<{ filename: string; error: string }>
  error?: string
  code?: string
}

type PickResult = { ok: boolean; path?: string; canceled?: boolean; error?: string; available: boolean }

export const DEFAULT_OBSIDIAN_STATUS: ObsidianStatus = {
  vaultPath: '',
  subfolder: 'AI Network Lab',
  enabled: true,
  vaultExists: false,
  vaultIsDir: false,
  vaultError: null,
  ready: false,
}

export async function loadObsidianStatus(): Promise<ObsidianStatus> {
  try {
    const res = await fetch('/api/settings/obsidian')
    if (!res.ok) return { ...DEFAULT_OBSIDIAN_STATUS }
    return (await res.json()) as ObsidianStatus
  } catch {
    return { ...DEFAULT_OBSIDIAN_STATUS }
  }
}

export async function saveObsidianStatus(patch: {
  vaultPath?: string
  subfolder?: string
  enabled?: boolean
}): Promise<ObsidianStatus> {
  const res = await fetch('/api/settings/obsidian', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
  const data = (await res.json()) as ObsidianStatus & { error?: string }
  if (!res.ok) throw new Error(data.error || '保存 vault 配置失败')
  return data
}

/** 调起原生目录选择器；非 Electron 环境返回 available=false */
export async function pickVaultDir(): Promise<PickResult> {
  const pick = (
    window as Window & {
      electronPickVaultDir?: () => Promise<{ ok: boolean; path?: string; canceled?: boolean; error?: string }>
    }
  ).electronPickVaultDir
  if (typeof pick !== 'function') {
    return { ok: false, available: false, error: '当前环境不支持原生目录选择，请手动填写路径' }
  }
  try {
    const result = await pick()
    return { ...result, available: true }
  } catch (e) {
    return { ok: false, available: true, error: (e as Error).message }
  }
}

/** 把笔记写入 vault：单篇或整个分类 */
export async function syncToObsidian(
  scope: 'note' | 'category',
  options: { id?: string; category?: string } = {},
): Promise<ObsidianSyncResult> {
  const res = await fetch('/api/notes/export/obsidian', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, ...options }),
  })
  const data = (await res.json()) as ObsidianSyncResult
  if (!res.ok) return { ...data, ok: false, error: data.error || '写入 vault 失败' }
  return data
}
