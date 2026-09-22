import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { NO_FABRICATION_GUARD } from '@/lib/llm/prompts'
import {
  AI_SCORE_JSON_CONTRACT,
  AI_SCORE_RUBRIC,
  ALL_SUB_ITEMS,
  buildScoreEvidence,
  extractJsonObject,
  interpretScorePayload,
} from '@/lib/methodology/topic-ai'
import { scopeByTopic } from '@/lib/methodology/topic-scope'
import { recordActivity } from '@/lib/activity'

/**
 * 行类型显式声明（理由同 ai-gap-analysis：Prisma 的 findMany 返回递归泛型，
 * TS 匹配 `T extends Scopable` 时会放弃推断 T 并退回约束，导致取字段报 TS2339）。
 */
type PaperRow = {
  id: string
  title: string
  venue: string
  year: number
  tags: string
  abstract: string
  topicIds: string
}

type NoteRow = {
  id: string
  title: string
  content: string
  tags: string
  topicIds: string
}

/**
 * POST /api/ai-topic-score —— 用 AI 给一个课题的评分矩阵预填分数。
 *
 * 设计要点（2026-09-18 用户反馈「打分应该是 AI 打的吧，自己打分有点难」）：
 *
 * 1. **不是「AI 替你决定课题好坏」**，而是「AI 先把 14 项铺好，你只改不认同的」。
 *    所以这里**只算分、不落库** —— 落库由前端拿到结果后走既有的 PUT /api/topics/[id]，
 *    用户改过哪几项、什么时候改的，都还在同一条数据路径上。
 *
 * 2. **打分依据限本课题**：用 `scopeByTopic` 拿「挂在本课题下的论文 + 关键词命中的论文」
 *    作为证据。拿全库数据让模型给某个课题打分，它会把别的方向的趋势算进来
 *    （正是用户抱怨的「互相干扰」）。
 *
 * 3. **提示词用 JSON 契约而不是 OUTPUT_FORMAT_CONTRACT**：那条合同约束的是
 *    「给人看的 Markdown」，这里要的是「给程序解析的 JSON」，两者互斥 ——
 *    同时拼上去，模型会用 Markdown 表格回答，解析必然失败。
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const topicId = typeof body.topicId === 'string' ? body.topicId.trim() : ''

    // 「还没存库就想先看看 AI 怎么打」的场景：允许直接传 name/description 试算。
    // 但必须有 topicId 或 name 之一，否则无从下手。
    const nameInput = typeof body.name === 'string' ? body.name.trim() : ''
    if (!topicId && !nameInput) {
      return NextResponse.json({ error: '缺少课题：请提供 topicId，或至少填写课题名称' }, { status: 400 })
    }

    // 类型必须显式标注：`let topic = null` 会被推断成 `null`，后面取属性即 never。
    const topic: Awaited<ReturnType<typeof db.topic.findUnique>> = topicId
      ? await db.topic.findUnique({ where: { id: topicId } })
      : null

    // 允许前端只传 name/description（新增课题时的「先打分再保存」）
    const topicInfo = {
      id: topic?.id ?? topicId ?? 'preview',
      name: topic?.name ?? nameInput,
      direction: topic?.direction ?? (typeof body.direction === 'string' ? body.direction : ''),
      description: topic?.description ?? (typeof body.description === 'string' ? body.description : ''),
    }

    // 依据：本课题相关的论文与笔记。取全量、在应用层按课题域筛，
    // 不能用 take(20)+年份排序 —— 那会把本课题的老论文挤掉（旧的错误做法）。
    const [allPapers, allNotes] = await Promise.all([
      db.paper.findMany({
        select: { id: true, title: true, venue: true, year: true, tags: true, abstract: true, topicIds: true },
        orderBy: [{ year: 'desc' }],
        take: 200,
      }),
      db.note.findMany({
        select: { id: true, title: true, content: true, tags: true, topicIds: true },
        orderBy: [{ updatedAt: 'desc' }],
        take: 120,
      }),
    ])

    const paperScope = scopeByTopic<PaperRow>(allPapers, topicId ? topicInfo : null)
    const noteScope = scopeByTopic<NoteRow>(allNotes, topicId ? topicInfo : null)

    const evidence = buildScoreEvidence(
      paperScope.matched.slice(0, 40).map(({ item }) => ({
        title: item.title,
        venue: item.venue,
        year: item.year,
        tags: item.tags,
        abstract: item.abstract,
      })),
      noteScope.matched.slice(0, 20).map(({ item }) => ({ title: item.title, content: item.content }))
    )

    const evidenceBlock = evidence.text
      ? evidence.text
      : '（这个课题目前没有关联论文或笔记）'

    const systemPrompt =
      '你是通信与智能网络领域的科研选题评估专家。你的任务是按给定的评分矩阵，' +
      `为一个研究课题打出 ${ALL_SUB_ITEMS.length} 个细项的初始分，供研究者修改。` +
      '打分要拉开差距、避免一律给中间分；没有把握的项也要给出估计分，' +
      '但必须在 rationale 里说明它是估计。' +
      NO_FABRICATION_GUARD +
      `\n\n${AI_SCORE_RUBRIC}\n\n${AI_SCORE_JSON_CONTRACT}`

    const userPrompt = `课题名称：${topicInfo.name}
研究方向：${topicInfo.direction || '（未填）'}
课题描述：${topicInfo.description || '（未填）'}

可参考的本地资料（${evidence.paperCount} 篇论文、${evidence.noteCount} 条笔记）：
${evidenceBlock}

请按评分矩阵给这 ${ALL_SUB_ITEMS.length} 个细项打分，并只输出约定的 JSON。`

    let content: string
    try {
      content = await chatComplete(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        { timeoutMs: 180_000, maxTokens: 3000, temperature: 0.3 }
      )
    } catch (e) {
      return llmFailureResponse(e, 'AI 打分失败')
    }

    const parsed = extractJsonObject(content)
    const result = interpretScorePayload(parsed)

    // 模型连 JSON 都没吐出来：这属于「上游可用但输出不可用」，
    // 不能回 200 让前端把一整套 5 分当 AI 结果写进库（用户会以为 AI 认为全项中等）。
    if (!parsed) {
      return NextResponse.json(
        {
          error: 'AI 未能返回可解析的评分结果，请重试（若反复失败，可在设置里换一个模型）',
          code: 'LLM_BAD_OUTPUT',
          raw: content.slice(0, 800),
        },
        { status: 502 }
      )
    }

    // 一项都没解析出来同样不该冒充成功
    if (result.scored === 0) {
      return NextResponse.json(
        {
          error: 'AI 返回了内容但没有任何可识别的评分子项，请重试',
          code: 'LLM_BAD_OUTPUT',
          raw: content.slice(0, 800),
        },
        { status: 502 }
      )
    }

    void recordActivity({ module: 'topic', action: 'generate', title: '给选题打了分' })
    return NextResponse.json({
      success: true,
      topicId: topicInfo.id,
      scores: result.scores,
      totalScore: result.totalScore,
      scored: result.scored,
      missing: result.missing,
      rationale: result.rationale,
      evidence: {
        paperCount: evidence.paperCount,
        noteCount: evidence.noteCount,
        // 未归到本课题的条目数 —— 让用户知道「还有料没挂到这个课题上」
        unlinkedPapers: paperScope.unmatched,
        unlinkedNotes: noteScope.unmatched,
      },
    })
  } catch (e) {
    console.error('AI topic score error', e)
    return NextResponse.json({ error: 'AI 打分失败: ' + (e as Error).message }, { status: 500 })
  }
}
