import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { NO_FABRICATION_GUARD } from '@/lib/llm/prompts'
import { HEADING_LEVEL_RULE, OUTPUT_FORMAT_CONTRACT } from '@/lib/llm/format'
import { formatTopicScope, scopeByTopic } from '@/lib/methodology/topic-scope'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

/** 不带课题时，上下文里最多放多少条 —— 防止课题一多把提示词撑爆 */
const GLOBAL_PAPER_LIMIT = 60
const GLOBAL_NOTE_LIMIT = 30
/** 指定课题时最多放多少条：宁可全给，也不要在课题内部再截断 */
const SCOPED_PAPER_LIMIT = 60
const SCOPED_NOTE_LIMIT = 40

/**
 * 行类型显式声明，不用 `Awaited<ReturnType<typeof db.paper.findMany>>`。
 *
 * 原因（已踩）：Prisma 的 `findMany` 返回类型是层层展开的递归泛型，
 * TS 在把它匹配到 `scopeByTopic<T extends Scopable>` 时会**放弃推断 T**、
 * 直接退回约束 `Scopable`，于是 `scope.matched[i].item.venue` 报 TS2339。
 * 显式写出行形状并作为类型参数传给 `scopeByTopic<PaperRow>`，推断才有依据。
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

type NoteRow = {
  id: string
  title: string
  tags: string
  content: string
  topicIds: string
}

/**
 * POST /api/ai-gap-analysis —— 基于课题域的 AI 研究分析。
 *
 * 2026-09-18 用户反馈：「AI 研究分析应该要加一个课题选择，多个同时分析内容少不说，
 * 还容易在课题多了以后互相干扰」。原实现有三个叠加的问题：
 *
 *  1. 请求体只有 `{ type }` —— **没有课题维度**，所有分析都是对全库做的；
 *  2. `topic.findMany()` 把全部课题塞进上下文，方向一多模型注意力被摊薄；
 *  3. `paper.findMany({ take: 20, orderBy: year desc })` 取「全库最新 20 篇」，
 *     既与课题无关，又会把本课题相关但年份较老的文献直接挤掉。
 *
 * 现在：请求体带 `topicId`（空/缺省 = 全库综合分析，保留旧能力），
 * 论文与笔记都经 `scopeByTopic` 按课题域筛（手挂优先 + 关键词兜底），
 * 并且**按相关度取而不是按年份取** —— 年级别不再是「谁进来」的决定因素。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type } = body // type: 'gaps' | 'opportunities' | 'literature'
    const topicId = typeof body.topicId === 'string' ? body.topicId.trim() : ''

    if (type !== 'gaps' && type !== 'opportunities' && type !== 'literature') {
      return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    // 显式选了课题却查不到（已被删掉）：如实报错，不要静默降级成全库分析 ——
    // 那样用户会以为「这个课题的分析结果」其实混着全库内容。
    // 类型必须显式标注：`let topic = null` 会被推断成 `null`，
    // 后面 `topic?.name` 就成了 never（TS2339）。
    let topic: Awaited<ReturnType<typeof db.topic.findUnique>> = null
    if (topicId) {
      topic = await db.topic.findUnique({ where: { id: topicId } })
      if (!topic) {
        return NextResponse.json({ error: '所选课题不存在（可能已被删除），请重新选择' }, { status: 400 })
      }
    }

    const topics = topic ? [topic] : await db.topic.findMany()

    // 取全量后在应用层按课题域筛：SQLite 里没有 JSON 数组的包含查询，
    // 且数据量在千条级，全量取 + 内存筛比在 SQL 里拼 LIKE 更准（LIKE 会误命中子串）。
    const [allPapers, allNotes] = await Promise.all([
      db.paper.findMany({
        select: {
          id: true, title: true, authors: true, venue: true, year: true,
          tags: true, category: true, status: true, relevance: true,
          abstract: true, topicIds: true,
        },
        orderBy: [{ year: 'desc' }],
      }),
      db.note.findMany({
        select: { id: true, title: true, tags: true, content: true, topicIds: true },
        orderBy: [{ updatedAt: 'desc' }],
      }),
    ])

    const paperScope = scopeByTopic<PaperRow>(allPapers, topic)
    const noteScope = scopeByTopic<NoteRow>(allNotes, topic)

    const paperLimit = topic ? SCOPED_PAPER_LIMIT : GLOBAL_PAPER_LIMIT
    const noteLimit = topic ? SCOPED_NOTE_LIMIT : GLOBAL_NOTE_LIMIT

    // 相关度排序：手挂的（linked）优先，其次关键词命中的；同组内保持传入顺序
    // （论文已按年份降序进来，组内仍是「新的在前」）。
    const paperContext = paperScope.matched.slice(0, paperLimit).map(({ item, reason }) => ({
      title: item.title,
      authors: item.authors,
      venue: item.venue,
      year: item.year,
      tags: item.tags,
      category: item.category,
      status: item.status,
      relevance: item.relevance,
      // 摘要是判断「这篇到底做了什么」最关键的原料；此前完全没喂给模型
      abstract: (item.abstract || '').slice(0, 300),
      // 标明这条是靠「已挂到本课题」还是「关键词命中」进来的，让模型知道证据强度
      matchedBy: reason === 'linked' ? '已挂到本课题' : '关键词匹配',
    }))

    const topicContext = topics.map((t) => ({
      name: t.name,
      direction: t.direction,
      description: t.description,
      totalScore: t.totalScore,
    }))

    const noteContext = noteScope.matched.slice(0, noteLimit).map(({ item }) => ({
      title: item.title,
      tags: item.tags,
      content: (item.content || '').slice(0, 300),
    }))

    const scopeHeader = topic
      ? `本次分析范围：**仅限课题「${topic.name}」**（如需跨课题综合，请在上方切换为「全库综合分析」）。`
      : '本次分析范围：**全部课题的综合分析**（未指定单课题）。'

    const context = `
${scopeHeader}

研究课题:
${formatTopicScope(topics)}

已读论文（${paperContext.length} 篇，共 ${paperScope.matched.length} 篇与本范围相关）:
${JSON.stringify(paperContext, null, 2)}

科研笔记（${noteContext.length} 条）:
${JSON.stringify(noteContext, null, 2)}
`.trim()

    // 没有原料时不能硬编 —— 让模型基于「课题名 + 空论文库」产出 research gap，
    // 它只能凭记忆编，而这正是防编造约束要拦的事。直接如实拒绝更负责。
    if (paperContext.length === 0 && noteContext.length === 0) {
      return NextResponse.json(
        {
          error: topic
            ? `课题「${topic.name}」下还没有关联的论文或笔记。请先在文献库给论文挂上这个课题（或在课题描述里补充关键词），再回来分析。`
            : '论文库与笔记都还是空的，暂时没有可供分析的材料。请先导入或新增一些文献。',
          code: 'NO_CONTEXT',
        },
        { status: 400 }
      )
    }

    let systemPrompt = ''
    let userPrompt = ''

    switch (type) {
      case 'gaps':
        systemPrompt = '你是一位通信领域的资深研究员，擅长发现研究空白（Research Gap）。请用中文回答，结构化输出。' + NO_FABRICATION_GUARD
        userPrompt = `基于以下科研数据，分析当前研究方向中可能存在的研究空白（Research Gaps）。

${context}

请按以下格式输出 3-5 个研究空白：

## 研究空白分析

### 空白 1: [标题]
- **问题描述**: ...
- **现有不足**: ...
- **潜在方向**: ...
- **相关论文**: ...

### 空白 2: [标题]
...`
        break
      case 'opportunities':
        systemPrompt = '你是一位通信领域的科研顾问，擅长识别研究机会和创新点。请用中文回答，结构化输出。' + NO_FABRICATION_GUARD
        userPrompt = `基于以下科研数据，分析可能的研究机会和创新点。

${context}

请按以下格式输出 3-5 个研究机会：

## 研究机会分析

### 机会 1: [标题]
- **创新类型**: 问题新/方法新/场景新/组合新
- **机会描述**: ...
- **可行性评估**: 高/中/低
- **建议方法**: ...
- **预期贡献**: ...

### 机会 2: [标题]
...`
        break
      case 'literature':
        systemPrompt = '你是一位通信领域的文献综述专家，擅长梳理文献脉络。请用中文回答，结构化输出。' + NO_FABRICATION_GUARD
        userPrompt = `基于以下科研数据，生成文献综述框架。

${context}

请按以下格式输出文献综述大纲：

## 文献综述框架

### 1. 引言
- 研究背景: ...
- 研究意义: ...

### 2. 传统方法
- 方法分类: ...
- 代表性工作: ...

### 3. AI 方法
- 监督学习方法: ...
- 强化学习方法: ...
- 其他方法: ...

### 4. 研究空白与挑战
- Gap 1: ...
- Gap 2: ...

### 5. 本文工作
- 研究问题: ...
- 主要贡献: ...`
        break
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    // 格式合同统一拼在这里，而不是散落到上面 3 个 case 里（漏一个就是一个面板格式失控）
    systemPrompt += `\n\n${OUTPUT_FORMAT_CONTRACT}\n${HEADING_LEVEL_RULE}`

    let content: string
    try {
      content = await chatComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { timeoutMs: 180_000 }
      )
    } catch (e) {
      return llmFailureResponse(e, 'AI 分析失败')
    }

    return NextResponse.json({
      success: true,
      content,
      type,
      topicId: topic?.id ?? null,
      topicName: topic?.name ?? null,
      // 回传本次实际用到的原料量 —— 前端据此显示「基于 N 篇论文、M 条笔记」，
      // 用户才能判断这次的结论有多实（以前完全看不到，只能凭感觉）。
      used: {
        papers: paperContext.length,
        notes: noteContext.length,
        relatedPapers: paperScope.matched.length,
        unlinkedPapers: paperScope.unmatched,
      },
    })
  } catch (e) {
    console.error('AI gap analysis error', e)
    return NextResponse.json({ error: 'AI analysis failed: ' + (e as Error).message }, { status: 500 })
  }
}
