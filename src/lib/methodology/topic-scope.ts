/**
 * AI 研究分析的「课题域」选择。
 *
 * 背景（2026-09-18 用户反馈）：「AI 研究分析应该要加一个课题选择，
 * 多个同时分析内容少不说还容易在课题多了以后互相干扰」。
 *
 * 原实现（`/api/ai-gap-analysis`）有三处叠加的错，合起来让「课题一多就废」：
 *  1. `topic.findMany()` —— 把**全部**课题塞进上下文，模型要在十几个不相关的
 *     方向上找 research gap，注意力被摊薄；
 *  2. `paper.findMany({ take: 20, orderBy: year desc })` —— 取的是**全库最新 20 篇**，
 *     既与课题无关，又会让「本课题相关但年份较老」的关键文献被直接挤掉；
 *  3. `note.findMany({ take: 10 })` —— 最近 10 条笔记同样不分课题，
 *     混着其他方向的思考，模型容易顺着噪声跑偏。
 *
 * 修法：给分析加一个「课题域」（topic scope），论文与笔记都按它筛。
 *
 * 筛选是**两级**的，刻意不只用一种：
 *  - 一级：用户手动挂的 `topicIds`（论文/笔记的「所属课题」字段）—— 准；
 *  - 二级：关键词兜底（拿课题名/方向/描述里的词去匹配标题、标签、摘要）—— 全。
 *
 * 为什么两级的顺序是「挂载优先、关键词补足」而不是二选一：
 * 只用手挂 → 用户没打标时分析直接没料（他会觉得功能坏了）；
 * 只用关键词 → 中文课题与英文标题常常完全对不上（漏掉真正相关的文献）。
 * 两者叠加后，**任何一条命中都算命中**，并在返回里标明它是因为哪一级进来的。
 */

import { parseStringArray } from '@/lib/utils'

/** 一条论文/笔记能参与本课题分析的最小信息 */
export interface ScopeItem {
  id: string
  title: string
  /** JSON 字符串数组，元素是 Topic.id */
  topicIds?: string
  tags?: string
  abstract?: string
  content?: string
}

/**
 * 泛型约束：只要求「有 title」（筛选用得到）、`topicIds` 可选。
 *
 * ⚠️ 两个坑都踩过，别改回去：
 *  1. 不要把它写成 `T extends ScopeItem` —— 那样调用方传进来的是 Prisma 行
 *     （带 venue/year/category…），返回值的元素类型会被**塌缩成 ScopeItem**，
 *     调用方再取 `item.venue` 直接 TS2339。约束越松，T 的完整形状保留得越全。
 *  2. 即使约束写成 `Scopable`，**Prisma 的 `findMany` 返回值也不总能推断出 T**：
 *     它的返回类型是层层展开的递归泛型，TS 在匹配 `T extends Scopable` 时会
 *     放弃推断、直接退回约束 `Scopable`。所以调用方**必须显式标注类型参数**
 *     （见下面 `scopePapers` / `scopeNotes` 的用法），否则 item 上只剩 title。
 */
export type Scopable = { title: string; topicIds?: string; tags?: string; abstract?: string; content?: string }

export interface TopicScopeInput {
  id: string
  name: string
  direction?: string
  description?: string
}

/**
 * 条目为什么进入本次分析：
 *  - `linked` —— 用户明确把手挂到了本课题上（证据强度最高）；
 *  - `keyword` —— 只靠关键词兜底命中，**用户从未确认过它属于本课题**；
 *  - `all` —— 根本没有限定课题（全库模式），此时「属于本课题」无从谈起。
 *
 * ⚠️ 第三种是 2026-09-28 补的。此前不限定课题时一律标成 `linked`，
 * 于是「手挂」这个词被用来表示完全相反的意思（其实是「没筛」），
 * 前端据此显示「手挂 12 篇」就是在说谎。
 */
export type MatchReason = 'linked' | 'keyword' | 'all'

/**
 * 匹配原因 → 给人和模型看的说法。
 *
 * 抽在这里而不是各路由再写一遍三元表达式：这个映射出现在**提示词**里
 * （模型据此判断证据强度），也出现在**界面**上（用户据此判断能不能引用）。
 * 两份实现一旦漂移，用户看到的与模型看到的就不是同一件事。
 */
export const MATCH_REASON_LABEL: Record<MatchReason, string> = {
  linked: '已挂到本课题',
  keyword: '关键词匹配',
  all: '未限定课题（全库）',
}

export interface ScopedItem<T> {
  item: T
  reason: MatchReason
}

export interface ScopeResult<T> {
  /** 命中的条目（`linked` 的排在前，再按原顺序） */
  matched: Array<ScopedItem<T>>
  /** 未命中的条目数（供 UI 提示「还有 N 篇没归到这个课题」） */
  unmatched: number
}

/** 一次筛选的构成，供界面如实交代「这份结论的材料是怎么来的」 */
export interface ScopeBreakdown {
  /** 手挂到本课题（用户确认过） */
  linked: number
  /** 仅关键词命中（**未经确认**，界面必须单独标出，不能混进「手挂」里） */
  keyword: number
  /** 未限定课题时的全量条目（全库模式） */
  all: number
  /** 未命中 */
  unmatched: number
  /** 参与筛选的总条目数 */
  total: number
}

/**
 * 把一次筛选结果压成「手挂 / 关键词 / 全库 / 未命中」四个数。
 *
 * 为什么值得单独一层：`/api/ai-review` 的界面曾经写着
 * 「只使用挂到本课题的文献；未归课题的不会算进来」，而 `scopeByTopic` 实际
 * 允许关键词兜底进来 —— 用户以为在看的是一份「只用已确认文献」的综述，
 * 实际混着从未确认的材料。要让这句话重新成立，界面必须能拿到**与筛选同源**的计数，
 * 而不是自己再算一遍（自己算必然漂移，这是这个仓库反复踩过的坑）。
 *
 * ⚠️ 刻意**不**在这里给「是否限定了课题」下结论：那取决于调用方有没有传 topic，
 * 从计数反推在「限定了课题但一条都没命中」时会得出相反答案。
 */
export function summarizeScope<T>(result: ScopeResult<T>): ScopeBreakdown {
  let linked = 0
  let keyword = 0
  let all = 0
  for (const m of result.matched) {
    if (m.reason === 'linked') linked += 1
    else if (m.reason === 'keyword') keyword += 1
    else all += 1
  }
  return {
    linked,
    keyword,
    all,
    unmatched: result.unmatched,
    total: result.matched.length + result.unmatched,
  }
}

/**
 * 解析 `topicIds` JSON 数组；坏数据一律当空数组（不能让一条脏记录带崩整个分析）。
 *
 * 实现已收敛到 `lib/utils.ts` 的 `parseStringArray` —— 读取侧的同形字段
 * （`paperIds` / `links`…）原先各有一份逐字节等价的实现，只改其中一份就会
 * 让某个模块悄悄少显示几条关联。这里保留具名导出，调用方与测试无需改动。
 */
export function parseTopicIds(raw: unknown): string[] {
  return parseStringArray(raw)
}

/**
 * 从课题信息里抽关键词。
 *
 * 中文没有空格分词，这里退而求其次：按常见分隔符切开，再补上
 * 「2-4 字的连续汉字片段」与「长度 ≥3 的英文/缩写词」。
 * 不是要做通用分词 —— 目标是抓住课题名里的实词（如「RIS」「DRL」「资源分配」），
 * 够用来匹配英文标题里的缩写与中文标签。
 */
export function extractKeywords(topic: TopicScopeInput): string[] {
  const raw = [topic.name, topic.direction, topic.description].filter(Boolean).join(' ')
  const out = new Set<string>()

  // 英文词/缩写/数字组合
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9-]{2,}/g)) {
    const word = m[0]
    // 停用词：出现在几乎每个课题描述里，拿它们匹配等于全命中
    if (/^(the|and|for|with|based|using|via|from|into|deep|learning)$/i.test(word)) continue
    out.add(word.toLowerCase())
  }

  // 中英/数字/标点分隔后的中文片段，再取其 2-4 字滑窗
  const CJK_STOP = new Set([
    '研究', '方法', '基于', '面向', '优化', '分析', '问题', '系统', '技术', '应用',
    '一种', '网络', '智能', '实现', '设计', '及其', '相关', '进行', '可以', '以及',
  ])
  for (const chunk of raw.split(/[^\u4e00-\u9fa5A-Za-z0-9]+/)) {
    if (!/[\u4e00-\u9fa5]/.test(chunk)) continue
    const cjk = chunk.replace(/[A-Za-z0-9]/g, '')
    for (let len = 4; len >= 2; len -= 1) {
      for (let i = 0; i + len <= cjk.length; i += 1) {
        const gram = cjk.slice(i, i + len)
        if (CJK_STOP.has(gram)) continue
        out.add(gram)
      }
    }
  }

  return [...out]
}

/** 被测文本：标题权重最高，其余拼在一起即可 */
function haystackOf(item: Scopable): string {
  return [item.title, item.tags, item.abstract, item.content].filter(Boolean).join(' ').toLowerCase()
}

/**
 * 按课题域筛条目。
 *
 * 泛型约束写成 `T extends { topicIds?: string; title: string }`（而不是绑到 ScopeItem）：
 * 调用方传进来的 Prisma 行带有 venue/year/abstract 等额外字段，
 * 若签名里写 `T extends ScopeItem`，返回值的元素类型会被**塌缩成 ScopeItem**，
 * 于是调用方再取 `item.venue` 就报 TS2339。保持 T 的完整形状才不会丢字段。
 *
 * @param items 待筛条目（论文或笔记）
 * @param topic 课题；传 null 表示「不筛，全量参与」（即旧的综合模式）
 */
export function scopeByTopic<T extends Scopable>(
  items: T[],
  topic: TopicScopeInput | null
): ScopeResult<T> {
  if (!topic) {
    // 全库模式：条目并没有「属于本课题」这回事，所以标 `all` 而不是 `linked`。
    // 标成 `linked` 会让上游如实报告时说出「手挂 N 篇」这种没有依据的话。
    return { matched: items.map((item) => ({ item, reason: 'all' as MatchReason })), unmatched: 0 }
  }

  const keywords = extractKeywords(topic)
  const linked: Array<ScopedItem<T>> = []
  const byKeyword: Array<ScopedItem<T>> = []

  for (const item of items) {
    if (parseTopicIds(item.topicIds).includes(topic.id)) {
      linked.push({ item, reason: 'linked' })
      continue
    }
    const hay = haystackOf(item)
    if (keywords.some((k) => hay.includes(k))) {
      byKeyword.push({ item, reason: 'keyword' })
    }
  }

  return {
    matched: [...linked, ...byKeyword],
    unmatched: items.length - linked.length - byKeyword.length,
  }
}

/**
 * 把一组课题条目格式化成提示词里的「课题域」段。
 *
 * 单选模式下通常只有一条，但保留数组形态：多选/全库模式不用另写一条格式化路径。
 */
export function formatTopicScope(topics: TopicScopeInput[]): string {
  if (!topics.length) return '（未指定课题）'
  return topics
    .map((t) => {
      const meta = [t.direction, t.description].filter(Boolean).join(' · ')
      return `- ${t.name}${meta ? `（${meta}）` : ''}`
    })
    .join('\n')
}
