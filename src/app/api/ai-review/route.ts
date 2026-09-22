import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { NO_FABRICATION_GUARD, NO_FABRICATION_GUARD_EN } from '@/lib/llm/prompts'
import { HEADING_LEVEL_RULE, OUTPUT_FORMAT_CONTRACT } from '@/lib/llm/format'
import { scopeByTopic } from '@/lib/methodology/topic-scope'
import { extractCitationIds } from '@/lib/writing/draft'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

/**
 * 阅读范围 → 可编号的综述草稿。
 *
 * 这条路由在 2026-09-20 被**重写**过一次，原因值得记下来：
 *
 * 旧实现的取料是 `paper.findMany({ take: 15, orderBy: [{year:'desc'}, {relevance:'desc'}] })`
 * —— 全库最新 15 篇，**与用户读没读过、属于哪个课题都无关**。两个后果：
 *  1. 综述里谈的是「库里最新的论文」，而不是「你读过的文献」，
 *     跟「阅读 → 综述」这个真实工作流对不上；
 *  2. 引用写的是 `[Author, Year]` 这种**自由文本**，与文献库没有任何结构关联，
 *     既没法自动编号，也没法生成参考文献表，用户只能自己再手抄一遍。
 *
 * 新实现把「取料」与「产出的引用形态」都换掉了：
 *  - 取料：`scope`（阅读状态：仅已读 / 已读+在读 / 不限）× `topicId`（课题域，
 *    走与 AI 研究分析同一个 `scopeByTopic`，手挂优先 + 关键词兜底）；
 *  - 立场：**只把读过的文献当作已知事实**，没读过的就不该被当作综述依据；
 *  - 产出：正文里写 `[@paperId]`，于是它可以被直接丢进写作工作台，
 *    由那边统一编号、生成参考文献表（IEEE / GB/T 7714 任选）。
 *
 * 还有一条**防幻觉的收口**：模型有时会「顺手」编一个不在清单里的 id（或把作者名
 * 当成 id 写进 `[@...]`）。这里把正文里出现的所有标记与清单求差集，
 * 把不认识的 id 原样回报给前端 —— 让用户当场看到，而不是等导出时才发现
 * 参考文献里多出一条不存在的条目。
 */

/** 阅读范围 → 允许参与综述的 Paper.status 集合；空数组表示不筛 */
const SCOPE_STATUSES = {
  read: ['read'],
  reading: ['read', 'reading'],
  all: [],
} as const

type ReviewScope = keyof typeof SCOPE_STATUSES

const SCOPE_LABEL: Record<ReviewScope, string> = {
  read: '仅已读',
  reading: '已读 + 在读',
  all: '不限阅读状态',
}

const FOCUS_KEYS = ['general', 'method', 'gap', 'timeline'] as const
type ReviewFocus = (typeof FOCUS_KEYS)[number]

const FOCUS_LABEL: Record<ReviewFocus, string> = {
  general: '综合（方法分类 + 研究空白）',
  method: '方法对比',
  gap: '研究空白',
  timeline: '时间脉络',
}

/** 参与综述的论文上限（防止提示词被撑爆）；摘要是最关键的原料，但要截断 */
const PAPER_LIMIT = 40
const ABSTRACT_LIMIT = 400

/**
 * 行类型显式声明，不用 `Awaited<ReturnType<typeof db.paper.findMany>>`。
 * 理由同 `ai-gap-analysis`：Prisma 的 findMany 返回类型是层层展开的递归泛型，
 * TS 在匹配 `scopeByTopic<T extends Scopable>` 时会放弃推断 T、直接退回约束，
 * 于是 `item.venue` 报 TS2339。
 */
type PaperRow = {
  id: string
  title: string
  authors: string
  venue: string
  year: number
  tags: string
  category: string
  status: string
  relevance: number
  abstract: string
  topicIds: string
}

/**
 * 引用规范 —— 必须与写作工作台的标记语法**逐字对齐**。
 *
 * `[@paperId]` 是 `src/lib/writing/draft.ts` 里 `INLINE_MARKER_RE` 认识的语法；
 * 模型只要写成 `[@Zhang 2024]`、`[1]`、`(Author, Year)`，那边就解析不出来，
 * 用户在写作台看到的就是「坏引用」或干脆没有参考文献。
 * 所以这段不只是格式要求，它是**前后端之间的接口约定**。
 */
const CITATION_CONTRACT_ZH = `## 引用规范（必须严格遵守，这是与写作工作台的接口约定）
- 正文里每一处引用都写成 \`[@论文id]\`，id 必须**逐字**取自下面「论文清单」的 id 字段。
- 一处同时引用多篇写成 \`[@id1, @id2]\`。
- 禁止自行编造 id、禁止引用清单之外的论文、禁止把作者名或年份当 id 写进标记。
- 禁止输出参考文献表、禁止输出 \`[1]\` 这类数字编号 —— 编号与著录格式由写作工作台统一生成。
- 每个具体论断（方法、结论、局限）后面都要跟对应的 \`[@id]\`；没有材料支撑的判断宁可删掉。`

const CITATION_CONTRACT_EN = `## Citation rules (strict, this is the interface contract with the writing workbench)
- Every citation must be written as \`[@paperId]\`, where the id is copied **verbatim** from the paper list below.
- Multiple papers in one place: \`[@id1, @id2]\`.
- Never invent an id, never cite a paper outside the list, never put an author name or year in a marker.
- Do NOT output a reference list and do NOT output numeric labels like \`[1]\` — numbering and formatting are produced by the writing workbench.
- Attach a \`[@id]\` to every concrete claim; drop claims you cannot ground.`

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const topic = typeof body.topic === 'string' ? body.topic.trim() : ''
    const language: 'en' | 'zh' = body.language === 'en' ? 'en' : 'zh'

    // 入参非法一律 400，且不打 LLM —— 省一次调用，也避免把参数错误伪装成调用失败。
    if (!topic) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
    }

    const rawFocus = body.focus === undefined ? 'general' : body.focus
    if (typeof rawFocus !== 'string' || !FOCUS_KEYS.includes(rawFocus as ReviewFocus)) {
      return NextResponse.json(
        { error: `Unsupported focus: ${String(rawFocus)}`, supported: FOCUS_KEYS },
        { status: 400 },
      )
    }
    const focus = rawFocus as ReviewFocus

    const rawScope = body.scope === undefined ? 'read' : body.scope
    if (typeof rawScope !== 'string' || !(rawScope in SCOPE_STATUSES)) {
      return NextResponse.json(
        { error: `Unsupported scope: ${String(rawScope)}`, supported: Object.keys(SCOPE_STATUSES) },
        { status: 400 },
      )
    }
    const scope = rawScope as ReviewScope

    const topicId = typeof body.topicId === 'string' ? body.topicId.trim() : ''

    // 显式选了课题却查不到（已被删掉）：如实报错，不静默降级成全库 ——
    // 那样用户会以为拿到的是「这个课题的综述」，实际混着全库内容。
    let topicRow: Awaited<ReturnType<typeof db.topic.findUnique>> = null
    if (topicId) {
      topicRow = await db.topic.findUnique({ where: { id: topicId } })
      if (!topicRow) {
        return NextResponse.json(
          { error: '所选课题不存在（可能已被删除），请重新选择' },
          { status: 400 },
        )
      }
    }

    // 取全量后在应用层筛：SQLite 里没有 JSON 数组包含查询，数据量在千条级。
    const allRows = await db.paper.findMany({
      select: {
        id: true, title: true, authors: true, venue: true, year: true,
        tags: true, category: true, status: true, relevance: true,
        abstract: true, topicIds: true,
      },
      orderBy: [{ year: 'desc' }, { relevance: 'desc' }],
    })

    // ⚠️ 必须显式标注 `readonly string[]`：`SCOPE_STATUSES[scope]` 是**元组联合类型**
    // （`readonly ["read"] | readonly ["read","reading"] | readonly []`），
    // 联合类型上的 `.includes` 参数会被收窄成 `"read"`，于是 `includes(p.status: string)` 直接 TS2345。
    // 本地 `tsc` 是在这次改写**之前**跑的，没看出来；CI 的 typecheck 当场拦下。
    const allowedStatuses: readonly string[] = SCOPE_STATUSES[scope]
    const inScope = allowedStatuses.length
      ? allRows.filter((p) => allowedStatuses.includes(p.status))
      : allRows

    const scoped = scopeByTopic<PaperRow>(inScope, topicRow)

    const paperContext = scoped.matched.slice(0, PAPER_LIMIT).map(({ item, reason }) => ({
      // id 一定要给：正文里的 [@id] 必须能对上它，否则引用全是坏的
      id: item.id,
      title: item.title,
      authors: item.authors,
      venue: item.venue,
      year: item.year,
      status: item.status,
      tags: item.tags,
      category: item.category,
      abstract: (item.abstract || '').slice(0, ABSTRACT_LIMIT),
      matchedBy: reason === 'linked' ? '已挂到本课题' : '关键词匹配',
    }))

    const scopeHeader = [
      `本次综述范围：**${SCOPE_LABEL[scope]}**`,
      topicRow ? `课题「${topicRow.name}」` : '不限课题（全库）',
      `共 ${paperContext.length} 篇可用（本范围相关 ${scoped.matched.length} 篇）`,
    ].join(' · ')

    // 没有原料时不能硬编 —— 让模型基于空清单写「已有研究表明…」，
    // 它只能凭记忆编，而这正是防编造约束要拦的事。如实拒绝更负责。
    if (paperContext.length === 0) {
      const parts: string[] = []
      if (topicRow) {
        parts.push(`课题「${topicRow.name}」下没有符合「${SCOPE_LABEL[scope]}」范围的论文。`)
      } else {
        parts.push(`文献库里没有符合「${SCOPE_LABEL[scope]}」范围的论文。`)
      }
      if (scope !== 'all') {
        parts.push('可以把阅读范围放宽到「不限阅读状态」，或先去论文库把读过的文献标记为「已读」。')
      } else {
        parts.push('请先在论文库导入文献，或给论文挂上这个课题。')
      }
      return NextResponse.json(
        { error: parts.join(''), code: 'NO_CONTEXT' },
        { status: 400 },
      )
    }

    const paperList = JSON.stringify(paperContext, null, 2)

    const systemPrompt = language === 'zh'
      ? '你是一位通信领域的文献综述专家，擅长基于**给定的论文清单**撰写结构化的综述章节。请用中文撰写，使用学术风格。'
        + NO_FABRICATION_GUARD
      : 'You are an expert literature review writer in telecommunications. Write in academic English, grounded strictly in the provided paper list. '
        + NO_FABRICATION_GUARD_EN

    const userPrompt = language === 'zh'
      ? `请为以下研究课题撰写一段文献综述（约 800-1000 字）：

研究课题: ${topic}
综述重点: ${FOCUS_LABEL[focus]}

${scopeHeader}

可引用的论文清单（每条只能用它自己的 id 作为引用）:
${paperList}

结构要求：

## 2. 相关工作

### 2.1 传统方法
（概括传统方法的发展脉络，句末标注 [@id]）

### 2.2 基于深度学习的方法
#### 2.2.1 监督学习方法
#### 2.2.2 强化学习方法

### 2.3 现有方法的不足（Research Gap）
- Gap 1: ...
- Gap 2: ...
- Gap 3: ...

→ 自然地引出本文的工作`
      : `Write a literature review (~600-800 words) for the following research topic:

Topic: ${topic}
Focus: ${FOCUS_LABEL[focus]}

${scopeHeader}

Citable paper list (each citation must use that paper's own id):
${paperList}

Structure:

## 2. Related Work

### 2.1 Traditional Methods
### 2.2 Deep Learning-based Methods
#### 2.2.1 Supervised Learning
#### 2.2.2 Reinforcement Learning
### 2.3 Research Gaps
- Gap 1: ...
- Gap 2: ...

→ Then lead into the present work`

    // 格式合同与引用合同统一拼在末尾（中英两条分支都覆盖到，漏一条就是一类面板失控）
    const systemPromptWithContract =
      `${systemPrompt}\n\n${CITATION_CONTRACT_ZH}\n\n${OUTPUT_FORMAT_CONTRACT}\n${HEADING_LEVEL_RULE}`

    let content: string
    try {
      content = await chatComplete(
        [
          { role: 'system', content: systemPromptWithContract },
          { role: 'user', content: userPrompt },
        ],
        { timeoutMs: 180_000 }
      )
    } catch (e) {
      return llmFailureResponse(e, 'AI 综述生成失败')
    }

    // 防幻觉收口：正文里的标记与清单求差集。编造的 id 不静默丢弃，原样回报。
    const cited = extractCitationIds(content)
    const knownIds = new Set(paperContext.map((p) => p.id))
    const unknownCitations = cited.filter((id) => !knownIds.has(id))

    void recordActivity({ module: 'paper', action: 'generate', title: '生成了综述草稿' })
    return NextResponse.json({
      success: true,
      content,
      language,
      focus,
      scope,
      topicId: topicRow?.id ?? null,
      topicName: topicRow?.name ?? null,
      // 回传实际用量：用户才能判断这次的综述有多实（以前完全看不到）
      used: {
        papers: paperContext.length,
        relatedPapers: scoped.matched.length,
        // 被「阅读范围」挡在外面的论文数 —— 提示用户「你还有 N 篇没读/没标记」
        excludedByScope: allRows.length - inScope.length,
        scopeLabel: SCOPE_LABEL[scope],
      },
      citations: {
        total: cited.length,
        known: cited.length - unknownCitations.length,
        unknown: unknownCitations,
      },
    })
  } catch (e) {
    console.error('AI review error', e)
    return NextResponse.json({ error: 'AI review failed: ' + (e as Error).message }, { status: 500 })
  }
}
