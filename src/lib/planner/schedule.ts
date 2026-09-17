/**
 * 研究规划的时间与排期纯逻辑。
 *
 * 全部为纯函数、不依赖框架与时区环境（内部一律用「民用日历 + UTC 毫秒」做运算，
 * 避开本地时区与夏令时导致的日期漂移）。放在这里而不是组件里，是为了可以单测。
 */

import { DAY_NAMES } from './config'

const MS_PER_DAY = 86_400_000
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

interface Civil {
  y: number
  m: number
  d: number
}

function civilToMs(c: Civil): number {
  return Date.UTC(c.y, c.m - 1, c.d)
}

function msToCivil(ms: number): Civil {
  const d = new Date(ms)
  return { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate() }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

function civilToIso(c: Civil): string {
  return `${c.y}-${pad2(c.m)}-${pad2(c.d)}`
}

/** Date → 本地日历日期的 YYYY-MM-DD（不经过 toISOString，避免 UTC 偏移把日期挪一天） */
export function toLocalIsoDate(d: Date): string {
  return civilToIso({ y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate() })
}

/** YYYY-MM-DD → UTC 毫秒；非法输入返回 null */
export function isoToMs(iso: string): number | null {
  if (typeof iso !== 'string' || !ISO_DATE_RE.test(iso)) return null
  const [y, m, d] = iso.split('-').map(Number)
  const ms = Date.UTC(y, m - 1, d)
  // 反向校验，挡掉 2026-02-31 这类「格式合法但日期不存在」的输入
  const back = msToCivil(ms)
  if (back.y !== y || back.m !== m || back.d !== d) return null
  return ms
}

/** date + n 天；输入非法返回 null */
export function addDaysIso(iso: string, days: number): string | null {
  const ms = isoToMs(iso)
  if (ms === null || !Number.isFinite(days)) return null
  return civilToIso(msToCivil(ms + Math.trunc(days) * MS_PER_DAY))
}

/** a - b 的天数差（a 晚于 b 为正）；任一非法返回 null */
export function diffDaysIso(a: string, b: string): number | null {
  const ma = isoToMs(a)
  const mb = isoToMs(b)
  if (ma === null || mb === null) return null
  return Math.round((ma - mb) / MS_PER_DAY)
}

function startOfWeekFromMs(ms: number): string {
  const dow = new Date(ms).getUTCDay() // 0=周日
  const offset = (dow === 0 ? 7 : dow) - 1
  return civilToIso(msToCivil(ms - offset * MS_PER_DAY))
}

/** 取某天所在周的周一（周计划以周一为一周之始，与通知模块保持一致） */
export function startOfWeekIso(d: Date): string {
  return startOfWeekFromMs(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
}

/** ISO 日期 → 其所在周的周一；非法输入返回 null */
export function startOfWeekFromIso(iso: string): string | null {
  const ms = isoToMs(iso)
  return ms === null ? null : startOfWeekFromMs(ms)
}

/**
 * 把「客户端传来的周参数」归一化成该周周一。
 * 非法/缺失时退回今天所在周 —— 前端传周中任意一天也不会查到空列表。
 */
export function resolveWeekStart(input?: string | null): string {
  const parsed = typeof input === 'string' ? startOfWeekFromIso(input) : null
  return parsed ?? startOfWeekIso(new Date())
}

/**
 * 解析甘特图的周序号。
 *
 * 只认「非负整数字符串/数字」—— 甘特图的 startDate 存的就是 "0".."39"。
 * 注意不能直接 Number()：空串会变成 0，把「没填」误当成「第 1 周」。
 */
export function parseWeekIndex(value: unknown): number | null {
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 0 ? value : null
  }
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  return Number(trimmed)
}

/**
 * 周序号 → 该周周一的日期。
 * `weekIndex` 是 0-based（第 1 周 = 0），与 GANTT_TEMPLATE 的 `start/end` 一致。
 */
export function weekStartIso(projectStart: string, weekIndex: number): string | null {
  if (!Number.isInteger(weekIndex) || weekIndex < 0) return null
  return addDaysIso(projectStart, weekIndex * 7)
}

/** 周序号 → 该周周日的日期（周的最后一个自然日） */
export function weekEndIso(projectStart: string, weekIndex: number): string | null {
  if (!Number.isInteger(weekIndex) || weekIndex < 0) return null
  return addDaysIso(projectStart, weekIndex * 7 + 6)
}

/**
 * 从项目起始日到 `now` 已经过了几个整周（0-based）。
 * 起始日当天 = 第 1 周（返回 0）；返回负数表示项目尚未开始。
 */
export function weeksSince(projectStart: string, now: Date): number | null {
  const startMs = isoToMs(projectStart)
  if (startMs === null) return null
  const todayMs = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
  return Math.floor((todayMs - startMs) / (7 * MS_PER_DAY))
}

/** "MM-DD ~ MM-DD" —— 甘特图轴上的真实日期区间 */
export function weekRangeLabel(projectStart: string, startIndex: number, endIndex: number): string | null {
  const a = weekStartIso(projectStart, startIndex)
  const b = weekEndIso(projectStart, Math.max(startIndex, endIndex))
  if (!a || !b) return null
  return `${a.slice(5)} ~ ${b.slice(5)}`
}

interface WeekSpan {
  startDate: string
  endDate: string
}

/**
 * 按**数值**周序号排序。
 *
 * 必须走这里而不是交给 Prisma 的 `orderBy: { startDate: 'asc' }`：
 * 周序号是字符串，"10" 会排在 "2" 前面，40 周甘特图的行序会错乱。
 * 非甘特数据（ISO 日期）排序结果与字符串排序一致，可安全用于混合列表。
 */
export function sortByWeekIndex<T extends WeekSpan>(list: readonly T[]): T[] {
  return list
    .map((item, index) => ({ item, index }))
    .sort((x, y) => {
      const sx = parseWeekIndex(x.item.startDate)
      const sy = parseWeekIndex(y.item.startDate)
      if (sx !== null && sy !== null && sx !== sy) return sx - sy
      if (sx !== null && sy !== null) {
        const ex = parseWeekIndex(x.item.endDate) ?? sx
        const ey = parseWeekIndex(y.item.endDate) ?? sy
        if (ex !== ey) return ex - ey
      } else if (sx !== null) {
        return -1
      } else if (sy !== null) {
        return 1
      } else if (x.item.startDate !== y.item.startDate) {
        return x.item.startDate < y.item.startDate ? -1 : 1
      }
      return x.index - y.index
    })
    .map((wrapped) => wrapped.item)
}

export interface PlanTaskInput {
  id?: string
  name: string
  hours: number
  priority: number
  done?: boolean
}

export interface PlanItem {
  id?: string
  name: string
  hours: number
  priority: number
}

export interface DayPlan {
  name: string
  /** 该日的可用工时 */
  capacity: number
  items: PlanItem[]
  remain: number
}

/** 尚未完成的任务总工时 */
export function remainingHours(tasks: readonly PlanTaskInput[]): number {
  return tasks.reduce((sum, t) => (t.done ? sum : sum + Number(t.hours || 0)), 0)
}

/**
 * 按优先级把未完成任务依次填满每天的可用工时（原 `research_planner.py` 的行为）。
 *
 * 从周一开始填，填满一天再填下一天；单个任务可跨天拆分，因此「每天塞了什么」
 * 是完全可推演的 —— 这也是它值得单测的原因。
 */
export function allocateWeeklyPlan(
  tasks: readonly PlanTaskInput[],
  dailyHours: readonly number[],
): DayPlan[] {
  const days: DayPlan[] = Array.from({ length: 7 }, (_, i) => ({
    name: DAY_NAMES[i],
    capacity: Number(dailyHours[i] ?? 0),
    items: [],
    remain: Number(dailyHours[i] ?? 0),
  }))

  const pending = tasks
    .filter((t) => !t.done && Number(t.hours) > 0)
    .map((t, index) => ({ task: t, index }))
    .sort((a, b) => {
      const pa = Number(a.task.priority) || 0
      const pb = Number(b.task.priority) || 0
      if (pa !== pb) return pb - pa
      return a.index - b.index
    })
    .map((wrapped) => wrapped.task)

  for (const task of pending) {
    let left = Number(task.hours) || 0
    for (let i = 0; i < days.length && left > 0; i++) {
      if (days[i].remain <= 0) continue
      const alloc = Math.min(left, days[i].remain)
      days[i].items.push({
        id: task.id,
        name: task.name,
        hours: alloc,
        priority: Number(task.priority) || 0,
      })
      days[i].remain -= alloc
      left -= alloc
    }
    // 排不下的部分直接丢弃（容量不足以完整容纳该任务），由 UI 用「超时」提示兜住
  }

  return days
}

/** 单个任务的小时上限，超过按脏数据截断 */
export const MAX_TASK_HOURS = 24

export interface WeeklyTaskInput {
  name: string
  hours: number
  priority: number
  done: boolean
  weekStart: string
  order: number
}

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  return Math.max(min, Math.min(max, n))
}

/**
 * 校验并归一化「新建周计划任务」的入参。
 * 名字为空/全是空格时返回 null（调用方回 400），其余字段越界一律截断而不是报错 ——
 * 用户填 12 小时不该被一个 500 挡住。
 */
export function normalizeTaskInput(raw: unknown, fallbackWeekStart: string): WeeklyTaskInput | null {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (!name) return null

  return {
    name,
    hours: clampNumber(input.hours, 0, MAX_TASK_HOURS, 2),
    priority: Math.round(clampNumber(input.priority, 1, 5, 3)),
    done: input.done === true,
    weekStart: ISO_DATE_RE.test(String(input.weekStart ?? '')) ? String(input.weekStart) : fallbackWeekStart,
    order: Math.trunc(clampNumber(input.order, 0, 100_000, 0)),
  }
}

/** 部分更新：只接受白名单字段，非法值直接丢弃（不产生 undefined 覆盖） */
export function normalizeTaskPatch(raw: unknown): Partial<WeeklyTaskInput> {
  const input = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const patch: Partial<WeeklyTaskInput> = {}

  if (typeof input.name === 'string' && input.name.trim()) patch.name = input.name.trim()
  if (input.hours !== undefined) patch.hours = clampNumber(input.hours, 0, MAX_TASK_HOURS, 2)
  if (input.priority !== undefined) patch.priority = Math.round(clampNumber(input.priority, 1, 5, 3))
  if (input.done !== undefined) patch.done = input.done === true
  if (input.weekStart !== undefined && ISO_DATE_RE.test(String(input.weekStart))) {
    patch.weekStart = String(input.weekStart)
  }
  if (input.order !== undefined) patch.order = Math.trunc(clampNumber(input.order, 0, 100_000, 0))

  return patch
}
