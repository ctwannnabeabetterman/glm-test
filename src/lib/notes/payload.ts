/**
 * 笔记写入载荷的统一处理。
 *
 * 为什么单独抽一层：`POST /api/notes` 与 `PUT /api/notes/[id]` 必须对同一批字段
 * 用同一套转换（JSON 数组列、structured 字符串化、lastReadAt → Date）。
 * 两边各写一份的结果必然是「建的时候存成字符串、改的时候存成数组」这类漂移，
 * 而 SQLite 不会拦（TEXT 列什么都能塞），只会在读取端炸。
 *
 * 白名单的意义：原本 `PUT` 用的是 `{ ...body }` 直通，`id`/`createdAt`/`updatedAt`
 * 都能被前端覆盖且不报错 —— 与 v1.3.12 修掉的 `PUT /api/papers/[id]` 是同一个病。
 * 这里显式列举可写字段，其余**静默忽略**（不报错，避免前端多传一个字段就 500）。
 */

import { parseStringArray } from '@/lib/utils'

/** 允许写入 Note 的字段。`id`/`createdAt`/`updatedAt` 刻意不在其中。 */
export const NOTE_WRITABLE_FIELDS = [
  'title',
  'content',
  'tags',
  'links',
  'category',
  'structured',
  'topicIds',
  'paperIds',
  'lastReadAt',
] as const

export type NoteWritableField = (typeof NOTE_WRITABLE_FIELDS)[number]

/**
 * 把「JSON 数组列」的入参归一成落库用的字符串。
 *
 * 前端有时传数组（`['p1','p2']`）、有时传已序列化的字符串（`'["p1"]'`），
 * 两种都要接住；空串/null/undefined 一律回落默认值 ——
 * 否则 `''` 会让读取端的 `JSON.parse` 抛错（表现为「笔记列表整个打不开」）。
 */
export function toJsonArrayText(value: unknown, fallback = '[]'): string {
  if (value === undefined || value === null) return fallback
  if (Array.isArray(value)) return JSON.stringify(value)
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return fallback
    // 已经是合法 JSON 数组就原样保留（避免把 '[1,2]' 再包一层引号）
    try {
      return Array.isArray(JSON.parse(trimmed)) ? trimmed : fallback
    } catch {
      return fallback
    }
  }
  return fallback
}

/** structured 列：对象 → JSON 字符串；字符串原样保留（防止二次编码） */
export function toStructuredText(value: unknown, fallback = '{}'): string {
  if (value === undefined || value === null) return fallback
  if (typeof value === 'string') return value.trim() ? value : fallback
  if (typeof value === 'object') return JSON.stringify(value)
  return fallback
}

/** lastReadAt：真值 → Date；显式 null/空 → null（用于「取消最近阅读时间」） */
export function toLastReadAt(value: unknown): Date | null {
  if (!value) return null
  const d = new Date(value as string)
  return Number.isNaN(d.getTime()) ? null : d
}

/**
 * 从请求体里挑出可写字段并做类型转换。
 * 未出现在 body 里的字段**不会**出现在返回值里 —— 这样 Prisma 的 `update`
 * 才能区分「没传」与「传了空值」。
 */
export function pickWritableNote(body: Record<string, unknown>): Record<string, unknown> {
  const data: Record<string, unknown> = {}
  for (const field of NOTE_WRITABLE_FIELDS) {
    if (body[field] === undefined) continue
    switch (field) {
      case 'links':
      case 'topicIds':
      case 'paperIds':
        data[field] = toJsonArrayText(body[field])
        break
      case 'structured':
        data[field] = toStructuredText(body[field])
        break
      case 'lastReadAt':
        data[field] = toLastReadAt(body[field])
        break
      default:
        data[field] = body[field]
    }
  }
  return data
}

/**
 * 读取侧的对应实现：解析 `paperIds` JSON 数组。
 *
 * 与 `parseTopicIds`（`lib/methodology/topic-scope.ts`）**同源** ——
 * 两者都委托给 `lib/utils.ts` 的 `parseStringArray`，不再各写一份。
 * 容错策略：**坏数据一律当空数组**。一条脏记录不能让「笔记列表」或
 * 「论文详情的相关笔记」整个打不开；宁可少显示一条关联，也不能让页面白屏。
 */
export function parsePaperIds(raw: unknown): string[] {
  return parseStringArray(raw)
}
