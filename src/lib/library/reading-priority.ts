/**
 * 阅读优先级的纯函数层 —— 「论文库排序」的唯一权威定义。
 *
 * 背景（2026-09-21 用户指示）：「论文库的优先级排序和引用追踪也是 AI 基于论文信息整合的」。
 * 查下来现状是：**排序是一套固定公式**（相关度/新颖度/开源代码/年份/优先级五个分量加权），
 * 而公式在 UI 里被**复制了三份**（排序比较器两处 + 行内渲染一处）——
 * 改一处忘一处就会「显示的分数和排序依据不一致」，这类不一致还特别难被发现。
 * 所以第一步是把公式收敛到这里，第二步才是让 AI 去填那三个输入值。
 *
 * 本层的三块职责：
 *  1. **打分与排序**（`readingPriorityScore` / `rankByPriority`）—— 与旧实现**逐字节等价**，
 *     刻意不改语义：改公式会静默重排用户已经熟悉的那张榜。
 *  2. **AI 建议的解析与收敛**（`parseScoreSuggestions`）—— 模型输出不可信：
 *     可能带 id 之外的条目、可能给出越界数值与非法优先级。这里是唯一的收口处。
 *  3. **来源标记**（`markScored` / `clearScored`）—— 「这条分数是 AI 给的，还是我自己填的」。
 *     刻意**不加数据库列**（那要做迁移、要动模板库），而是存成一条 `Setting` 的 JSON 映射；
 *     用户手工改过某篇的分数时，那一条标记会被清掉。
 */

export type PaperPriority = 'high' | 'medium' | 'low'

/** 优先级 → 权重（与 `reading_priority.py` 的口径一致） */
export const PRIORITY_RANK: Record<PaperPriority, number> = { high: 3, medium: 2, low: 1 }

export const PRIORITY_LABEL: Record<PaperPriority, string> = {
  high: '高',
  medium: '中',
  low: '低',
}

/**
 * 不用 `PRIORITY_VALUES.includes(x)` 做判定。
 *
 * 除了「字面量数组上的 includes 会因类型收窄与 TS 版本打架」（2026-09-20 被 CI 拦过一次），
 * 显式的类型守卫在这里也更准确：它同时承担「类型收窄」与「运行时校验」两件事。
 */
export function isPriority(v: unknown): v is PaperPriority {
  return v === 'high' || v === 'medium' || v === 'low'
}

export function normalizePriority(v: unknown): PaperPriority {
  if (typeof v !== 'string') return 'medium'
  const s = v.trim().toLowerCase()
  if (isPriority(s)) return s
  // 模型常见的几种「近义写法」也收下来，避免整条建议因为一个词被丢掉
  if (s === '高' || s === 'high priority' || s === 'top') return 'high'
  if (s === '低' || s === 'low priority') return 'low'
  return 'medium'
}

/** 相关度 / 新颖度都按 1-10 的整数收；越界一律夹紧，而不是丢弃整条建议 */
export function normalizeScore(v: unknown, fallback = 5): number {
  // ⚠️ 必须先挡掉 null / '' —— `Number(null) === 0`、`Number('') === 0`，
  // 走后面的夹紧会被压成 1（「缺失」被读成「最低分」）。缺失就该回落 fallback。
  if (v === null || v === undefined || v === '') return fallback
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return fallback
  return Math.min(10, Math.max(1, Math.round(n)))
}

// ---------------- 打分与排序 ----------------

export interface ScorablePaper {
  id: string
  title: string
  year: number
  codeUrl?: string | null
  relevance: number
  novelty: number
  priority: string
}

export interface ScoreParts {
  /** 相关度 × 0.4 */
  relevance: number
  /** 新颖度 × 0.3 */
  novelty: number
  /** 有开源代码 +15，否则 0 */
  code: number
  /**
   * 年份项 = `min(年份 - 2019, 5) × 0.5`。
   *
   * ⚠️ 2019 年之前的论文这一项是**负数**（越老越低），而界面上写的是「年份加成」。
   * 这是既有行为，**本轮刻意保持不变** —— 改它等于静默重排用户已经熟悉的那张榜；
   * 这里把它显式算出来并在 `describeScoreParts` 里如实呈现，让「加成」这个词不再骗人。
   */
  year: number
  /** 优先级权重 × 2（high=3 / medium=2 / low=1） */
  priority: number
}

export function scoreParts(
  p: Pick<ScorablePaper, 'relevance' | 'novelty' | 'codeUrl' | 'year' | 'priority'>,
): ScoreParts {
  const rel = Number.isFinite(p.relevance) ? p.relevance : 0
  const nov = Number.isFinite(p.novelty) ? p.novelty : 0
  const prio = isPriority(p.priority) ? PRIORITY_RANK[p.priority] : PRIORITY_RANK.medium
  const year = Number.isFinite(p.year) ? p.year : 0
  return {
    relevance: rel * 0.4,
    novelty: nov * 0.3,
    code: p.codeUrl ? 15 : 0,
    year: Math.min(year - 2019, 5) * 0.5,
    priority: prio * 2,
  }
}

export function readingPriorityScore(
  p: Pick<ScorablePaper, 'relevance' | 'novelty' | 'codeUrl' | 'year' | 'priority'>,
): number {
  const s = scoreParts(p)
  return s.relevance + s.novelty + s.code + s.year + s.priority
}

/** 分数构成的可读拆解（给界面悬停提示用，避免公式再次被抄成字符串） */
export function describeScoreParts(
  p: Pick<ScorablePaper, 'relevance' | 'novelty' | 'codeUrl' | 'year' | 'priority'>,
): string {
  const s = scoreParts(p)
  const prio = isPriority(p.priority) ? p.priority : 'medium'
  return [
    `相关度 ${p.relevance} × 0.4 = ${s.relevance.toFixed(1)}`,
    `新颖度 ${p.novelty} × 0.3 = ${s.novelty.toFixed(1)}`,
    `开源代码 ${p.codeUrl ? '+15' : '+0'} = ${s.code.toFixed(1)}`,
    `年份 ${p.year} ${s.year < 0 ? '（早于 2019，为负）' : ''} = ${s.year.toFixed(1)}`,
    `优先级 ${PRIORITY_LABEL[prio]} × 2 = ${s.priority.toFixed(1)}`,
    `合计 ${readingPriorityScore(p).toFixed(1)}`,
  ].join('\n')
}

/**
 * 按阅读优先级排序。
 *
 * 稳定性要求：同分时按**年份降序**、再按标题升序 —— 旧实现用的是 `Array.sort` 的比较器，
 * 同分时依赖引擎的排序行为（V8 如今是稳定排序，但输入顺序一变结果就变）。
 * 这里把并列规则写死，保证「同一份数据两次排序结果相同」。
 */
export function rankByPriority<T extends ScorablePaper>(list: readonly T[]): T[] {
  return [...list].sort((a, b) => {
    const diff = readingPriorityScore(b) - readingPriorityScore(a)
    if (diff !== 0) return diff
    const ya = Number.isFinite(a.year) ? a.year : 0
    const yb = Number.isFinite(b.year) ? b.year : 0
    if (ya !== yb) return yb - ya
    return String(a.title).localeCompare(String(b.title))
  })
}

// ---------------- AI 建议的解析与校验 ----------------

export interface ScoreSuggestion {
  id: string
  relevance: number
  novelty: number
  priority: PaperPriority
  reason: string
}

export interface ParsedSuggestions {
  suggestions: ScoreSuggestion[]
  /** 模型写了、但不在本次清单里的 id（编造/串号）—— 必须回报，不能静默丢弃 */
  unknownIds: string[]
  /** 格式坏掉、被跳过的条目数 */
  malformed: number
}

const REASON_MAX = 120

/** 从模型回复里抠出 JSON：容忍 ```json 围栏与前后客套话 */
export function extractJsonBlock(text: string): unknown {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const body = fenced ? fenced[1] : text
  const start = body.search(/[[{]/)
  if (start < 0) return null
  const open = body[start]
  const close = open === '[' ? ']' : '}'
  const end = body.lastIndexOf(close)
  if (end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

/** 从任意形状里取出条目数组：接受裸数组，也接受 `{scores|items|results: [...]}` */
function toEntryList(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  if (parsed && typeof parsed === 'object') {
    const o = parsed as Record<string, unknown>
    for (const key of ['scores', 'items', 'results', 'data', 'papers']) {
      if (Array.isArray(o[key])) return o[key] as unknown[]
    }
  }
  return []
}

/**
 * 解析并收敛 AI 打分。
 *
 * @param text      模型回复原文
 * @param knownIds  本次送进去的论文 id 清单 —— **唯一合法的取值域**
 *
 * 三条硬规矩（都对应过一次真实踩坑）：
 *  - 不在清单里的 id 一律**不采纳**，但原样报出来（`unknownIds`）让人看见；
 *  - 数值/枚举全部收敛（夹紧 1-10、优先级归一），不让脏值写进库；
 *  - 同一个 id 出现多次时**只取第一条**（后一条往往是模型自己纠错前的旧值）。
 */
export function parseScoreSuggestions(
  text: string,
  knownIds: readonly string[],
): ParsedSuggestions {
  const known = new Set(knownIds)
  const parsed = extractJsonBlock(text)
  const list = toEntryList(parsed)
  const out: ScoreSuggestion[] = []
  const unknownIds: string[] = []
  const seen = new Set<string>()
  let malformed = 0

  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      malformed += 1
      continue
    }
    const o = entry as Record<string, unknown>
    const id = typeof o.id === 'string' ? o.id.trim() : ''
    if (!id) {
      malformed += 1
      continue
    }
    if (!known.has(id)) {
      if (!unknownIds.includes(id)) unknownIds.push(id)
      continue
    }
    if (seen.has(id)) continue
    seen.add(id)
    out.push({
      id,
      relevance: normalizeScore(o.relevance ?? o.relevance_score),
      novelty: normalizeScore(o.novelty ?? o.novelty_score),
      priority: normalizePriority(o.priority),
      reason: typeof o.reason === 'string' ? o.reason.replace(/\s+/g, ' ').trim().slice(0, REASON_MAX) : '',
    })
  }
  return { suggestions: out, unknownIds, malformed }
}

/** 某条建议实际改动了什么（若什么都没改，界面上不必给出「应用」按钮） */
export interface SuggestionDiff {
  id: string
  changed: boolean
  /** 形如 `相关度 5→9`，给界面直接显示 */
  changes: string[]
  /** 排序分数会不会变（权重后） */
  scoreDelta: number
}

export function diffSuggestion(
  before: Pick<ScorablePaper, 'id' | 'relevance' | 'novelty' | 'priority' | 'codeUrl' | 'year'>,
  after: ScoreSuggestion,
): SuggestionDiff {
  const changes: string[] = []
  if (before.relevance !== after.relevance) changes.push(`相关度 ${before.relevance}→${after.relevance}`)
  if (before.novelty !== after.novelty) changes.push(`新颖度 ${before.novelty}→${after.novelty}`)
  if (before.priority !== after.priority) {
    const b = isPriority(before.priority) ? PRIORITY_LABEL[before.priority] : before.priority
    changes.push(`优先级 ${b}→${PRIORITY_LABEL[after.priority]}`)
  }
  const scoreDelta =
    readingPriorityScore({ ...before, relevance: after.relevance, novelty: after.novelty, priority: after.priority }) -
    readingPriorityScore(before)
  return { id: before.id, changed: changes.length > 0, changes, scoreDelta }
}

// ---------------- 来源标记（AI 给的 / 人给的）----------------

/** Setting 表的键名（不加数据库列，见文件头注释） */
export const SCORE_PROVENANCE_KEY = 'papers.ai-scored'

export interface ScoreProvenance {
  /** ISO 时间串 */
  at: string
  /** 备注（现在是留空；留给将来区分「AI 打分」与「批量导入」等来源） */
  note?: string
}

export type ProvenanceMap = Record<string, ScoreProvenance>

/** 坏数据一律当空映射（一条脏记录不该让整个论文库页打不开） */
export function parseProvenance(raw: unknown): ProvenanceMap {
  let obj: unknown = raw
  if (typeof raw === 'string') {
    if (!raw.trim()) return {}
    try {
      obj = JSON.parse(raw)
    } catch {
      return {}
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return {}
  const out: ProvenanceMap = {}
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (!k) continue
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>
      const at = typeof o.at === 'string' ? o.at : ''
      const note = typeof o.note === 'string' ? o.note : undefined
      out[k] = note ? { at, note } : { at }
    } else if (typeof v === 'string') {
      // 容忍早期/手写形态：直接把值当时间串
      out[k] = { at: v }
    }
  }
  return out
}

export function markScored(prev: ProvenanceMap, ids: readonly string[], at: string): ProvenanceMap {
  const next: ProvenanceMap = { ...prev }
  for (const id of ids) {
    if (id) next[id] = { at }
  }
  return next
}

/** 人工改过分数之后要把标记摘掉 —— 否则界面上会一直谎称「这是 AI 打的分」 */
export function clearScored(prev: ProvenanceMap, ids: readonly string[]): ProvenanceMap {
  const next: ProvenanceMap = { ...prev }
  for (const id of ids) delete next[id]
  return next
}

export function markScoredJson(prev: ProvenanceMap, ids: readonly string[], at: string): string {
  return JSON.stringify(markScored(prev, ids, at))
}
