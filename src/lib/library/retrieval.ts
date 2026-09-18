/**
 * 真实文献检索 —— 把「AI 推荐论文」从模型记忆变成可核实的结果。
 *
 * 背景（2026-09-18）：`/api/ai-related-papers` 的 `type='papers'` 是让模型
 * 「推荐 5 篇应该阅读的相关论文」。加了防编造约束之后模型会收敛一些，但**本质没变**：
 * 它仍然是在凭记忆写标题、作者、年份、期刊 —— 而这些恰恰是科研场景里最贵的幻觉，
 * 用户会拿着去检索、去引用。
 *
 * 所以这里改成：**先真的去学术数据库查，把查到的元数据交给模型**，
 * 模型只负责「从中挑出最相关的并解释为什么相关」，不再负责「记住有哪些论文」。
 *
 * 数据源：Crossref REST API（https://api.crossref.org）——
 * 开放、免 Key、覆盖绝大多数 DOI 注册文献，元数据（标题/作者/年份/期刊/DOI）可直接核实。
 * 不引入新依赖：只用内置 `fetch`。
 *
 * 设计要点：
 *  - **绝不因为检索失败就让整个功能挂掉**：返回空数组，由调用方决定降级口径。
 *  - 超时独立于 LLM 超时（检索必须快失败，否则用户等的是「查库」而不是「生成」）。
 *  - 只回传白名单字段，杜绝把上游 JSON 原样塞进提示词（体积 + 注入面）。
 */

const CROSSREF_ENDPOINT = 'https://api.crossref.org/works'

/**
 * Crossref 的 polite pool 要求带上联系方式，否则容易被 429。
 * 这里给一个应用标识；`mailto` 用占位地址即可显著提高配额
 * （Crossref 不校验地址是否存在，只用于联系「过量调用者」）。
 */
const USER_AGENT = 'AI-Network-Lab/1.3.5 (mailto:noreply@ai-network-lab.local)'

export interface RetrievedPaper {
  title: string
  authors: string
  year: number
  venue: string
  doi: string
  citations: number
  url: string
  /** 有摘要时才有值（Crossref 覆盖不全） */
  abstract: string
}

export interface RetrieveOptions {
  /** 最多返回几条（默认 8） */
  limit?: number
  /** 单次请求超时（毫秒，默认 12s）—— 检索要快失败，不能拖住 LLM 那 180s 的等待 */
  timeoutMs?: number
}

interface CrossrefAuthor {
  given?: string
  family?: string
  name?: string
}

interface CrossrefItem {
  title?: string[]
  author?: CrossrefAuthor[]
  issued?: { 'date-parts'?: (number | null)[][] }
  'container-title'?: string[]
  DOI?: string
  'is-referenced-by-count'?: number
  URL?: string
  abstract?: string
  type?: string
}

/** 去掉 JATS 标签（Crossref 的 abstract 是 `<jats:p>...</jats:p>` 形式） */
function stripJats(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    // 用空格替换标签会在标点前留出空隙（"routing</jats:italic>." → "routing ."），
    // 而这些文本要直接进提示词、也可能被用户复制去引用，所以把标点前的空格收掉。
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .trim()
}

function formatAuthors(authors: CrossrefAuthor[] | undefined): string {
  if (!authors || authors.length === 0) return ''
  const names = authors
    .map((a) => {
      if (a.name) return a.name.trim()
      const fam = (a.family || '').trim()
      const giv = (a.given || '').trim()
      if (fam && giv) return `${fam} ${giv}`
      return fam || giv
    })
    .filter(Boolean)
  if (names.length === 0) return ''
  if (names.length <= 3) return names.join(', ')
  return `${names.slice(0, 3).join(', ')} 等 ${names.length} 人`
}

function firstYear(item: CrossrefItem): number {
  const parts = item.issued?.['date-parts']?.[0]
  if (!parts) return 0
  const y = parts[0]
  return typeof y === 'number' && y > 1800 && y < 2200 ? y : 0
}

/**
 * 检索真实文献。
 *
 * @param query 检索词（通常是课题名 + 用户已有论文的标签/标题关键词）
 * @param options limit / timeoutMs
 * @returns 命中的文献元数据；**失败时返回空数组**（不抛）
 */
export async function retrieveRelatedPapers(
  query: string,
  options: RetrieveOptions = {}
): Promise<RetrievedPaper[]> {
  const limit = Math.min(20, Math.max(1, options.limit ?? 8))
  const timeoutMs = options.timeoutMs ?? 12_000
  const q = query.replace(/\s+/g, ' ').trim()
  if (!q) return []

  const params = new URLSearchParams({
    'query.bibliographic': q,
    rows: String(limit),
    mailto: 'noreply@ai-network-lab.local',
    // 只取需要的字段：体积小得多，也避免把无关字段带进提示词
    select: [
      'title',
      'author',
      'issued',
      'container-title',
      'DOI',
      'is-referenced-by-count',
      'URL',
      'abstract',
      'type',
    ].join(','),
  })

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const res = await fetch(`${CROSSREF_ENDPOINT}?${params.toString()}`, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { message?: { items?: CrossrefItem[] } }
    const items = data.message?.items
    if (!Array.isArray(items)) return []

    const out: RetrievedPaper[] = []
    for (const it of items) {
      const title = stripJats((it.title || [])[0] || '')
      if (!title) continue
      // 只要「有 DOI 且标题完整」的条目 —— DOI 是用户能自行核实的关键锚点
      const doi = (it.DOI || '').trim()
      if (!doi) continue
      out.push({
        title,
        authors: formatAuthors(it.author),
        year: firstYear(it),
        venue: stripJats((it['container-title'] || [])[0] || ''),
        doi,
        citations: typeof it['is-referenced-by-count'] === 'number' ? it['is-referenced-by-count'] : 0,
        url: it.URL || `https://doi.org/${doi}`,
        abstract: it.abstract ? stripJats(it.abstract).slice(0, 800) : '',
      })
    }
    return out
  } catch {
    // 网络不可达 / 超时 / JSON 损坏 —— 一律当作「没查到」，让上层降级
    return []
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 把检索结果拼成给模型看的清单。
 *
 * 关键：**带上 `[n]` 编号**，并要求模型只能引用这些编号。
 * 这样「模型说的每一篇」都能回溯到一条真实记录，而不是一个可能不存在的标题。
 */
export function formatRetrievedForPrompt(papers: RetrievedPaper[]): string {
  if (papers.length === 0) return ''
  return papers
    .map((p, i) => {
      const bits = [
        `- [${i + 1}] ${p.title}`,
        p.authors ? `  作者: ${p.authors}` : '',
        p.year ? `  年份: ${p.year}` : '',
        p.venue ? `  期刊/会议: ${p.venue}` : '',
        `  DOI: ${p.doi}`,
        p.citations ? `  被引: ${p.citations}` : '',
        p.abstract ? `  摘要片段: ${p.abstract.slice(0, 300)}` : '',
      ].filter(Boolean)
      return bits.join('\n')
    })
    .join('\n\n')
}
