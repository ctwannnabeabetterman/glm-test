import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

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

    // Build prompt based on type
    const paperInfo = `
论文标题: ${paper.title}
作者: ${paper.authors}
期刊/会议: ${paper.venue}
年份: ${paper.year}
标签: ${paper.tags}
现有笔记: ${paper.notes || '无'}
`.trim()

    let systemPrompt = ''
    let userPrompt = ''

    switch (type) {
      case 'summary':
        systemPrompt = '你是一位通信领域的科研助手，擅长快速总结论文核心内容。请用简洁的中文回答，不要使用英文。'
        userPrompt = `请为以下论文生成一段简明摘要（150-200字），包括：研究问题、核心方法、主要贡献。

${paperInfo}

请按以下格式输出：
**研究问题**：...
**核心方法**：...
**主要贡献**：...`
        break
      case 'keypoints':
        systemPrompt = '你是一位通信领域的科研助手，擅长提取论文关键信息。请用简洁的中文回答。'
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
        systemPrompt = '你是一位通信领域的研究生导师，擅长引导学生思考。请用中文回答。'
        userPrompt = `基于以下论文信息，提出 3 个深入思考问题，帮助研究生更好地理解这篇论文。

${paperInfo}

格式：
❓ 问题1：...
❓ 问题2：...
❓ 问题3：...`
        break
      case 'relation':
        systemPrompt = '你是一位通信领域的科研助手，擅长分析论文之间的关联。请用中文回答。'
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

    // Use z-ai-web-dev-sdk to generate summary
    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content, type })
  } catch (e) {
    console.error('AI summary error', e)
    return NextResponse.json({ error: 'AI summary failed: ' + (e as Error).message }, { status: 500 })
  }
}
