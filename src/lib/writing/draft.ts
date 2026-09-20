/**
 * 论文写作工作台 —— 纯逻辑层
 *
 * 这一层不碰 IO、不碰 React，全部是纯函数，因此可以被单测完整覆盖。
 * 它负责「写作闭环」里最容易出错的那一段：
 *
 *   正文里的 `[@paperId]` 标记  →  按首次出现顺序编号  →  参考文献表  →  导出稿
 *
 * 关键约束：**编号只由正文出现顺序决定**。用户删掉一段、调整章节顺序之后，
 * 编号必须自动重排，且参考文献表顺序与正文引用顺序一致 —— 这正是手写容易出错、
 * 又最容易在投稿时被审稿人抓到的地方。
 */

import {
  DEFAULT_CITATION_STYLE,
  formatReference,
  type CitationStyle,
} from './citation-styles'

/** 正文里的引用标记：`[@paperId]`，也容忍 `[@a, @b]` / `[@a; @b]` 这类写法 */
const CITATION_MARKER_RE = /\[@[^\]]+\]/g
const INLINE_MARKER_RE = /\[@[^\]]+\]/g

export interface DraftSection {
  id: string
  title: string
  /** 该章节目标字数，0 表示不设目标 */
  targetWords: number
  /** markdown 正文，用 [@paperId] 标记引用 */
  content: string
}

/** 从文献库取来的一条可被引用的记录（字段宽松，缺省即视为空） */
export interface ReferenceSource {
  id: string
  title: string
  authors?: string | null
  venue?: string | null
  year?: number | null
  doi?: string | null
}

export interface ResolvedReference {
  /** 正文中出现的序号，从 1 开始，按首次出现顺序 */
  number: number
  paperId: string
  /** 文献库里是否真的存在这一条 */
  found: boolean
  title: string
  authors: string
  venue: string
  year: number | null
  doi: string
}

export interface Progress {
  words: number
  target: number
  /** 0-100，未设目标时为 0 */
  percent: number
  remaining: number
}

let sectionSeq = 0

export function newSectionId(): string {
  sectionSeq += 1
  return `sec_${Date.now().toString(36)}${sectionSeq.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function newSection(title = '新章节', targetWords = 0): DraftSection {
  return { id: newSectionId(), title, targetWords, content: '' }
}

/** 新建稿件的默认章节结构（IEEE 会议/期刊论文的常见骨架） */
export function defaultOutline(): DraftSection[] {
  return [
    { title: 'Abstract', targetWords: 200 },
    { title: 'Introduction', targetWords: 800 },
    { title: 'Related Work', targetWords: 700 },
    { title: 'System Model', targetWords: 900 },
    { title: 'Method', targetWords: 1500 },
    { title: 'Experiments', targetWords: 1200 },
    { title: 'Conclusion', targetWords: 300 },
  ].map((s) => newSection(s.title, s.targetWords))
}

// ---------------- 字数统计 ----------------

/**
 * 计数前的清洗：代码块、行内代码、链接、引用标记、markdown 记号都不该计入字数。
 * 否则 `[@abc]` 会被当成一个英文单词，用户会发现"我没写字但字数涨了"。
 */
function stripForCounting(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!?\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(CITATION_MARKER_RE, ' ')
    .replace(/[#>*_~\-]+/g, ' ')
}

/**
 * 中英混排字数：中日韩字符**逐字**计数，拉丁/数字的词**按词**计数。
 * 这样"本文提出了 a novel method"= 8（5 个汉字 + 3 个词），与写作时的直觉一致。
 */
export function countWords(text: string | null | undefined): number {
  if (!text) return 0
  const cleaned = stripForCounting(text)
  const cjk = cleaned.match(/[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g)
  const latin = cleaned.match(/[A-Za-z0-9]+(?:[.'’-][A-Za-z0-9]+)*/g)
  return (cjk?.length ?? 0) + (latin?.length ?? 0)
}

// ---------------- 章节归一化 ----------------

/**
 * 把数据库里的 sections（JSON 字符串或已解析数组）归一化成 DraftSection[]。
 * 坏数据一律降级而不是抛错 —— 稿子打不开比字段脏更糟。
 */
export function normalizeSections(input: unknown): DraftSection[] {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return []
    }
  }
  if (!Array.isArray(raw)) return []

  const seen = new Set<string>()
  const out: DraftSection[] = []
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue
    const o = item as Record<string, unknown>
    let id = typeof o.id === 'string' && o.id.trim() ? o.id.trim() : newSectionId()
    while (seen.has(id)) id = newSectionId()
    seen.add(id)
    const target = Number(o.targetWords)
    out.push({
      id,
      title: typeof o.title === 'string' && o.title.trim() ? o.title.trim() : '未命名章节',
      targetWords: Number.isFinite(target) ? Math.max(0, Math.floor(target)) : 0,
      content: typeof o.content === 'string' ? o.content : '',
    })
  }
  return out
}

// ---------------- 引用解析 ----------------

/** 取出一个标记里的所有 paperId（`[@a, @b]` → ['a','b']） */
function idsInMarker(marker: string): string[] {
  const inner = marker.slice(2, -1) // 去掉 "[@" 与 "]"
  return inner
    .split(/[,;，；]/)
    // 先 trim 再剥 '@' —— 形如 " @p2" 的分段若先剥 '@' 会匹配不到（因为首字符是空格）
    .map((s) => s.trim().replace(/^@/, '').trim())
    .filter(Boolean)
}

/** 单段文本里的引用 id，按首次出现顺序去重 */
export function extractCitationIds(text: string | null | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const m of text.match(INLINE_MARKER_RE) ?? []) {
    for (const id of idsInMarker(m)) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/** 整篇稿件（按章节顺序）的引用 id，按首次出现顺序去重 */
export function collectCitationIds(sections: DraftSection[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const s of sections) {
    for (const id of extractCitationIds(s.content)) {
      if (seen.has(id)) continue
      seen.add(id)
      out.push(id)
    }
  }
  return out
}

/**
 * 生成编号参考文献表。顺序 = 正文首次出现顺序，编号 = 出现次序。
 * 文献库里不存在的 id 也会占一个编号并标记 found=false ——
 * 这样用户能一眼看出"哪个引用是坏的"，而不是被静默丢掉。
 */
export function buildReferences(
  citationIds: string[],
  sources: ReferenceSource[],
): ResolvedReference[] {
  const byId = new Map(sources.map((s) => [s.id, s]))
  return citationIds.map((paperId, i) => {
    const src = byId.get(paperId)
    if (!src) {
      return {
        number: i + 1,
        paperId,
        found: false,
        title: '',
        authors: '',
        venue: '',
        year: null,
        doi: '',
      }
    }
    return {
      number: i + 1,
      paperId,
      found: true,
      title: (src.title ?? '').trim(),
      authors: (src.authors ?? '').replace(/\s+/g, ' ').trim(),
      venue: (src.venue ?? '').trim(),
      year: typeof src.year === 'number' && Number.isFinite(src.year) ? src.year : null,
      doi: (src.doi ?? '').trim(),
    }
  })
}

/** 把正文里的 `[@paperId]` 替换成 `[n]`；解析不到的标记原样保留，便于用户发现 */
export function applyCitationNumbers(text: string | null | undefined, refs: ResolvedReference[]): string {
  if (!text) return ''
  const map = new Map(refs.map((r) => [r.paperId, r.number]))
  return text.replace(INLINE_MARKER_RE, (whole) => {
    const ids = idsInMarker(whole)
    const nums = ids.map((id) => map.get(id))
    if (!ids.length || nums.some((n) => n === undefined)) return whole
    return `[${nums.join(', ')}]`
  })
}

/**
 * 单条参考文献（IEEE 风格）。
 *
 * 真正的实现搬到了 `./citation-styles`（那边同时提供 GB/T 7714），
 * 这里保留同名导出以免破坏既有调用方与单测；新代码请直接用
 * `formatReference(ref, style)` 或 `referenceBody(ref, style)`。
 */
export function formatReferenceIEEE(ref: ResolvedReference): string {
  return formatReference(ref, 'ieee')
}

// ---------------- 进度 ----------------

export function totalWords(sections: DraftSection[]): number {
  return sections.reduce((n, s) => n + countWords(s.content), 0)
}

export function progressOf(words: number, targetWords: number): Progress {
  const target = Number.isFinite(targetWords) ? Math.max(0, Math.floor(targetWords)) : 0
  const percent = target > 0 ? Math.min(100, Math.round((words / target) * 100)) : 0
  return { words, target, percent, remaining: Math.max(0, target - words) }
}

export function writingProgress(sections: DraftSection[], targetWords: number): Progress {
  return progressOf(totalWords(sections), targetWords)
}

export function sectionProgress(section: DraftSection): Progress {
  return progressOf(countWords(section.content), section.targetWords)
}

// ---------------- 导出 ----------------

export interface ManuscriptDoc {
  title: string
  venue?: string
  sections: DraftSection[]
  references: ResolvedReference[]
  /**
   * 参考文献著录格式。缺省 IEEE —— 与加入本字段之前的导出结果完全一致，
   * 所以旧调用方（以及已导出的稿子）不会因为这次改动而变化。
   */
  style?: CitationStyle
}

/** 渲染整稿 markdown：章节标题 + 已编号正文 + 参考文献表 */
export function renderManuscriptMarkdown(doc: ManuscriptDoc): string {
  const style = doc.style ?? DEFAULT_CITATION_STYLE
  const lines: string[] = []
  lines.push(`# ${(doc.title || '').trim() || '未命名稿件'}`)
  if (doc.venue?.trim()) lines.push('', `> 目标：${doc.venue.trim()}`)

  for (const s of doc.sections) {
    lines.push('', `## ${s.title}`)
    const body = applyCitationNumbers(s.content, doc.references).trim()
    if (body) lines.push('', body)
  }

  if (doc.references.length) {
    lines.push('', '## 参考文献', '')
    for (const r of doc.references) lines.push(formatReference(r, style))
  }

  return `${lines.join('\n').trimEnd()}\n`
}

/**
 * 把导出用的 markdown 转成纯文本（txt 用）。
 * 只去掉结构记号，**不动正文内容** —— 引用编号 `[1]` 属于正文，必须保留。
 */
export function markdownToPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/^```[^\n]*\n?|```$/g, ''))
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/(^|[^*])\*([^*]+)\*/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd() + '\n'
}

/** Windows/macOS 都不接受的文件名字符，统一替换掉，避免导出时写盘失败 */
export function safeFileName(name: string, fallback = 'manuscript'): string {
  const cleaned = (name || '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .slice(0, 80)
  return cleaned || fallback
}
