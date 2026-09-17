/**
 * 日历集成（D5）的纯逻辑：把研究规划变成「能导进手机日历的事件」。
 *
 * 为什么选 ICS 而不是接某个日历 API：ICS 是 RFC 5545 定义的纯文本格式，
 * Google 日历 / Apple 日历 / Outlook 都能导入，**不需要任何账号、OAuth、网络请求**，
 * 而且导出结果是一个字符串 —— 意味着它能被单测逐字符锁住。
 *
 * ICS 的坑几乎全在细节上（换行必须是 CRLF、75 octet 处要折行且不能切断 UTF-8 字符、
 * 全天事件的 DTEND 是**排他**的），所以这里每个细节都单独成函数。
 */

import { plannedEndIso, plannedStartIso, type MilestoneLike } from './linkage'
import { addDaysIso, isoToMs } from './schedule'

// ============ 事件 ============

export type CalendarEventKind = 'milestone' | 'task'

export interface CalendarEvent {
  /** 稳定唯一 id，用于生成 UID（重复导入日历时靠它去重/更新） */
  id: string
  title: string
  kind: CalendarEventKind
  /** 里程碑原始类型：gantt / writing / submission */
  type: string
  /** 开始日（含）YYYY-MM-DD */
  startDate: string
  /** 结束日（**含**，展示语义）YYYY-MM-DD */
  endDate: string
  progress: number
  done: boolean
  /** DESCRIPTION 的内容 */
  note: string
}

export interface TaskLike {
  id: string
  name: string
  hours: number
  priority: number
  done: boolean
  weekStart: string
}

export interface BuildCalendarInput {
  milestones: readonly MilestoneLike[]
  tasks: readonly TaskLike[]
  /** 项目起始日（空串 = 未设置，甘特里程碑无法换算日期则跳过） */
  projectStart: string
}

/**
 * 把里程碑与周计划任务折算成日历事件。
 *
 * 取不到日期的条目**直接跳过**，不猜：宁可日历里少一条，
 * 也不要把「第 12 周」这种残缺信息塞成一个错误的日期。
 */
export function buildCalendarEvents(input: BuildCalendarInput): CalendarEvent[] {
  const events: CalendarEvent[] = []

  for (const m of input.milestones) {
    const start = plannedStartIso(m, input.projectStart)
    const end = plannedEndIso(m, input.projectStart)
    // 只有一端能算出来时按「单日事件」处理（例如只填了开始日的写作里程碑）
    const startDate = start ?? end
    const endDate = end ?? start
    if (!startDate || !endDate || endDate < startDate) continue

    const done = m.progress >= 100
    const parts = [`进度 ${m.progress}%`]
    if (done && m.actualEndDate) parts.push(`实际完成于 ${m.actualEndDate}`)

    events.push({
      id: `milestone-${m.id}`,
      title: done ? `[已完成] ${m.title}` : m.title,
      kind: 'milestone',
      type: m.type,
      startDate,
      endDate,
      progress: m.progress,
      done,
      note: parts.join(' · '),
    })
  }

  for (const t of input.tasks) {
    const endDate = addDaysIso(t.weekStart, 6)
    if (!endDate) continue
    events.push({
      id: `task-${t.id}`,
      title: t.done ? `[已完成] ${t.name}` : t.name,
      kind: 'task',
      type: 'weekly',
      startDate: t.weekStart,
      endDate,
      progress: t.done ? 100 : 0,
      done: t.done,
      note: `${t.hours} 小时 · 优先级 ${t.priority}`,
    })
  }

  return events
}

/** 事件覆盖的每一天（含首尾） */
export function expandEventIsoDates(event: CalendarEvent): string[] {
  const dates: string[] = []
  let cursor: string | null = event.startDate
  // 上限防御：脏数据（end 比 start 早很多）不至于把循环挂死
  for (let guard = 0; guard < 400 && cursor && cursor <= event.endDate; guard++) {
    dates.push(cursor)
    cursor = addDaysIso(cursor, 1)
  }
  return dates
}

/** 按日期归档，供月历视图查「这一天有什么」 */
export function eventsByDate(events: readonly CalendarEvent[]): Map<string, CalendarEvent[]> {
  const map = new Map<string, CalendarEvent[]>()
  for (const event of events) {
    for (const iso of expandEventIsoDates(event)) {
      const list = map.get(iso)
      if (list) list.push(event)
      else map.set(iso, [event])
    }
  }
  return map
}

// ============ 月历网格 ============

export interface MonthCell {
  iso: string
  /** 是否属于本月（前后补位的日子为 false） */
  inMonth: boolean
}

const WEEKDAY_LABELS = ['一', '二', '三', '四', '五', '六', '日'] as const
export const WEEKDAY_HEADERS: readonly string[] = WEEKDAY_LABELS

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 生成 6×7 的月历网格。
 * **以周一为一周之始**，与 `startOfWeekIso` 的周计划口径保持一致 ——
 * 两处周界不一致会让「本周任务」和「日历上这一行」对不上。
 */
export function monthMatrix(year: number, month: number): MonthCell[][] {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return []
  const firstMs = isoToMs(`${year}-${pad2(month)}-01`)
  if (firstMs === null) return []

  const dow = new Date(firstMs).getUTCDay() // 0 = 周日
  const offset = (dow === 0 ? 7 : dow) - 1
  const gridStartMs = firstMs - offset * 86_400_000

  const rows: MonthCell[][] = []
  for (let row = 0; row < 6; row++) {
    const cells: MonthCell[] = []
    for (let col = 0; col < 7; col++) {
      const d = new Date(gridStartMs + (row * 7 + col) * 86_400_000)
      cells.push({
        iso: `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`,
        inMonth: d.getUTCMonth() + 1 === month,
      })
    }
    rows.push(cells)
  }
  return rows
}

// ============ ICS 序列化 ============

/** RFC 5545 规定一行不超过 75 octets（**字节**，不是字符） */
export const ICS_MAX_OCTETS = 75

/** 单个码点的 UTF-8 字节数 */
function utf8Bytes(codePoint: number): number {
  if (codePoint < 0x80) return 1
  if (codePoint < 0x800) return 2
  if (codePoint < 0x10000) return 3
  return 4
}

/**
 * TEXT 值的转义。顺序重要：**必须先转义反斜杠**，
 * 否则后面为 `;` / `,` 补上的反斜杠会被再转一遍。
 */
export function escapeIcsText(text: unknown): string {
  return String(text ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n')
}

/**
 * 按 75 octets 折行。续行以单个空格开头，且该空格**占掉续行 1 个 octet 的额度**。
 * 中文一个字 3 字节，所以「按字符数折」会在中文标题上直接违反 RFC —— 必须按字节算。
 */
export function foldIcsLine(line: string, limit: number = ICS_MAX_OCTETS): string {
  if (!line) return ''
  const chunks: string[] = []
  let current = ''
  let bytes = 0

  for (const ch of line) {
    const size = utf8Bytes(ch.codePointAt(0) as number)
    // 首个物理行可用满 limit；续行要留 1 个给前导空格
    const capacity = chunks.length === 0 ? limit : limit - 1
    if (bytes + size > capacity) {
      chunks.push(current)
      current = ch
      bytes = size
    } else {
      current += ch
      bytes += size
    }
  }
  if (current) chunks.push(current)

  return chunks.map((chunk, index) => (index === 0 ? chunk : ` ${chunk}`)).join('\r\n')
}

/** YYYY-MM-DD → 20260914；非法/不存在的日期返回 null */
export function toIcsDate(iso: string): string | null {
  if (isoToMs(iso) === null) return null
  return iso.replace(/-/g, '')
}

/** Date → 20260916T153000Z（DTSTAMP 必须是 UTC） */
export function toIcsStamp(date: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return (
    `${date.getUTCFullYear()}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}` +
    `T${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`
  )
}

export interface IcsMeta {
  /** 日历显示名，例如「AI Network Lab · 研究规划」 */
  calendarName: string
  /** 生成时间（DTSTAMP） */
  generatedAt: Date
  /** 事件是否附带「结束前 1 天」提醒 */
  withAlarm?: boolean
}

/**
 * 生成整份 ICS。
 *
 * 几个必须照做的点：
 *  - **换行一律 CRLF**（RFC 5545 §3.1），只写 \n 会被部分客户端判为非法；
 *  - 全天事件用 `DTSTART;VALUE=DATE`，且 **`DTEND` 是排他的** ——
 *    区间要写成「结束日 + 1 天」，否则最后一天会丢失；
 *  - `UID` 由稳定 id 派生（不是随机数），这样重复导入时是**更新**而不是堆一堆重复项；
 *  - 提醒用 `TRIGGER;RELATED=END:-P1D`（结束前 1 天），而不是默认的「开始前 1 天」——
 *    对里程碑来说，「截止前一天」才是有用的提醒。
 */
export function renderIcs(events: readonly CalendarEvent[], meta: IcsMeta): string {
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI Network Lab//Research Planner//CN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${escapeIcsText(meta.calendarName)}`,
  ]

  const stamp = toIcsStamp(meta.generatedAt)
  const withAlarm = meta.withAlarm !== false

  for (const event of events) {
    const start = toIcsDate(event.startDate)
    const endExclusive = addDaysIso(event.endDate, 1)
    const dtEnd = endExclusive ? toIcsDate(endExclusive) : null
    if (!start || !dtEnd) continue

    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@ai-network-lab`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${start}`,
      `DTEND;VALUE=DATE:${dtEnd}`,
      `SUMMARY:${escapeIcsText(event.title)}`,
      `DESCRIPTION:${escapeIcsText(event.note)}`,
      `CATEGORIES:${escapeIcsText(event.kind === 'task' ? '研究周计划' : '研究里程碑')}`,
      'STATUS:CONFIRMED',
      // 全天事件不占用档期，避免把一整周显示成「忙碌」
      'TRANSP:TRANSPARENT',
    )

    if (withAlarm && !event.done) {
      lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `DESCRIPTION:${escapeIcsText(`即将到期：${event.title}`)}`,
        // RELATED=END：相对结束时间。全天事件的结束时刻是 DTEND（排他）的 00:00，
        // 往前 1 天即「最后一天的前一天」——正是我们想要的「截止前提醒」。
        'TRIGGER;RELATED=END:-P1D',
        'END:VALARM',
      )
    }

    lines.push('END:VEVENT')
  }

  lines.push('END:VCALENDAR')

  // 每一行都折行后，用 CRLF 连接，并以 CRLF 收尾
  return lines.map((line) => foldIcsLine(line)).join('\r\n') + '\r\n'
}

/** 给下载用的文件名：研究规划日历-YYYY-MM-DD.ics */
export function icsFilename(generatedAt: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `研究规划日历-${generatedAt.getFullYear()}-${p(generatedAt.getMonth() + 1)}-${p(generatedAt.getDate())}.ics`
}
