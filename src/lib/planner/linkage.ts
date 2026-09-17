/**
 * 规划模块的「联动」与「复盘」纯逻辑。
 *
 * - 联动（D2）：实验/稿件的状态变化，按固定规则映射成里程碑的**建议进度**。
 *   这里刻意只做「派生」，不直接写库 —— 写库交给 `/api/planner/sync`，
 *   于是规则可以单测、写入时机可控（不会再出现「改了个实验，甘特图自己乱动」）。
 * - 复盘（D3）：把「计划结束日 vs 实际完成日」算成偏差天数，供报告使用。
 */

import { isIsoDate } from './config'
import { diffDaysIso, parseWeekIndex, toLocalIsoDate, weekEndIso, weekStartIso, isoToMs } from './schedule'

// ============ 关联类型 ============

export type RefType = '' | 'experiment' | 'manuscript'

export const REF_TYPE_LABELS: Record<Exclude<RefType, ''>, string> = {
  experiment: '实验',
  manuscript: '稿件',
}

export function normalizeRefType(value: unknown): RefType {
  return value === 'experiment' || value === 'manuscript' ? value : ''
}

// ============ 进度派生（D2 正向） ============

export interface ExperimentLike {
  id: string
  name: string
  status: string
}

export interface ManuscriptLike {
  id: string
  title: string
  status: string
  targetWords: number
  sections: string
}

export type RefSnapshot =
  | { type: 'experiment'; item: ExperimentLike }
  | { type: 'manuscript'; item: ManuscriptLike }

/** 实验状态 → 建议进度。failed 不推进（失败要人来看，不能替用户宣布完成） */
export const EXPERIMENT_STATUS_PROGRESS: Record<string, number> = {
  planned: 0,
  running: 60,
  completed: 100,
  failed: 0,
}

/** 稿件未投稿时的进度上限：不投出去就永远不显示 100%，避免「初稿写完 = 完成」的假象 */
export const MANUSCRIPT_DRAFT_CAP = 95

/** 中英混排字数统计：CJK 逐字计，拉丁按空白分词 */
export function countWords(text: string): number {
  if (typeof text !== 'string' || !text) return 0
  const cjk = text.match(/[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g)
  const cjkCount = cjk ? cjk.length : 0
  const latin = text.replace(/[\u3400-\u4DBF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/g, ' ')
  const latinCount = latin.split(/\s+/).filter((token) => /[A-Za-z0-9]/.test(token)).length
  return cjkCount + latinCount
}

interface ManuscriptSectionLike {
  content?: unknown
}

/** 稿件正文字数 = 各章节 content 之和；sections 非法时返回 0（不抛异常） */
export function manuscriptWordCount(sections: string): number {
  try {
    const parsed = JSON.parse(sections || '[]')
    if (!Array.isArray(parsed)) return 0
    return parsed.reduce((sum, s: ManuscriptSectionLike) => {
      const content = typeof s?.content === 'string' ? s.content : ''
      return sum + countWords(content)
    }, 0)
  } catch {
    return 0
  }
}

function clampProgress(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 快照 → 建议进度；无法派生时返回 null（调用方应保持里程碑原值） */
export function deriveProgress(snapshot: RefSnapshot | null | undefined): number | null {
  if (!snapshot) return null

  if (snapshot.type === 'experiment') {
    const mapped = EXPERIMENT_STATUS_PROGRESS[snapshot.item.status]
    return mapped === undefined ? null : clampProgress(mapped)
  }

  if (snapshot.item.status === 'submitted') return 100
  const target = Number(snapshot.item.targetWords) || 0
  if (target <= 0) return 0
  const words = manuscriptWordCount(snapshot.item.sections)
  return clampProgress(Math.min(MANUSCRIPT_DRAFT_CAP, (words / target) * 100))
}

// ============ 里程碑 ============

export interface MilestoneLike {
  id: string
  type: string
  title: string
  startDate: string
  endDate: string
  progress: number
  actualEndDate?: string
  refType?: string
  refId?: string
  autoProgress?: boolean
}

/** 里程碑的计划开始日（甘特图由周序号 + 项目起始日换算；其余按 ISO 日期） */
export function plannedStartIso(m: MilestoneLike, projectStart: string): string | null {
  if (m.type === 'gantt') {
    const idx = parseWeekIndex(m.startDate)
    return idx === null ? null : weekStartIso(projectStart, idx)
  }
  return isIsoDate(m.startDate) ? m.startDate : null
}

/** 里程碑的计划结束日 */
export function plannedEndIso(m: MilestoneLike, projectStart: string): string | null {
  if (m.type === 'gantt') {
    const idx = parseWeekIndex(m.endDate)
    return idx === null ? null : weekEndIso(projectStart, idx)
  }
  return isIsoDate(m.endDate) ? m.endDate : null
}

/**
 * 这个里程碑当前是否该被同步推进。
 *
 * 只在 autoProgress 打开时才返回非空 —— 默认关闭，链接仅作为 UI 提示，
 * 保证「用户手工填的进度」不会被一个关联悄悄改掉。
 */
export function syncedProgress(m: MilestoneLike, snapshot: RefSnapshot | null | undefined): number | null {
  if (!m.autoProgress) return null
  if (!normalizeRefType(m.refType) || !m.refId) return null
  const derived = deriveProgress(snapshot)
  if (derived === null) return null
  // 只推进、不回退：自动同步不应把用户已经推进的进度拉低
  return Math.max(clampProgress(m.progress), derived)
}

// ============ 偏差复盘（D3） ============

export type DeviationState = 'ahead' | 'on-time' | 'behind' | 'in-progress' | 'unknown'

export interface Deviation {
  id: string
  title: string
  type: string
  progress: number
  plannedEnd: string | null
  actualEnd: string | null
  /** >0 = 比计划晚 N 天；<0 = 提前；null = 无法计算 */
  deviationDays: number | null
  state: DeviationState
}

export function computeDeviation(
  m: MilestoneLike,
  projectStart: string,
  now: Date,
): Deviation {
  const progress = clampProgress(m.progress)
  const plannedEnd = plannedEndIso(m, projectStart)
  const actualEnd = isIsoDate(m.actualEndDate) ? m.actualEndDate : null

  let deviationDays: number | null = null
  let state: DeviationState = 'unknown'

  if (progress >= 100) {
    if (plannedEnd && actualEnd) {
      deviationDays = diffDaysIso(actualEnd, plannedEnd)
      state = deviationDays === null ? 'unknown' : deviationDays < 0 ? 'ahead' : deviationDays === 0 ? 'on-time' : 'behind'
    } else {
      state = 'unknown'
    }
  } else if (plannedEnd) {
    const overdue = diffDaysIso(toLocalIsoDate(now), plannedEnd)
    if (overdue !== null && overdue > 0) {
      deviationDays = overdue
      state = 'behind'
    } else {
      state = 'in-progress'
    }
  } else {
    state = 'unknown'
  }

  return {
    id: m.id,
    title: m.title,
    type: m.type,
    progress,
    plannedEnd,
    actualEnd,
    deviationDays,
    state,
  }
}

export interface DeviationSummary {
  total: number
  done: number
  ahead: number
  onTime: number
  behind: number
  inProgress: number
  unknown: number
  /** 平均偏差天数（只统计能算出来的），保留 1 位小数 */
  avgDeviationDays: number | null
  /** 偏差最大的前 3 条（最该处理的） */
  worst: Deviation[]
}

export function summarizeDeviation(rows: readonly Deviation[]): DeviationSummary {
  const withDev = rows.filter((r) => r.deviationDays !== null)
  const sum = withDev.reduce((acc, r) => acc + (r.deviationDays as number), 0)

  const worst = [...withDev]
    .sort((a, b) => (b.deviationDays as number) - (a.deviationDays as number))
    .slice(0, 3)

  return {
    total: rows.length,
    done: rows.filter((r) => r.progress >= 100).length,
    ahead: rows.filter((r) => r.state === 'ahead').length,
    onTime: rows.filter((r) => r.state === 'on-time').length,
    behind: rows.filter((r) => r.state === 'behind').length,
    inProgress: rows.filter((r) => r.state === 'in-progress').length,
    unknown: rows.filter((r) => r.state === 'unknown').length,
    avgDeviationDays: withDev.length ? Math.round((sum / withDev.length) * 10) / 10 : null,
    worst,
  }
}

export const DEVIATION_STATE_LABELS: Record<DeviationState, string> = {
  ahead: '提前完成',
  'on-time': '按时完成',
  behind: '落后',
  'in-progress': '进行中',
  unknown: '无法判定',
}

function formatSigned(days: number | null): string {
  if (days === null) return '—'
  if (days === 0) return '当天'
  return days > 0 ? `晚 ${days} 天` : `早 ${-days} 天`
}

/**
 * 偏差报告（Markdown）。用表格而不是长句，便于贴进组会材料或直接交给导师。
 * 生成逻辑是纯函数，所以「导出的内容和页面显示的一致」这件事可以被单测锁住。
 */
export function renderDeviationMarkdown(
  rows: readonly Deviation[],
  summary: DeviationSummary,
  meta: { projectStart: string; generatedAt: Date; projectName?: string },
): string {
  const lines: string[] = []
  lines.push(`# 研究进度偏差报告`)
  lines.push('')
  if (meta.projectName) lines.push(`- 项目：${meta.projectName}`)
  lines.push(`- 项目起始日：${meta.projectStart || '未设置'}`)
  lines.push(`- 生成时间：${toLocalIsoDate(meta.generatedAt)}`)
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push(`- 里程碑总数：${summary.total}`)
  lines.push(`- 已完成：${summary.done}（按时 ${summary.onTime} · 提前 ${summary.ahead} · 落后 ${summary.behind}）`)
  lines.push(`- 进行中：${summary.inProgress} · 落后中：${summary.behind}`)
  lines.push(`- 无法判定：${summary.unknown}`)
  lines.push(`- 平均偏差：${summary.avgDeviationDays === null ? '—' : `${summary.avgDeviationDays} 天`}`)
  lines.push('')
  lines.push('## 逐条明细')
  lines.push('')
  lines.push('| 里程碑 | 类型 | 进度 | 计划完成 | 实际完成 | 偏差 | 状态 |')
  lines.push('| --- | --- | --- | --- | --- | --- | --- |')
  for (const r of rows) {
    lines.push(
      `| ${r.title} | ${r.type} | ${r.progress}% | ${r.plannedEnd ?? '—'} | ${r.actualEnd ?? '—'} | ${formatSigned(r.deviationDays)} | ${DEVIATION_STATE_LABELS[r.state]} |`,
    )
  }
  if (summary.worst.length) {
    lines.push('')
    lines.push('## 最需要处理的')
    lines.push('')
    for (const w of summary.worst) {
      lines.push(`- **${w.title}**：${DEVIATION_STATE_LABELS[w.state]}（${formatSigned(w.deviationDays)}）`)
    }
  }
  lines.push('')
  return lines.join('\n')
}

/** 供偏差报告使用的排序：落后优先、其次进度低，最后按计划结束日 */
export function sortForDeviation(rows: readonly Deviation[]): Deviation[] {
  const rank: Record<DeviationState, number> = {
    behind: 0,
    'in-progress': 1,
    unknown: 2,
    'on-time': 3,
    ahead: 4,
  }
  return [...rows].sort((a, b) => {
    if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state]
    if (a.plannedEnd && b.plannedEnd && a.plannedEnd !== b.plannedEnd) {
      return a.plannedEnd < b.plannedEnd ? -1 : 1
    }
    return a.progress - b.progress
  })
}

/** 判断 ISO 日期是否已过（给 UI 标红用） */
export function isPast(iso: string, now: Date): boolean {
  const ms = isoToMs(iso)
  if (ms === null) return false
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return ms < todayMs
}
