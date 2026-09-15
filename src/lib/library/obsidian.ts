/**
 * Obsidian vault 落盘支持。
 *
 * 分工说明（重要）：
 * - 本文件是「纯逻辑层」：配置形状、子目录/文件名净化、路径围栏校验。
 *   导入 `node:path`，因此**只在服务端（API 路由）与测试中可用**，
 *   客户端组件请用 `@/lib/obsidian-client`。
 * - 真正写盘在 Next API 路由 `src/app/api/notes/export/obsidian/route.ts`。
 *   原因：内部 Next 服务本身就是本机 Node 子进程，有完整 fs 权限，
 *   因此不必额外开一条 Electron IPC 写文件通道（只把「选目录」交给壳层）。
 * - 未配置 vault 或不在 Electron 中运行时，调用方应回退到原本的「另存为」下载。
 */

import path from 'node:path'

export const OBSIDIAN_SETTING_KEY = 'obsidian.config'

export interface ObsidianConfig {
  /** vault 根目录绝对路径；空串表示未配置 */
  vaultPath: string
  /** vault 内的子目录，默认把笔记聚在一个文件夹里，避免污染用户已有 vault */
  subfolder: string
  /** 是否启用「导出 md 时顺便写入 vault」 */
  enabled: boolean
}

export const DEFAULT_OBSIDIAN_SUBFOLDER = 'AI Network Lab'

export const DEFAULT_OBSIDIAN_CONFIG: ObsidianConfig = {
  vaultPath: '',
  subfolder: DEFAULT_OBSIDIAN_SUBFOLDER,
  enabled: true,
}

/** Windows 盘符 / UNC 前缀，用于判定「绝对路径」 */
const WINDOWS_ABSOLUTE = /^[a-zA-Z]:[\\/]/
const UNC_PREFIX = /^[\\/]{2}/

export function isAbsolutePath(p: string): boolean {
  const s = (p || '').trim()
  return s.startsWith('/') || WINDOWS_ABSOLUTE.test(s) || UNC_PREFIX.test(s)
}

/**
 * 清理文件名 / 目录名里的危险字符。
 * 与 sanitizeFilename 的区别：额外拒绝 `.` / `..` 这类「路径语义」名字。
 */
export function sanitizePathSegment(segment: string): string {
  const s = (segment || '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
  if (!s || s === '.' || s === '..') return ''
  return s.replace(/\.+$/, '').trim() || ''
}

/**
 * 把用户填写的子目录规范成「安全的相对路径」。
 * - 绝对路径 / 盘符 / UNC → 直接判为非法，返回空串
 * - `.`、`..`、空片段一律丢弃，杜绝逃出 vault 根目录
 */
export function sanitizeSubfolder(subfolder: string): string {
  const raw = (subfolder || '').trim()
  if (!raw || isAbsolutePath(raw)) return ''
  const parts = raw
    .split(/[\\/]+/)
    .map((seg) => sanitizePathSegment(seg))
    .filter(Boolean)
  return parts.join('/')
}

/** 判断相对路径是否安全（纯字符串实现，无平台依赖） */
export function isSafeRelativePath(rel: string): boolean {
  const s = (rel || '').trim()
  if (!s || isAbsolutePath(s)) return false
  return s
    .split(/[\\/]+/)
    .every((seg) => seg !== '' && seg !== '.' && seg !== '..' && !/[<>:"|?*\u0000-\u001f]/.test(seg))
}

/**
 * 把相对路径拼到 vault 根目录下，并强制校验结果仍在 vault 内；越界返回 null。
 *
 * 这是写入 vault 的**唯一安全边界**，两层防护：
 * 1. `isSafeRelativePath` 先挡掉绝对路径、`..`、盘符、非法字符；
 * 2. 再用 `path.resolve` 归一化后做前缀比对，挡住符号链接式/多层拼接式的逃逸。
 */
export function resolveInsideVault(root: string, rel: string): string | null {
  if (!isSafeRelativePath(rel)) return null
  const rootResolved = path.resolve(root)
  const target = path.resolve(rootResolved, rel)
  if (target === rootResolved) return null // 相对路径不能解析回根目录本身
  if (!target.startsWith(rootResolved + path.sep)) return null
  return target
}

/** 单个文件名（不含目录）的校验：必须是非空、安全、且不带路径分隔符的 .md */
export function isSafeNoteFileName(filename: string): boolean {
  const s = (filename || '').trim()
  if (!s) return false
  // 显式拒绝分隔符：POSIX 下反斜杠是合法文件名字符，但 vault 一旦同步到 Windows 就会变成目录穿越
  if (s.includes('/') || s.includes('\\')) return false
  if (path.basename(s) !== s) return false
  if (!isSafeRelativePath(s)) return false
  return s.toLowerCase().endsWith('.md')
}

/** 笔记标题 → vault 内文件名 */
export function obsidianFileName(title: string): string {
  const base = sanitizePathSegment(title) || 'untitled'
  return `${base.slice(0, 80)}.md`
}

/**
 * 批量导出时消除重名：同名笔记追加 note id 的短后缀。
 * 单篇导出不需要去重，保持文件名干净。
 */
export function dedupeFileNames(entries: Array<{ id?: string; filename: string }>): string[] {
  const used = new Map<string, number>()
  return entries.map((e) => {
    const key = e.filename.toLowerCase()
    const seen = used.get(key) ?? 0
    used.set(key, seen + 1)
    if (seen === 0) return e.filename
    const dot = e.filename.lastIndexOf('.')
    const stem = dot > 0 ? e.filename.slice(0, dot) : e.filename
    const ext = dot > 0 ? e.filename.slice(dot) : '.md'
    const suffix = e.id ? `-${e.id.slice(-6)}` : `-${seen + 1}`
    return `${stem}${suffix}${ext}`
  })
}

/** 归一化从数据库读出的配置（脏数据 / 老版本一律兜底到默认值） */
export function normalizeObsidianConfig(raw: unknown): ObsidianConfig {
  let obj: Record<string, unknown> = {}
  if (typeof raw === 'string') {
    try {
      obj = JSON.parse(raw || '{}') as Record<string, unknown>
    } catch {
      obj = {}
    }
  } else if (raw && typeof raw === 'object') {
    obj = raw as Record<string, unknown>
  }
  const vaultPath = typeof obj.vaultPath === 'string' ? obj.vaultPath.trim() : ''
  const rawSub = typeof obj.subfolder === 'string' ? obj.subfolder : DEFAULT_OBSIDIAN_SUBFOLDER
  const sub = rawSub.trim()
  // 显式填空串 = 直接写 vault 根目录（保留）；填了非法值 = 兜底到默认子目录
  const subfolder = sub === '' ? '' : sanitizeSubfolder(rawSub) || DEFAULT_OBSIDIAN_SUBFOLDER
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true
  return {
    // vaultPath 只做 trim：真正的「是不是一个已存在目录」由壳层用 fs.statSync 判定
    vaultPath,
    subfolder,
    enabled,
  }
}

/** 是否已具备「直接写入 vault」的条件 */
export function isObsidianReady(cfg: ObsidianConfig): boolean {
  return cfg.enabled && cfg.vaultPath.trim().length > 0
}
