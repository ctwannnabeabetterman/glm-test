import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'

// POST /api/ai-abstract - AI-powered abstract generation
// Generates a 4-sentence abstract based on paper title and context
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { title, authors, venue, method, problem, contribution } = body

    if (!title) {
      return NextResponse.json({ error: 'Missing title' }, { status: 400 })
    }

    const context = `
论文标题: ${title}
作者: ${authors || '未提供'}
期刊/会议: ${venue || '未提供'}
研究方法: ${method || '未提供'}
研究问题: ${problem || '未提供'}
主要贡献: ${contribution || '未提供'}
`.trim()

    const systemPrompt = `你是一位通信领域的学术论文写作专家，擅长撰写符合 IEEE 会议/期刊标准的摘要。请用英文撰写摘要，遵循四句话结构：
1. 背景句：阐述领域重要性和研究问题
2. 问题句：指出现有方法的不足 (However, ...)
3. 方法句：描述本文提出的方法 (In this paper, we propose...)
4. 结果句：说明实验结果和性能提升 (Simulation results show...)

要求：
- 使用学术英语
- 每句话不超过25个词
- 总词数 150-200
- 不使用第一人称复数以外的代词
- 包含具体数字（如果提供了贡献信息）`

    const userPrompt = `请为以下论文生成一个 4 句话的英文摘要：

${context}

请按以下格式输出：

**Abstract:**
[背景句] [问题句] [方法句] [结果句]

**中文翻译:**
[中文翻译]`

    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content })
  } catch (e) {
    console.error('AI abstract error', e)
    return NextResponse.json({ error: 'AI abstract failed: ' + (e as Error).message }, { status: 500 })
  }
}
