/**
 * 参考文献著录格式 —— 纯函数层（IEEE + GB/T 7714-2015）。
 *
 * 为什么单独一层：
 * 「写作即引用」的闭环是 `[@paperId]` → 编号 → 参考文献表 → 导出稿，
 * 其中**只有「一条题录渲染成什么字符串」这一步是随投稿目标变化的**。
 * IEEE 期刊和国内期刊要的是两种完全不同的著录格式，把这一步抽成纯函数，
 * 就能做到「换格式不改数据、不迁移库、不动其它任何一环」。
 *
 * 两个刻意的设计约束：
 *
 *  1. **不猜**。姓名串的解析是有歧义的（`Smith, J.` 到底是「一个人：姓 Smith 名 J」
 *     还是「两个人：Smith 与 J」）。凡是分不清的，`certain=false`，
 *     由各格式自己回落到**原始作者串** —— 宁可格式不标准，也不能把姓和名弄反
 *     （那是要上勘误的学术事故，比格式不统一严重得多）。
 *  2. **不编**。库里没有卷/期/页码/出版地，就不输出这些字段，也不填占位符。
 *     GB/T 7714 的完整格式需要它们，本层只输出「库里真有的部分」，
 *     并在文档里写清缺哪几项 —— 用户补的时候知道该补什么。
 */

// ---------------- 类型 ----------------

export type CitationStyle = 'ieee' | 'gbt7714'

export const DEFAULT_CITATION_STYLE: CitationStyle = 'ieee'

/** 顺序即 UI 里的展示顺序 */
export const CITATION_STYLES: CitationStyle[] = ['ieee', 'gbt7714']

/**
 * 可著录的最小引用形状。
 *
 * 刻意**不 import** `draft.ts` 的 `ResolvedReference`：那会形成
 * draft → citation-styles → draft 的循环依赖。用结构化的窄接口，
 * `ResolvedReference` 天然满足它（TS 是结构类型系统），运行时零耦合。
 */
export interface CitableReference {
  /** 正文中出现的序号，从 1 开始 */
  number: number
  /** 文献库里是否真的存在这一条 */
  found: boolean
  title: string
  authors: string
  venue: string
  year: number | null
  doi: string
  /** 未找到时用于提示的原始 id */
  paperId?: string
}

export interface AuthorName {
  /** 原始片段（trim 后），中文姓名直接用它输出 */
  raw: string
  /** 姓（family） */
  family: string
  /** 名（given），保持原始写法（可能是缩写串 `Y. S.`） */
  given: string
}

export interface ParsedAuthors {
  names: AuthorName[]
  /** 原串里带 `et al.` / `etc.` —— 表示该条目在入库时就被截断过 */
  etAl: boolean
  /**
   * 是否被确定性解析。
   * `false` 时调用方**必须**回落到原始作者串，不得使用 `names`。
   */
  certain: boolean
  /** 不确定的原因（中文，供 UI 提示与单测断言） */
  note: string
}

// ---------------- 判定用具 ----------------

/** 单段缩写点串：`J.` / `Y. S.` / `D.R.` / `H.V.`（字母大写、以点收尾） */
const INITIALS_ONLY_RE = /^(?:[A-Z]\.\s*)+$/
/** 缩写在前：`J. Smith` / `A. B. Lee`（捕获组 1 = 缩写，2 = 姓） */
const INITIALS_FIRST_RE = /^((?:[A-Z]\.\s*)+)([A-Z].*)$/
const CJK_RE = /[\u4e00-\u9fff]/

function isInitialsOnly(s: string): boolean {
  return INITIALS_ONLY_RE.test(s) || /^[A-Z]$/.test(s)
}

/** 看起来像「名」（首字母大写即可 —— 缩写串 `Y. S.` 与全名 `Aoyang` 都算） */
function looksLikeGiven(s: string): boolean {
  return /^[A-Z]/.test(s)
}

function looksInitialsFirst(s: string): boolean {
  return INITIALS_FIRST_RE.test(s)
}

function squeeze(s: string): string {
  return (s ?? '').replace(/\s+/g, ' ').trim()
}

// ---------------- 姓名解析 ----------------

/**
 * 解析单个作者片段：返回姓与名，**分不清就返回 null**。
 *
 * 支持两种无歧义写法：
 *  - 「姓, 名」：`Nasir, Y. S.` / `Kenney, Russell H.` / `Smith, J.`
 *  - 「缩写在前」：`J. Smith` / `A. B. Lee`
 * 单纯一个词（`Wang`）视为只有姓 —— 缩写点缺省即无。
 * 形如 `John Smith`（名在前、无缩写点）**刻意不解析**：无法区分哪一段是姓。
 */
function splitOneAuthor(segment: string): { family: string; given: string } | null {
  const s = squeeze(segment)
  if (!s) return null

  // 整段都是缩写点（`Y. S.` / `D.R.`）⇒ **只有名、没有姓**，没有可著录的姓，
  // 不能顺手把最后一个缩写点当成姓（`Y. S.` 会被读成「姓 S. 名 Y.」）。
  if (isInitialsOnly(s)) return null

  if (s.includes(',')) {
    const idx = s.indexOf(',')
    const family = s.slice(0, idx).trim()
    const given = s.slice(idx + 1).trim()
    if (!family || !given) return null
    // 右侧再出现逗号说明这一段的边界本身就不对（例如被误当成两段）
    if (given.includes(',')) return null
    // 左边是纯缩写点 ⇒ 更可能是「缩写在前」被逗号切错了，不猜
    if (isInitialsOnly(family)) return null
    return { family, given }
  }

  const words = s.split(' ').filter(Boolean)
  if (words.length === 1) {
    return isInitialsOnly(words[0]) ? null : { family: words[0], given: '' }
  }

  const m = INITIALS_FIRST_RE.exec(s)
  if (m) return { family: m[2].trim(), given: m[1].trim() }

  return null
}

/**
 * 解析整串作者。
 *
 * 库里真实的作者串长这样（2026-09-20 抽样确认，见 `.recon/out/probe-authors.py`）：
 * ```
 * Nasir, Y. S., Guo, D.
 * Kenney, Russell H., McDaniel, Jay W.
 * Li, Aoyang, Wang, Ye, Mei, Lin, Wu, Shaohua, Zhang, Qinyu
 * Mudumbai, R., Brown, D.R., Madhow, U., Poor, H.V.
 * Zhang, S. et al.
 * ```
 * 即**主流是「姓, 名」且逗号既是段内分隔符又是作者间分隔符**。
 * 于是这里的核心判断是「怎么切段」：
 *
 *  1. 有 `;` → 用它切，无歧义；
 *  2. 否则按逗号切，若**段数是偶数**、且**首段不是「缩写在前」**、
 *     且**所有奇数位段都像「名」** → 按「姓, 名」两两成组（覆盖上面前三条）；
 *  3. 否则每段各自解析（覆盖 `J. Smith, A. Lee` 这类「缩写在前」的列表）。
 *
 * 第 2 条里的「首段不是缩写在前」是关键反例闸门：`J. Smith, A. Lee`
 * 段数是偶数、奇数位像名，但它首段就是缩写在前 —— 若不加这道闸门，
 * 会被错切成「姓 `J. Smith`、名 `A. Lee`」，姓氏直接丢失。
 */
export function parseAuthors(authors: string | null | undefined): ParsedAuthors {
  const raw = squeeze(authors ?? '')
  if (!raw) return { names: [], etAl: false, certain: true, note: '' }

  // 中文姓名不需要拆姓/名，也不能按西文规则大写改写，整串按分隔符切开原样保留。
  if (CJK_RE.test(raw)) {
    let etAl = false
    const names: AuthorName[] = []
    for (const part of raw.split(/[,;、，；]/).map(squeeze).filter(Boolean)) {
      if (/^(等|etc\.?|et\s*al\.?)$/i.test(part)) {
        etAl = true
        continue
      }
      names.push({ raw: part, family: part, given: '' })
    }
    return { names, etAl, certain: true, note: '' }
  }

  // `et al.` 只可能是「等等」，不可能是某个人名的一部分 —— 先摘掉再切段。
  let etAl = false
  let s = raw.replace(/[，、]/g, ',').replace(/；/g, ';')
  s = s.replace(/\bet\s*al\.?/gi, () => {
    etAl = true
    return ''
  })
  s = s.replace(/\betc\.?/gi, () => {
    etAl = true
    return ''
  })
  s = s.replace(/[,\s;]+$/, '').trim()

  if (!s) return { names: [], etAl, certain: true, note: '' }

  let groups: string[]
  if (s.includes(';')) {
    groups = s.split(';').map(squeeze).filter(Boolean)
  } else {
    const tokens = s.split(',').map(squeeze).filter(Boolean)
    const pairable =
      tokens.length >= 2 &&
      tokens.length % 2 === 0 &&
      !looksInitialsFirst(tokens[0]) &&
      tokens.filter((_, i) => i % 2 === 1).every(looksLikeGiven)
    if (pairable) {
      groups = []
      for (let i = 0; i < tokens.length; i += 2) {
        groups.push(`${tokens[i]}, ${tokens[i + 1]}`)
      }
    } else {
      groups = tokens
    }
  }

  const names: AuthorName[] = []
  for (const g of groups) {
    const one = splitOneAuthor(g)
    if (!one) {
      return {
        names: groups.map((x) => ({ raw: x, family: '', given: '' })),
        etAl,
        certain: false,
        note: `无法确定「${g}」的姓与名，已按原始作者串输出`,
      }
    }
    names.push({ raw: g, family: one.family, given: one.given })
  }

  return { names, etAl, certain: true, note: '' }
}

/** 把名（可能是 `Y. S.` / `Russell H.` / `Aoyang`）压成缩写首字母数组：`['Y','S']` */
function toInitials(given: string): string[] {
  return given
    .split(/[^A-Za-z'’-]+/)
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
}

// ---------------- 题录清洗 ----------------

/**
 * 去掉 venue 里混进来的年份（库里确实有 `IEEE TCOM, 2019` 这种）。
 *
 * 年份是独立字段，不清掉就会输出 `IEEE TCOM, 2019, 2019` —— 一眼假的稿子。
 * **只在尾部年份恰好等于 `year` 字段时才删**，避免误伤本身就带数字的会议名
 * （`ICC 2025 - IEEE International Conference on Communications` 不会被改）。
 */
export function cleanVenue(venue: string | null | undefined, year: number | null | undefined): string {
  const v = squeeze(venue ?? '')
  if (!v || !year || !Number.isFinite(Number(year))) return v
  const re = new RegExp(`[\\s,;·]+[\\(\\[]?${Number(year)}[\\)\\]]?$`)
  return re.test(v) ? v.replace(re, '').replace(/[\s,;·]+$/, '').trim() : v
}

// ---------------- 文献类型标识（GB/T 7714 必须有）----------------

const THESIS_HINTS = /thesis|dissertation|学位论文/i
/** 注意 `proceedings of the ieee` 是**期刊**不是会议 —— 这条必须排在会议判断之前 */
const JOURNAL_HINTS =
  /journal|transactions|letters|magazine|access|surveys|tutorials|review|proceedings of the ieee|学报|期刊/i
const CONFERENCE_HINTS =
  /conference|symposium|workshop|congress|proceedings|meeting|\bconf\b|\bicc\b|\bglobecom\b|\binfocom\b|\bwcnc\b|\bvtc\b|会议/i
const BOOK_HINTS = /press\b|publisher|出版社|\bbook\b/i

/**
 * 只凭 `venue` 文本猜文献类型标识 —— 库里没有独立的类型字段，这是唯一可用信号。
 * 猜不到时按 `J`（期刊论文）落 —— 科研库里绝大多数条目确实是期刊/会议论文，
 * 而这个标识只影响 `[J]/[C]` 这一个字符，猜错的代价远小于留空。
 */
export function inferDocTypeTag(venue: string | null | undefined): 'J' | 'C' | 'M' | 'D' {
  const v = squeeze(venue ?? '')
  if (!v) return 'J'
  if (THESIS_HINTS.test(v)) return 'D'
  if (JOURNAL_HINTS.test(v)) return 'J'
  if (CONFERENCE_HINTS.test(v)) return 'C'
  if (BOOK_HINTS.test(v)) return 'M'
  return 'J'
}

// ---------------- 作者串渲染 ----------------

/** IEEE：缩写在前，逗号分隔，`et al.` 前不加逗号（IEEE 惯例：`J. Smith et al.`） */
export function formatAuthorsIEEE(authors: string | null | undefined): string {
  const raw = squeeze(authors ?? '')
  if (!raw) return ''
  const parsed = parseAuthors(raw)
  if (!parsed.certain || parsed.names.length === 0) return raw

  const rendered = parsed.names.map((n) => {
    if (CJK_RE.test(n.family)) return n.raw
    return n.given ? `${n.given} ${n.family}` : n.family
  })
  let list = rendered.join(', ')
  if (parsed.etAl) list += ' et al.'
  return list
}

/** 单条姓名 → GB/T 7714 写法：`SMITH J` / `KENNEY R H` / 中文原名 */
function renderGBTName(n: AuthorName): string {
  if (CJK_RE.test(n.family)) return n.raw
  const family = n.family.toUpperCase()
  const initials = toInitials(n.given).join(' ')
  return initials ? `${family} ${initials}` : family
}

/**
 * GB/T 7714-2015：姓在前、名缩写且**缩写点省略**（`SMITH J`）。
 *
 * 著者数量规则（GB/T 7714-2015 §8.1.2）：不超过 3 个全部著录，
 * 超过 3 个只著录前 3 个，其后加「，等」（中文文献）或「, et al.」（西文文献）。
 * 原串本身带 `et al.` 的（入库时就被截断过）也补上「等」—— 如实反映"还有别的作者"。
 */
export function formatAuthorsGBT(authors: string | null | undefined): string {
  const raw = squeeze(authors ?? '')
  if (!raw) return ''
  const parsed = parseAuthors(raw)
  // 解析不确定 → 原样输出：格式不标准可以改，姓和名颠倒了要出勘误
  if (!parsed.certain || parsed.names.length === 0) return raw

  const MAX = 3
  const shown = parsed.names.length > MAX ? parsed.names.slice(0, MAX) : parsed.names
  let list = shown.map(renderGBTName).join(', ')
  if (parsed.names.length > MAX || parsed.etAl) {
    list += CJK_RE.test(raw) ? ', 等' : ', et al.'
  }
  return list
}

// ---------------- 单条题录渲染 ----------------

function missingHint(ref: CitableReference): string {
  return `（未在文献库中找到 ${ref.paperId ?? ''}，请检查正文引用标记）`
}

function formatIEEEBody(ref: CitableReference): string {
  if (!ref.found) return missingHint(ref)

  const parts: string[] = []
  const authors = formatAuthorsIEEE(ref.authors)
  if (authors) parts.push(authors)
  const title = squeeze(ref.title ?? '')
  if (title) parts.push(`"${title}"`)

  const venue = cleanVenue(ref.venue, ref.year)
  const venueYear = [venue, ref.year ? String(ref.year) : ''].filter(Boolean).join(', ')
  if (venueYear) parts.push(venueYear)

  let body = parts.join(', ')
  if (!body) body = `（文献库条目 ${ref.paperId ?? ''} 缺少题录信息）`
  if (ref.doi) body += `. doi: ${ref.doi}`
  return `${body}.`
}

/**
 * GB/T 7714 各著录项之间用 `. ` 分隔。
 *
 * ⚠️ 不能无条件拼 `. `：作者串末尾可能**本身就是句点**（解析到 `et al.` 时
 * 会输出 `..., et al.`），无条件拼接会产出 `et al.. Title` —— 双句点。
 * 实测这是最容易漏的一处，所以单独抽出来并配了单测。
 */
function joinGBSegments(segments: string[]): string {
  let out = ''
  for (const raw of segments) {
    const s = raw.trim()
    if (!s) continue
    if (!out) {
      out = s
      continue
    }
    out += /[.。]$/.test(out) ? ` ${s}` : `. ${s}`
  }
  return out
}

function formatGBTBody(ref: CitableReference): string {
  if (!ref.found) return missingHint(ref)

  const authors = formatAuthorsGBT(ref.authors)
  const title = squeeze(ref.title ?? '')
  const tag = inferDocTypeTag(ref.venue)
  const venue = cleanVenue(ref.venue, ref.year)
  const tail = [venue, ref.year ? String(ref.year) : ''].filter(Boolean).join(', ')

  // 缺少的字段（卷、期、页码、出版地、出版者）库里没有，**不输出占位符**，
  // 让用户看到真实缺口，投稿前自己补齐。
  const segments: string[] = []
  if (authors) segments.push(authors)
  if (title) segments.push(`${title}[${tag}]`)
  if (tail) segments.push(tail)

  let body = joinGBSegments(segments)
  if (!body) body = `（文献库条目 ${ref.paperId ?? ''} 缺少题录信息）`
  if (!/[.。]$/.test(body)) body += '.'
  if (ref.doi) body += ` DOI:${ref.doi}.`
  return body
}

/** 单条参考文献**正文部分**（不含编号 `[n] `），供预览列表里「编号单独渲染」的场景使用 */
export function referenceBody(ref: CitableReference, style: CitationStyle = DEFAULT_CITATION_STYLE): string {
  return normalizeCitationStyle(style) === 'gbt7714' ? formatGBTBody(ref) : formatIEEEBody(ref)
}

/** 单条参考文献（含编号） */
export function formatReference(ref: CitableReference, style: CitationStyle = DEFAULT_CITATION_STYLE): string {
  return `[${ref.number}] ${referenceBody(ref, style)}`
}

/** 整表（含编号），顺序即入参顺序（= 正文首次出现顺序） */
export function formatReferences(
  refs: CitableReference[],
  style: CitationStyle = DEFAULT_CITATION_STYLE,
): string[] {
  return refs.map((r) => formatReference(r, style))
}

// ---------------- 样式判定与预设 ----------------

export function isCitationStyle(v: unknown): v is CitationStyle {
  return typeof v === 'string' && (CITATION_STYLES as string[]).includes(v)
}

/**
 * 收敛一道：持久化/URL 参数都可能塞进脏值。
 * 脏值会让「选中的样式」与「实际渲染用的样式」不一致（表现为「选了没反应」）。
 */
export function normalizeCitationStyle(v: unknown): CitationStyle {
  return isCitationStyle(v) ? v : DEFAULT_CITATION_STYLE
}

/** 样例题录：故意用 4 位作者，好让「超过 3 位只列前 3 位 + 等」这条规则在样例里看得见 */
const SAMPLE_REFERENCE: CitableReference = {
  number: 1,
  found: true,
  title: 'Deep Reinforcement Learning for Routing',
  authors: 'Nasir, Y. S., Guo, D., Li, Aoyang, Wang, Ye',
  venue: 'IEEE JSAC',
  year: 2024,
  doi: '10.1109/JSAC.2024.3351234',
  paperId: 'sample',
}

export interface CitationStylePreset {
  id: CitationStyle
  name: string
  summary: string
  /** 由真实渲染函数**现算**出来的样例 —— 不手写，避免说明与实现漂移 */
  sample: string
}

export const CITATION_STYLE_PRESETS: CitationStylePreset[] = [
  {
    id: 'ieee',
    name: 'IEEE',
    summary: '缩写在前（J. Smith），题名加引号，作者全列出；IEEE 期刊/会议投稿默认格式。',
    sample: formatReference(SAMPLE_REFERENCE, 'ieee'),
  },
  {
    id: 'gbt7714',
    name: 'GB/T 7714',
    summary: '姓在前名缩写（SMITH J），题名后带文献类型标识 [J]/[C]，超过 3 位作者只列前 3 位加「等」。',
    sample: formatReference(SAMPLE_REFERENCE, 'gbt7714'),
  },
]

export function findCitationStylePreset(id: CitationStyle): CitationStylePreset {
  return CITATION_STYLE_PRESETS.find((p) => p.id === id) ?? CITATION_STYLE_PRESETS[0]
}
