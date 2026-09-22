import { db } from '@/lib/db'

/**
 * 使用记录（Activity）—— 「每个模块都被怎么用了」的时间线。
 *
 * 设计要点（每一条都对应一个具体的坏结果）：
 *
 * 1. **写入永不抛错**：`recordActivity` 内部吞掉所有异常。记录是**旁路**，
 *    新表在极老/未迁移的库上可能还不存在（P2021），若在这里抛出去，用户的一次「保存笔记」
 *    就会因为他根本不知道的原因失败 —— 那比「少一条记录」严重得多。
 *
 * 2. **只记有意义的动作**：不把每个 API 调用都记下来。`settings` 模块只记「换了 API Key」这类
 *    真正改变状态的事，不记每次 GET；否则时间线会被噪声淹没，用户不会再打开它。
 *
 * 3. **标题是给人看的一句话**：`写了科研笔记「DRL资源分配 - 核心方法笔记」`。
 *    存结构化的 module/action 是为了聚合与筛选，但它不能替代一句人话。
 *
 * 4. **有上限**：90 天 / 5000 行，机会式清理（约每 50 次写入清一次）。
 *    单机 SQLite 也要有个界 —— 不设界的日志表迟早变成一块没人管的石头。
 */

export type ActivityModule =
  | 'paper'
  | 'note'
  | 'writing'
  | 'experiment'
  | 'topic'
  | 'planner'
  | 'sim'
  | 'search'
  | 'settings'
  | 'backup'

export type ActivityAction =
  | 'create'
  | 'update'
  | 'delete'
  | 'generate'
  | 'run'
  | 'export'
  | 'import'
  | 'sync'

export interface ModuleMeta {
  label: string
  /** 图表配色（同一模块在曲线、柱状、图例里保持一致） */
  color: string
}

export const MODULE_META: Record<ActivityModule, ModuleMeta> = {
  paper: { label: '论文库', color: '#3b82f6' },
  note: { label: '科研笔记', color: '#10b981' },
  writing: { label: '论文写作', color: '#8b5cf6' },
  experiment: { label: '实验管理', color: '#f59e0b' },
  topic: { label: '选题评估', color: '#ef4444' },
  planner: { label: '研究规划', color: '#06b6d4' },
  sim: { label: '组网仿真', color: '#6366f1' },
  search: { label: '文献检索', color: '#84cc16' },
  settings: { label: '系统设置', color: '#94a3b8' },
  backup: { label: '数据备份', color: '#a855f7' },
}

export const ACTION_LABEL: Record<ActivityAction, string> = {
  create: '新建',
  update: '修改',
  delete: '删除',
  generate: 'AI 生成',
  run: '运行',
  export: '导出',
  import: '导入',
  sync: '同步',
}

export function moduleLabel(module: string): string {
  return MODULE_META[module as ActivityModule]?.label ?? module
}

export function moduleColor(module: string): string {
  return MODULE_META[module as ActivityModule]?.color ?? '#94a3b8'
}

/** 标题里引用的对象名可能很长或含换行 —— 截断并压平，保证时间线一行能读完 */
export function clipTitle(raw: string, max = 60): string {
  const s = String(raw || '').replace(/\s+/g, ' ').trim()
  return s.length > max ? `${s.slice(0, max - 1)}…` : s
}

export interface ActivityInput {
  module: ActivityModule
  action: ActivityAction
  /** 人话标题（不含模块前缀 —— 展示时会带上模块名） */
  title: string
  refId?: string
  detail?: string
}

let writeCount = 0
const PRUNE_EVERY = 50

/**
 * 记一条使用记录。**永不抛错、永不阻塞**（调用方不必 await，也不该 try/catch）。
 *
 * 用法：在业务动作**成功之后**调用，例如
 *   `void recordActivity({ module: 'note', action: 'create', title: `写了科研笔记「${note.title}」`, refId: note.id })`
 */
export async function recordActivity(input: ActivityInput): Promise<boolean> {
  try {
    await db.activity.create({
      data: {
        module: input.module,
        action: input.action,
        title: clipTitle(input.title, 120),
        refId: input.refId ?? '',
        detail: input.detail ?? '',
      },
    })
    writeCount += 1
    if (writeCount % PRUNE_EVERY === 0) void pruneActivities()
    return true
  } catch (e) {
    // 表不存在（老库未迁移）、磁盘满、并发锁…… 一律只记一条警告，绝不影响用户正在做的事
    console.warn('[activity] 记录失败（已忽略）：', (e as Error)?.message ?? e)
    return false
  }
}

/** 清理过老/过多的记录（90 天 / 5000 行封顶）。失败同样不影响任何事。 */
export async function pruneActivities(keepDays = 90, maxRows = 5000): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - keepDays * 24 * 60 * 60 * 1000)
    await db.activity.deleteMany({ where: { createdAt: { lt: cutoff } } })
    const total = await db.activity.count()
    if (total > maxRows) {
      // 超量时删掉最老的一批（按 createdAt 升序取要删的 id，避免一次删太多）
      const extra = await db.activity.findMany({
        select: { id: true },
        orderBy: { createdAt: 'asc' },
        take: total - maxRows,
      })
      if (extra.length) await db.activity.deleteMany({ where: { id: { in: extra.map((r) => r.id) } } })
    }
  } catch (e) {
    console.warn('[activity] 清理失败（已忽略）：', (e as Error)?.message ?? e)
  }
}

// ---------------- 聚合（纯函数，便于单测） ----------------

export interface ActivityLike {
  createdAt: Date | string
  module: string
  action: string
  title: string
  refId?: string
  detail?: string
}

export interface ActivityDay {
  /** YYYY-MM-DD（本地时区） */
  date: string
  count: number
  byModule: Array<{ module: string; label: string; count: number }>
  byAction: Array<{ action: string; label: string; count: number }>
  /** 取当天最新的 3 条，给「今天/昨天」这种近处一栏做个预览 */
  latest: Array<{ module: string; label: string; action: string; title: string; at: string }>
}

export interface ActivitySummary {
  days: ActivityDay[]
  /** 窗口内按模块汇总（降序，供「这周主要在做什么」） */
  modules: Array<{ module: string; label: string; color: string; count: number }>
  totals: { count: number; activeDays: number }
  busiest: { date: string; count: number } | null
}

/** 本地时区的 YYYY-MM-DD（UTC 会把东八区凌晨记到前一天） */
export function localDateKey(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

/**
 * 把使用记录按天 + 按模块聚合。
 * `now` 由调用方注入（不要在纯函数里读 `new Date()`，否则没法单测）。
 */
export function summarizeActivity(rows: ActivityLike[], now: Date, days = 7): ActivitySummary {
  const span = Math.max(1, Math.min(90, Math.round(days)))
  const buckets = new Map<string, ActivityLike[]>()
  const order: string[] = []
  for (let i = span - 1; i >= 0; i -= 1) {
    const key = localDateKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))
    buckets.set(key, [])
    order.push(key)
  }
  for (const r of rows) {
    const d = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt))
    if (Number.isNaN(d.getTime())) continue
    const b = buckets.get(localDateKey(d))
    if (b) b.push(r)
  }

  const dayList: ActivityDay[] = order.map((date) => {
    const list = buckets.get(date)!.slice().sort((a, b) => {
      const ta = (a.createdAt instanceof Date ? a.createdAt : new Date(String(a.createdAt))).getTime()
      const tb = (b.createdAt instanceof Date ? b.createdAt : new Date(String(b.createdAt))).getTime()
      return tb - ta
    })
    const modCount = new Map<string, number>()
    const actCount = new Map<string, number>()
    for (const r of list) {
      modCount.set(r.module, (modCount.get(r.module) ?? 0) + 1)
      actCount.set(r.action, (actCount.get(r.action) ?? 0) + 1)
    }
    const toTop = (m: Map<string, number>) =>
      [...m.entries()].sort((a, b) => b[1] - a[1]).map(([key, count]) => ({ key, count }))
    return {
      date,
      count: list.length,
      byModule: toTop(modCount).map(({ key, count }) => ({ module: key, label: moduleLabel(key), count })),
      byAction: toTop(actCount).map(({ key, count }) => ({
        action: key,
        label: ACTION_LABEL[key as ActivityAction] ?? key,
        count,
      })),
      latest: list.slice(0, 3).map((r) => {
        const d = r.createdAt instanceof Date ? r.createdAt : new Date(String(r.createdAt))
        return { module: r.module, label: moduleLabel(r.module), action: r.action, title: r.title, at: hhmm(d) }
      }),
    }
  })

  const moduleTotals = new Map<string, number>()
  for (const r of rows) moduleTotals.set(r.module, (moduleTotals.get(r.module) ?? 0) + 1)
  const modules = [...moduleTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([module, count]) => ({ module, label: moduleLabel(module), color: moduleColor(module), count }))

  const total = dayList.reduce((a, d) => a + d.count, 0)
  const activeDays = dayList.filter((d) => d.count > 0).length
  const busiest = dayList.reduce<{ date: string; count: number } | null>(
    (best, d) => (d.count > 0 && (!best || d.count > best.count) ? { date: d.date, count: d.count } : best),
    null,
  )
  return { days: dayList, modules, totals: { count: total, activeDays }, busiest }
}
