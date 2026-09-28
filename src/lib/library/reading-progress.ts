/**
 * 「三遍阅读法」进度的解析 —— **唯一定义处**。
 *
 * 为什么值得单独一层（2026-09-28 收敛）：
 * 这个 JSON 此前有**两份**同形解析 —— 组件里的 `parseReadingProgress`
 * （阅读计时 / 进度条 / 自动改阅读状态用）与 `paper-notes.ts` 里的 `parseProgress`
 * （导出 Markdown 用）。两份实现必然漂移，典型后果是
 * 「界面上三遍都读完、导出的 Markdown 却少一段」—— 这类不一致极难被发现。
 * 本仓已为同类问题付过代价：阅读优先级公式曾有三份、阅读时长格式化现在仍有四份。
 *
 * ⚠️ 顺带修掉一个会**崩界面**的边角：旧实现直接把 `JSON.parse` 的结果当对象用。
 * 这一列是客户端写回来的字符串（`PUT /api/papers/[id]` 的白名单只校验它是字符串），
 * 所以 `"null"` 存得进来 —— 解析出 `null` 后取 `progress.pass1` 会抛 TypeError，
 * 把整个论文详情打崩。现在非「普通对象」一律按空进度处理。
 */

export interface ReadingProgress {
  pass1?: boolean
  pass2?: boolean
  pass3?: boolean
  pass1Notes?: string
  pass2Notes?: string
  pass3Notes?: string
}

/** 三遍的键名。新增第四遍时改这里一处，所有按遍处理的逻辑一起跟上。 */
export const PASS_KEYS = ['pass1', 'pass2', 'pass3'] as const
export type PassKey = (typeof PASS_KEYS)[number]

const NOTE_KEYS = ['pass1Notes', 'pass2Notes', 'pass3Notes'] as const

/**
 * 解析存储里的 `readingProgress`（JSON 字符串）。
 *
 * 脏数据一律兜住并**归一化**：只保留认识的键、只保留正确的类型，
 * 未知键与非布尔/非字符串值直接丢掉（存着也没人读，留着只会让下游各自判一次）。
 */
export function parseReadingProgress(raw: unknown): ReadingProgress {
  if (typeof raw !== 'string' || !raw.trim()) return {}

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return {}
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}

  const src = parsed as Record<string, unknown>
  const out: ReadingProgress = {}
  for (const key of PASS_KEYS) {
    if (typeof src[key] === 'boolean') out[key] = src[key] as boolean
  }
  for (const key of NOTE_KEYS) {
    const value = src[key]
    if (typeof value === 'string' && value) out[key] = value
  }
  return out
}

/** 已完成的遍数（0-3）—— 「1/3 完成」这类显示统一走它，别各处再 filter 一遍 */
export function passesDone(progress: ReadingProgress): number {
  return PASS_KEYS.filter((key) => progress[key] === true).length
}

/** 某一遍是否「有内容」：勾了完成，或写了笔记（导出 Markdown 用它决定是否输出该段） */
export function hasPassContent(progress: ReadingProgress, pass: PassKey): boolean {
  return progress[pass] === true || Boolean(progress[`${pass}Notes`])
}

/** 某一遍的笔记正文（没有则空串），避免各处再拼 `pass1Notes` 这类键名 */
export function passNotes(progress: ReadingProgress, pass: PassKey): string {
  return progress[`${pass}Notes`] ?? ''
}
