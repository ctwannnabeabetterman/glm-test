/**
 * 文献导入解析 —— RIS / EndNote / BibTeX。
 * 纯函数，不调 LLM：导入后只写入论文列表字段，关系网络按标签/作者/分类自动刷新。
 */

export interface BibliographyRecord {
  title: string
  authors: string
  venue: string
  year: number
  doi: string
  tags: string
  /** 用户自己的附注（RIS-N1 / BibTeX note）—— 不要拿摘要来填这里 */
  notes: string
  /** 摘要正文（RIS-AB / BibTeX abstract / Zotero abstractNote）—— AI 摘要的原料 */
  abstract: string
  url: string
  zoteroKey: string
}

const EMPTY: BibliographyRecord = {
  title: '',
  authors: '',
  venue: '',
  year: 0,
  doi: '',
  tags: '',
  notes: '',
  abstract: '',
  url: '',
  zoteroKey: '',
}

function clean(s: string): string {
  return s.replace(/\s+/g, ' ').trim()
}

function yearFrom(text: string): number {
  const m = text.match(/(19|20)\d{2}/)
  return m ? Number(m[0]) : 0
}

function joinAuthors(authors: string[]): string {
  return authors.map((a) => clean(a)).filter(Boolean).join(', ')
}

function joinTags(tags: string[]): string {
  const seen = new Set<string>()
  const out: string[] = []
  for (const t of tags) {
    const v = clean(t)
    if (!v) continue
    const key = v.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(v)
  }
  return out.join(', ')
}

/** 解析 RIS / EndNote 导出（TY/TI/AU/PY/JO/T2/DO/KW/N1/UR） */
export function parseRis(text: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = []
  let cur: BibliographyRecord | null = null
  const authors: string[] = []
  const tags: string[] = []

  const flush = () => {
    if (!cur) return
    cur.authors = joinAuthors(authors)
    cur.tags = joinTags(tags)
    if (cur.title) records.push({ ...cur })
    cur = null
    authors.length = 0
    tags.length = 0
  }

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\uFEFF/g, '')
    const m = line.match(/^([A-Z][A-Z0-9])  - (.*)$/)
    if (!m) {
      if (cur && line.trim() && !line.startsWith('ER')) {
        cur.notes = cur.notes ? `${cur.notes}\n${line}` : line
      }
      continue
    }
    const [, tag, value] = m
    if (tag === 'TY') {
      flush()
      cur = { ...EMPTY }
      continue
    }
    if (!cur) cur = { ...EMPTY }
    if (tag === 'ER') {
      flush()
      continue
    }
    switch (tag) {
      case 'TI':
      case 'T1':
        cur.title = clean(value)
        break
      case 'AU':
      case 'A1':
        authors.push(value)
        break
      case 'PY':
      case 'Y1':
        cur.year = yearFrom(value) || cur.year
        break
      case 'JO':
      case 'T2':
      case 'JF':
      case 'BT':
        if (!cur.venue) cur.venue = clean(value)
        break
      case 'DO':
        cur.doi = clean(value)
        break
      case 'KW':
        tags.push(value)
        break
      case 'N1':
        // N1 是「研究笔记/附注」，AB 才是摘要 —— 两者别混
        cur.notes = cur.notes ? `${cur.notes}\n${value}` : value
        break
      case 'AB':
        cur.abstract = cur.abstract ? `${cur.abstract}\n${value}` : value
        break
      case 'UR':
      case 'L1':
        if (!cur.url) cur.url = clean(value)
        break
      case 'ID':
        if (!cur.zoteroKey) cur.zoteroKey = clean(value)
        break
    }
  }
  flush()
  return records
}

function unbrace(s: string): string {
  return clean(s.replace(/[{}]/g, '').replace(/\\&/g, '&'))
}

/**
 * 读取 BibTeX 条目里某个字段的值。
 *
 * 旧实现是 ``new RegExp(`${name}\\s*=\\s*[{"]...`)``，有两个缺陷：
 *  1. 值用非贪婪 `[\s\S]*?` 匹配到**第一个** `}`/`"` 就结束 —— 而 Zotero /
 *     BetterBibTeX 导出会用嵌套花括号保护大小写（`title = {The {IEEE} Standard}`），
 *     于是标题被截断成 `The IEEE` 之后的内容全部丢失。
 *  2. 字段名没有左边界 —— `title` 会匹配到 `subtitle = ...` 里的 `title`。
 * 这里改为：字段名要求前置边界（行首 / 空白 / 逗号 / `{`），值按花括号配平或引号配对取值。
 */
function readBibtexField(chunk: string, name: string): string {
  const re = new RegExp(`(^|[\\s,{])${name}\\s*=\\s*`, 'i')
  const m = re.exec(chunk)
  if (!m) return ''
  let i = m.index + m[0].length
  while (i < chunk.length && /\s/.test(chunk[i])) i++
  const first = chunk[i]

  if (first === '{') {
    const start = i
    let depth = 0
    let inQuoted = false
    for (; i < chunk.length; i++) {
      const c = chunk[i]
      if (c === '\\') {
        i++
        continue
      }
      if (c === '"') {
        inQuoted = !inQuoted
        continue
      }
      if (inQuoted) continue
      if (c === '{') {
        depth++
      } else if (c === '}') {
        depth--
        if (depth === 0) {
          i++
          break
        }
      }
    }
    return unbrace(chunk.slice(start + 1, Math.max(start + 1, i - 1)))
  }

  if (first === '"') {
    const start = i
    i++
    for (; i < chunk.length; i++) {
      if (chunk[i] === '\\') {
        i++
        continue
      }
      if (chunk[i] === '"') break
    }
    return unbrace(chunk.slice(start + 1, i))
  }

  // 裸值：数字或宏（如 year = 2024 / year = pubyear）
  const start = i
  while (i < chunk.length && !/[,}\n]/.test(chunk[i])) i++
  return unbrace(chunk.slice(start, i))
}

/**
 * 按花括号配平切分 BibTeX 条目。
 *
 * 旧实现用 `/@\w+\s*\{[\s\S]*?\n\}/g` —— 要求闭合 `}` 紧跟换行，于是
 * 「单行紧凑写法」`@article{k, title={T}, year={2026}}` 一条都匹配不到，
 * 用户粘贴这类内容会被误判为「未解析到文献条目」。
 *
 * 也不能简单把 `\n\}` 改成 `\}`：字段值本身就含嵌套花括号
 * （如 `title={A {B} C}`），非贪婪匹配会在值内的闭合处提前截断。
 * 因此改为配平扫描：自 `@type{` 起累计大括号深度，深度归零处即条目结尾。
 */
function splitBibtexEntries(text: string): string[] {
  const out: string[] = []
  const starter = /@\w+\s*\{/g
  let m: RegExpExecArray | null
  while ((m = starter.exec(text)) !== null) {
    const open = m.index + m[0].length - 1 // 指向 '@type{' 里的 '{'
    let depth = 0
    let inQuoted = false
    let end = -1
    for (let i = open; i < text.length; i++) {
      const ch = text[i]
      if (ch === '\\') {
        i++ // 跳过 \{ \} 之类的转义
        continue
      }
      if (ch === '"') {
        inQuoted = !inQuoted
        continue
      }
      if (inQuoted) continue
      if (ch === '{') {
        depth++
      } else if (ch === '}') {
        depth--
        if (depth === 0) {
          end = i
          break
        }
      }
    }
    if (end === -1) break // 括号不配平：放弃后续解析，避免产出半截条目
    out.push(text.slice(m.index, end + 1))
    starter.lastIndex = end + 1
  }
  return out
}

/** 解析精简 BibTeX（@article/@inproceedings 等常见字段；多行与单行写法均支持） */
export function parseBibtex(text: string): BibliographyRecord[] {
  const records: BibliographyRecord[] = []
  const chunks = splitBibtexEntries(text)
  for (const chunk of chunks) {
    const rec: BibliographyRecord = { ...EMPTY }
    const field = (name: string) => readBibtexField(chunk, name)
    rec.title = field('title')
    rec.authors = field('author').replace(/\s+and\s+/gi, ', ')
    rec.venue = field('journal') || field('booktitle') || field('publisher')
    rec.year = yearFrom(field('year'))
    rec.doi = field('doi')
    rec.tags = field('keywords').replace(/;/g, ',')
    rec.notes = field('note')
    rec.abstract = field('abstract')
    rec.url = field('url')
    const keyMatch = chunk.match(/@\w+\s*\{([^,]+),/)
    if (keyMatch) rec.zoteroKey = clean(keyMatch[1])
    if (rec.title) records.push(rec)
  }
  return records
}

export function detectBibliographyFormat(text: string): 'ris' | 'bibtex' | 'unknown' {
  const head = text.slice(0, 400)
  if (/^\s*TY {2}- /m.test(head) || /\nTY {2}- /.test(text)) return 'ris'
  if (/@\w+\s*\{/.test(head) || /@\w+\s*\{/.test(text)) return 'bibtex'
  return 'unknown'
}

export function parseBibliography(text: string): BibliographyRecord[] {
  const fmt = detectBibliographyFormat(text)
  if (fmt === 'ris') return parseRis(text)
  if (fmt === 'bibtex') return parseBibtex(text)
  return []
}

export function normalizeTitle(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, ' ').trim()
}

export function paperIdentityKey(p: { doi?: string; zoteroKey?: string; title?: string }): string {
  const doi = (p.doi || '').trim().toLowerCase()
  if (doi) return `doi:${doi}`
  const zk = (p.zoteroKey || '').trim()
  if (zk) return `zotero:${zk}`
  return `title:${normalizeTitle(p.title || '')}`
}

/**
 * 把「已经是结构化对象」的文献条目归一成 `BibliographyRecord[]`。
 *
 * 为什么需要它：`/api/papers/import` 原本只吃 RIS / BibTeX 文本。但有一类来源
 * 本来就是结构化的 —— 例如 AI 相关论文面板背后的 Crossref 检索结果
 * （`RetrievedPaper`：title/authors/year/venue/doi/url）。
 * 让调用方把这些字段拼成 RIS 再让服务端解析回来，是纯浪费：
 * 中间要处理 RIS 的换行与转义，任何一处没转干净就会**静默丢字段**。
 * 直接接受对象则没有这层损耗。
 *
 * 客户端来的东西一律不可信，所以这里逐个字段做类型与长度收敛：
 *  - 非对象/无标题的条目直接丢弃（没有标题的文献入库后无法辨认）；
 *  - 年份只接受有限数字，其余回落 0（由调用方的 schema 默认值兜底）；
 *  - 字符串字段裁到合理长度，防止把整页 HTML 塞进 tags。
 */
export function normalizeRecords(input: unknown): BibliographyRecord[] {
  if (!Array.isArray(input)) return []
  const str = (v: unknown, max = 2000): string => {
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
    if (typeof v !== 'string') return ''
    return v.trim().slice(0, max)
  }
  const out: BibliographyRecord[] = []
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const r = raw as Record<string, unknown>
    const title = str(r.title, 500)
    if (!title) continue
    const yearNum = Number(r.year)
    out.push({
      title,
      authors: str(r.authors, 500),
      venue: str(r.venue, 300),
      year: Number.isFinite(yearNum) && yearNum > 0 ? Math.trunc(yearNum) : 0,
      doi: str(r.doi, 200),
      tags: str(r.tags, 500),
      notes: str(r.notes, 4000),
      abstract: str(r.abstract, 8000),
      url: str(r.url, 1000),
      zoteroKey: str(r.zoteroKey, 100),
    })
  }
  return out
}
