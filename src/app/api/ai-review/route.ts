import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/ai-review - AI-powered literature review generator
// Generates a complete literature review section based on user's papers
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topic, focus, language } = body

    if (!topic) {
      return NextResponse.json({ error: 'Missing topic' }, { status: 400 })
    }

    // Gather papers for context
    const papers = await db.paper.findMany({
      take: 15,
      orderBy: [{ year: 'desc' }, { relevance: 'desc' }],
    })

    const paperContext = papers.map((p) => ({
      title: p.title,
      authors: p.authors,
      venue: p.venue,
      year: p.year,
      tags: p.tags,
      category: p.category,
      status: p.status,
    }))

    const lang = language || 'en' // 'en' or 'zh'
    const focusText = focus || 'general' // 'general', 'method', 'gap', 'timeline'

    let focusInstruction = ''
    switch (focus) {
      case 'method':
        focusInstruction = '按方法类型分类（传统方法、监督学习、强化学习、其他AI方法），重点对比各方法的优缺点'
        break
      case 'gap':
        focusInstruction = '重点识别研究空白（Research Gap），每个子节末尾指出不足之处'
        break
      case 'timeline':
        focusInstruction = '按时间顺序梳理发展脉络，从早期方法到最新进展'
        break
      default:
        focusInstruction = '按方法类型分类，包含对比和不足分析'
    }

    const systemPrompt = lang === 'zh'
      ? `你是一位通信领域的文献综述专家，擅长撰写结构化的综述章节。请用中文撰写，使用学术风格。`
      : `You are an expert literature review writer in the telecommunications field. Write in academic English.`

    const userPrompt = lang === 'zh'
      ? `请为以下研究课题撰写一段文献综述（约 800-1000 字）：

研究课题: ${topic}
综述重点: ${focusInstruction}

用户论文库中的论文:
${JSON.stringify(paperContext, null, 2)}

请按以下结构输出：

## 2. 相关工作

### 2.1 传统方法
（用一段话概括传统方法的发展脉络，引用相关论文）

### 2.2 基于深度学习的方法
#### 2.2.1 监督学习方法
（论文A: 方法描述 → 优点 → 缺点）
（论文B: ...）

#### 2.2.2 强化学习方法
（论文C: ...）

### 2.3 现有方法的不足（Research Gap）
- Gap 1: ...
- Gap 2: ...
- Gap 3: ...

→ 自然地引出本文的工作

要求：
- 每篇论文引用格式：[作者, 年份]
- 对比要有标准维度（精度、复杂度、适用场景）
- Gap 要具体，不要泛泛而谈`
      : `Write a literature review section (~600-800 words) for the following research topic:

Topic: ${topic}
Focus: ${focusInstruction}

Papers from user's library:
${JSON.stringify(paperContext, null, 2)}

Structure:

## 2. Related Work

### 2.1 Traditional Methods
(summarize traditional approaches with citations)

### 2.2 Deep Learning-based Methods
#### 2.2.1 Supervised Learning Methods
(Paper A: method → advantages → limitations)

#### 2.2.2 Reinforcement Learning Methods
(Paper C: ...)

### 2.3 Research Gaps
- Gap 1: ...
- Gap 2: ...

Requirements:
- Citation format: [Author, Year]
- Compare on metrics: accuracy, complexity, applicability
- Gaps should be specific`

    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content, language: lang, focus })
  } catch (e) {
    console.error('AI review error', e)
    return NextResponse.json({ error: 'AI review failed: ' + (e as Error).message }, { status: 500 })
  }
}
