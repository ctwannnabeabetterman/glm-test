import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * 解析「JSON 字符串数组」形态的列（`topicIds` / `paperIds` / `links` …）。
 *
 * 为什么收敛到一处：项目里有多个同形字段都是「JSON 数组存成 TEXT 列」，
 * 读取侧原先各写了一份逐字节等价的实现（`topic-scope.ts` 的 `parseTopicIds`
 * 与 `notes/payload.ts` 的 `parsePaperIds`）。同一套容错规则复制多份的结果，
 * 是某天只改了其中一份 —— 而这类字段一旦解析姿势不一致，表现是**某个模块**
 * 悄悄少显示几条关联，不会有任何报错。
 *
 * 容错策略：**坏数据一律当空数组**。一条脏记录不能让整个列表打不开；
 * 宁可少显示一条关联，也不能白屏。
 */
export function parseStringArray(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === 'string')
  if (typeof raw !== 'string' || !raw.trim()) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}
