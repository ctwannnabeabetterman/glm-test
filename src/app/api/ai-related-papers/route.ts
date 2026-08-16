import { chatComplete } from '@/lib/llm'
import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// POST /api/ai-related-papers - AI-powered related paper recommendations
// Suggests research directions and related papers based on a topic or paper
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { topic, paperId, type } = body // type: 'directions' | 'papers' | 'methods'

    let context = ''
    let systemPrompt = ''
    let userPrompt = ''

    if (topic) {
      context = `研究课题: ${topic}`
    } else if (paperId) {
      const paper = await db.paper.findUnique({ where: { id: paperId } })
      if (!paper) return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
      context = `
论文标题: ${paper.title}
作者: ${paper.authors}
期刊: ${paper.venue}
年份: ${paper.year}
标签: ${paper.tags}
分类: ${paper.category}
`.trim()
    } else {
      return NextResponse.json({ error: 'Missing topic or paperId' }, { status: 400 })
    }

    // Also gather user's existing papers for context
    const existingPapers = await db.paper.findMany({ take: 10, orderBy: [{ year: 'desc' }] })
    const existingContext = existingPapers.map((p) => `- ${p.title} (${p.year}, ${p.venue})`).join('\n')

    switch (type) {
      case 'directions':
        systemPrompt = '你是一位通信领域的资深研究员，擅长推荐研究方向。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，推荐 5 个值得探索的相关研究方向。

${context}

用户已有论文:
${existingContext}

请按以下格式输出：

## 相关研究方向推荐

### 方向 1: [标题]
- **研究问题**: ...
- **为什么相关**: ...
- **建议方法**: ...
- **难度评估**: ⭐⭐⭐ (1-5星)

### 方向 2: [标题]
...`
        break
      case 'papers':
        systemPrompt = '你是一位通信领域的文献专家，擅长推荐相关论文。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，推荐 5 篇应该阅读的相关论文（可以是经典或最新论文）。

${context}

请按以下格式输出：

## 推荐论文

### 论文 1: [标题]
- **作者**: ...
- **年份**: ...
- **期刊/会议**: ...
- **为什么推荐**: ...
- **优先级**: 高/中/低

### 论文 2: [标题]
...`
        break
      case 'methods':
        systemPrompt = '你是一位通信 AI 方法专家，擅长推荐技术方法。请用中文回答，结构化输出。'
        userPrompt = `基于以下信息，推荐 5 种可以尝试的 AI/机器学习方法。

${context}

请按以下格式输出：

## 推荐方法

### 方法 1: [名称]
- **方法类型**: DRL/LSTM/Transformer/GNN/FL/其他
- **适用场景**: ...
- **优势**: ...
- **实现难度**: 高/中/低
- **参考框架**: PyTorch/Stable-Baselines3/其他

### 方法 2: [名称]
...`
        break
      default:
        return NextResponse.json({ error: 'Invalid type' }, { status: 400 })
    }

    const content = await chatComplete(
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      { timeoutMs: 180_000 }
    )

    return NextResponse.json({ success: true, content, type })
  } catch (e) {
    console.error('AI related papers error', e)
    return NextResponse.json({ error: 'AI failed: ' + (e as Error).message }, { status: 500 })
  }
}
