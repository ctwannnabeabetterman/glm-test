import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/ai-gap-analysis - AI-powered research gap analysis
// Analyzes papers, topics, and notes to identify research gaps
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topicId, type } = body // type: 'gaps' | 'opportunities' | 'literature'

    // Gather context data
    const papers = await db.paper.findMany({ take: 20, orderBy: [{ year: 'desc' }] })
    const topics = await db.topic.findMany()
    const notes = await db.note.findMany({ take: 10 })

    // Build context from papers
    const paperContext = papers.map((p) => ({
      title: p.title,
      authors: p.authors,
      venue: p.venue,
      year: p.year,
      tags: p.tags,
      category: p.category,
      status: p.status,
    }))

    // Build context from topics
    const topicContext = topics.map((t) => ({
      name: t.name,
      direction: t.direction,
      description: t.description,
      totalScore: t.totalScore,
    }))

    // Build context from notes
    const noteContext = notes.map((n) => ({
      title: n.title,
      tags: n.tags,
      content: n.content.slice(0, 200),
    }))

    const context = `
研究课题:
${JSON.stringify(topicContext, null, 2)}

已读论文:
${JSON.stringify(paperContext, null, 2)}

科研笔记:
${JSON.stringify(noteContext, null, 2)}
`.trim()

    let systemPrompt = ''
    let userPrompt = ''

    switch (type) {
      case 'gaps':
        systemPrompt = '你是一位通信领域的资深研究员，擅长发现研究空白（Research Gap）。请用中文回答，结构化输出。'
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
        systemPrompt = '你是一位通信领域的科研顾问，擅长识别研究机会和创新点。请用中文回答，结构化输出。'
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
        systemPrompt = '你是一位通信领域的文献综述专家，擅长梳理文献脉络。请用中文回答，结构化输出。'
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

    // Use z-ai-web-dev-sdk
    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content, type })
  } catch (e) {
    console.error('AI gap analysis error', e)
    return NextResponse.json({ error: 'AI analysis failed: ' + (e as Error).message }, { status: 500 })
  }
}
