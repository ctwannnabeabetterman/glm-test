import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { JSON_ONLY_GUARD, NO_FABRICATION_GUARD } from '@/lib/llm/prompts'
import { scopeByTopic } from '@/lib/methodology/topic-scope'
import { parseScoreSuggestions } from '@/lib/library/reading-priority'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/**
 * 让 AI 按论文信息重新给「相关度 / 新颖度 / 阅读优先级」打分。
 *
 * 背景（2026-09-21 用户指示）：「论文库的优先级排序……也是 AI 基于论文信息整合的」。
 * 现状是排序用一套固定公式，而公式的三个输入值（相关度/新颖度/优先级）靠手工填 ——
 * 建库时按直觉填一遍之后再没人回过头改，于是那张「阅读优先级榜」很快就不再反映真实优先级。
 *
 * 这条路由负责「**算**」，不负责「**写**」：
 * 产出是**建议**（每条带理由与「改了什么」所需的数据），用户在界面上过一眼再决定应用哪些。
 * 写回由 `/api/papers/apply-scores` 完成 —— 分开的理由很实际：
 * 模型给出的分数是有可能整体偏高的，批量静默覆盖掉用户自己填过的判断，比不做还糟。
 *
 * 与 `/api/ai-review` 同源的两条约定：
 *  - 取料支持**课题域**（`scopeByTopic`：手挂优先 + 关键词兜底）——
 *    「相关度」本来是相对于某个课题才有意义的量；
 *  - 输出里的 id 必须逐字来自本次清单，清单外的 id 一律回报（`unknownIds`），不静默丢弃。
 */

/** 阅读范围 → 参与打分的 Paper.status；空数组表示不筛 */
const SCOPE_STATUSES: Record<ScoreScope, readonly string[]> = {
  all: [],
  unread: ['unread'],
  reading: ['reading'],
  read: ['read'],
}

type ScoreScope = 'all' | 'unread' | 'reading' | 'read'

const SCOPE_LABEL: Record<ScoreScope, string> = {
  all: '全部论文',
  unread: '仅未读',
  reading: '仅在读',
  read: '仅已读',
}

/**
 * 显式类型守卫，不用 `scope in SCOPE_STATUSES` 之外的写法，也不用数组 includes ——
 * 与 `reading-priority.ts` 同一个理由：字面量数组上的 `includes` 会与 TS 版本打架。
 */
function isScope(v: unknown): v is ScoreScope {
  return v === 'all' || v === 'unread' || v === 'reading' || v === 'read'
}

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 40
const ABSTRACT_LIMIT = 400

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
  novelty: number
  priority: string
  codeUrl: string
  abstract: string
  topicIds: string
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const topicId = typeof body.topicId === 'string' ? body.topicId.trim() : ''

    const rawScope = body.scope === undefined ? 'all' : body.scope
    if (!isScope(rawScope)) {
      return NextResponse.json(
        { error: `Unsupported scope: ${String(rawScope)}`, supported: ['all', 'unread', 'reading', 'read'] },
        { status: 400 },
      )
    }
    const scope = rawScope

    const rawLimit = Number(body.limit)
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(MAX_LIMIT, Math.floor(rawLimit)) : DEFAULT_LIMIT

    // 显式选了课题却查不到：如实报错，不静默降级成全库 ——
    // 「相关度」是相对课题的量，换了参照系分数就不可比。
    let topicRow: Awaited<ReturnType<typeof db.topic.findUnique>> = null
    if (topicId) {
      topicRow = await db.topic.findUnique({ where: { id: topicId } })
      if (!topicRow) {
        return NextResponse.json({ error: '所选课题不存在（可能已被删除），请重新选择' }, { status: 400 })
      }
    }

    // 指定了具体论文时优先按它来（界面上「重评这几篇」的场景），否则按阅读范围取料
    const ids: string[] = Array.isArray(body.paperIds)
      ? body.paperIds.filter((x: unknown): x is string => typeof x === 'string' && !!x.trim()).slice(0, MAX_LIMIT)
      : []

    const allRows = await db.paper.findMany({
      select: {
        id: true, title: true, authors: true, venue: true, year: true,
        tags: true, category: true, status: true, relevance: true,
        novelty: true, priority: true, codeUrl: true, abstract: true, topicIds: true,
      },
      // ⚠️ 刻意**不按现有分数排序**取前 N 篇：那样每次重评都只看到「本来就排名靠前」的论文，
      // 排名靠后的永远不会被重新审视，榜单会自我固化。按年份取是一个中性口径。
      orderBy: [{ year: 'desc' }, { createdAt: 'desc' }],
    })

    let pool: PaperRow[] = allRows
    if (ids.length) {
      const wanted = new Set(ids)
      pool = pool.filter((p) => wanted.has(p.id))
    } else {
      const allowed = SCOPE_STATUSES[scope]
      if (allowed.length) pool = pool.filter((p) => allowed.includes(p.status))
    }

    const scoped = scopeByTopic<PaperRow>(pool, topicRow)
    const picked = scoped.matched.slice(0, limit).map(({ item }) => item)

    if (picked.length === 0) {
      const parts: string[] = []
      parts.push(
        topicRow
          ? `课题「${topicRow.name}」下没有符合「${SCOPE_LABEL[scope]}」的论文。`
          : `没有符合「${SCOPE_LABEL[scope]}」的论文。`,
      )
      parts.push(scope === 'all' ? '请先在论文库导入文献。' : '可以把范围放宽到「全部论文」，或先去论文库把状态改过来。')
      return NextResponse.json({ error: parts.join(''), code: 'NO_CONTEXT' }, { status: 400 })
    }

    const payload = picked.map((p) => ({
      id: p.id,
      title: p.title,
      authors: p.authors,
      venue: p.venue,
      year: p.year,
      status: p.status,
      tags: p.tags,
      category: p.category,
      // 摘要是判断「这篇到底做了什么」最关键的原料；库里没有就如实留空
      abstract: (p.abstract || '').slice(0, ABSTRACT_LIMIT),
      current: { relevance: p.relevance, novelty: p.novelty, priority: p.priority },
    }))

    const systemPrompt =
      '你是一位通信/网络方向的资深研究者，负责给文献库里的论文评定「相关度、新颖度、阅读优先级」。'
      + NO_FABRICATION_GUARD
      + JSON_ONLY_GUARD

    const scopeLine = topicRow
      ? `研究课题：${topicRow.name}${topicRow.direction ? `（${topicRow.direction}）` : ''}${topicRow.description ? ` —— ${topicRow.description}` : ''}`
      : '研究课题：未指定（请按「通信/网络方向科研的一般价值」判断相关度）'

    const userPrompt = `请为下列 ${payload.length} 篇论文各自打分。

${scopeLine}
本批范围：${SCOPE_LABEL[scope]}

论文清单（id 必须逐字照抄）：
${JSON.stringify(payload, null, 2)}

打分口径：
- relevance：1-10 的整数，与上述课题的相关程度（未指定课题时按领域一般价值评）。
- novelty：1-10 的整数，问题或方法的新意。
- priority：high / medium / low，你建议的阅读优先级。
- reason：一句话中文理由（不超过 60 字），写清依据；**没有摘要时**就写「缺摘要，按题录判断」，不要凭印象补全方法细节或数值。

只输出这个形状（不要别的内容）：
{"scores":[{"id":"<清单里的 id>","relevance":8,"novelty":6,"priority":"high","reason":"…"}]}`

    let content: string
    try {
      content = await chatComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { timeoutMs: 180_000 },
      )
    } catch (e) {
      return llmFailureResponse(e, 'AI 打分失败')
    }

    // 模型输出不可信：这里做唯一的收口（id 白名单 + 数值夹紧 + 枚举归一）
    const parsed = parseScoreSuggestions(content, picked.map((p) => p.id))

    return NextResponse.json({
      success: true,
      suggestions: parsed.suggestions,
      // 清单之外/格式坏掉的部分如实回报，让界面能提醒用户
      unknownIds: parsed.unknownIds,
      malformed: parsed.malformed,
      used: {
        papers: picked.length,
        relatedPapers: scoped.matched.length,
        scope,
        scopeLabel: SCOPE_LABEL[scope],
        topicId: topicRow?.id ?? null,
        topicName: topicRow?.name ?? null,
      },
    })
  } catch (e) {
    console.error('AI paper score error', e)
    return NextResponse.json({ error: 'AI 打分失败: ' + (e as Error).message }, { status: 500 })
  }
}
