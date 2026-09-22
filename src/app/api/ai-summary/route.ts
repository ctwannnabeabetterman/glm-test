import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { METADATA_ONLY_GUARD, NO_FABRICATION_GUARD } from '@/lib/llm/prompts'
import { HEADING_LEVEL_RULE, OUTPUT_FORMAT_CONTRACT } from '@/lib/llm/format'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

// POST /api/ai-summary - generate AI summary for a paper using LLM skill
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { paperId, type } = body // type: 'summary' | 'keypoints' | 'questions' | 'relation'

    if (!paperId) {
      return NextResponse.json({ error: 'Missing paperId' }, { status: 400 })
    }

    const paper = await db.paper.findUnique({ where: { id: paperId } })
    if (!paper) {
      return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    }

    // 有没有摘要正文，决定了这个接口是「真摘要」还是「只能靠元数据推测」。
    // 2026-09-18 之前 Paper 模型压根没有摘要列，于是「快速摘要」在用户没写笔记时
    // 手里没有任何原料，模型只能编 —— 这是最隐蔽的一类幻觉。现在先看原料再决定口径。
    const abstractText = (paper.abstract || '').trim()
    const hasAbstract = abstractText.length > 0

    // Build prompt based on type
    const paperInfo = `
论文标题: ${paper.title}
作者: ${paper.authors}
期刊/会议: ${paper.venue}
年份: ${paper.year}
标签: ${paper.tags}
${hasAbstract ? `摘要原文:\n${abstractText}\n` : ''}现有笔记: ${paper.notes || '无'}
`.trim()

    // 有摘要 ⇒ 只需防编造（防止模型在摘要之外补充"细节"）；
    // 无摘要 ⇒ 必须显式告诉它「你看不到正文」，否则它会一本正经地编方法名和数值。
    const guard = hasAbstract ? NO_FABRICATION_GUARD : METADATA_ONLY_GUARD

    let systemPrompt = ''
    let userPrompt = ''

    switch (type) {
      case 'summary':
        systemPrompt = '你是一位通信领域的科研助手，擅长快速总结论文核心内容。请用简洁的中文回答，不要使用英文。' + guard
        userPrompt = hasAbstract
          ? `请基于下面这篇论文的**摘要原文**，生成一段简明摘要（150-200字），包括：研究问题、核心方法、主要贡献。

${paperInfo}

请按以下格式输出：
**研究问题**：...
**核心方法**：...
**主要贡献**：...`
          : `请为以下论文生成一段简明摘要（150-200字），包括：研究问题、核心方法、主要贡献。

${paperInfo}

请按以下格式输出：
**研究问题**：...
**核心方法**：...
**主要贡献**：...`
        break
      case 'keypoints':
        systemPrompt = '你是一位通信领域的科研助手，擅长提取论文关键信息。请用简洁的中文回答。' + guard
        userPrompt = `请为以下论文提取 5 个关键点，每个关键点用一句话概括。

${paperInfo}

格式：
1. ...
2. ...
3. ...
4. ...
5. ...`
        break
      case 'questions':
        systemPrompt = '你是一位通信领域的研究生导师，擅长引导学生思考。请用中文回答。' + guard
        userPrompt = `基于以下论文信息，提出 3 个深入思考问题，帮助研究生更好地理解这篇论文。

${paperInfo}

格式：
1. ...
2. ...
3. ...`
        break
      case 'relation':
        systemPrompt = '你是一位通信领域的科研助手，擅长分析论文之间的关联。请用中文回答。' + guard
        userPrompt = `基于以下论文信息，分析这篇论文可能对哪些研究方向有启发，以及可以和哪些类型的方法结合。

${paperInfo}

格式：
**可启发的研究方向**：
- ...
- ...

**可结合的方法**：
- ...
- ...

**潜在改进点**：
- ...`
        break
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    // 格式合同统一拼在这里，而不是散落到上面 4 个 case 里（漏一个就是一个面板格式失控）
    systemPrompt += `\n\n${OUTPUT_FORMAT_CONTRACT}\n${HEADING_LEVEL_RULE}`

    // 只包住 LLM 调用：取数据的 DB 查询出错应当是 500，不该被映射成「网关上游出错」
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
      return llmFailureResponse(e, 'AI 摘要失败')
    }

    // 把「这次的结论是基于摘要原文还是仅凭元数据」如实返回，
    // 前端据此提示用户「补上摘要后结果会更可靠」。
    void recordActivity({ module: 'paper', action: 'generate', title: `用 AI 生成了一段内容（${String(type)}）` })
    return NextResponse.json({ success: true, content, type, basedOn: hasAbstract ? 'abstract' : 'metadata' })
  } catch (e) {
    console.error('AI summary error', e)
    return NextResponse.json({ error: 'AI summary failed: ' + (e as Error).message }, { status: 500 })
  }
}
