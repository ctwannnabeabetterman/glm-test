import { chatComplete } from '@/lib/llm'
import { llmFailureResponse } from '@/lib/llm/http'
import { NO_FABRICATION_GUARD } from '@/lib/llm/prompts'
import { HEADING_LEVEL_RULE, OUTPUT_FORMAT_CONTRACT } from '@/lib/llm/format'
import { formatRetrievedForPrompt, retrieveRelatedPapers } from '@/lib/library/retrieval'
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
    // 语义化检索词：topic 直接用，paperId 用标题（比作者+年份命中率高得多）
    let retrievalQuery = ''

    if (topic) {
      context = `研究课题: ${topic}`
      retrievalQuery = String(topic)
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
${paper.abstract ? `摘要: ${paper.abstract.slice(0, 500)}` : ''}
`.trim()
      retrievalQuery = [paper.title, paper.tags].filter(Boolean).join(' ')
    } else {
      return NextResponse.json({ error: 'Missing topic or paperId' }, { status: 400 })
    }

    // Also gather user's existing papers for context
    const existingPapers = await db.paper.findMany({ take: 10, orderBy: [{ year: 'desc' }] })
    const existingContext = existingPapers.map((p) => `- ${p.title} (${p.year}, ${p.venue})`).join('\n')

    // —— 真实检索（只有 'papers' 类需要）——
    // 这一步把「模型凭记忆报论文名」换成「先查库、再让模型从查到的结果里挑」。
    // 检索失败不阻断流程：落回原来的纯生成路径，但会如实标注 source。
    let retrieved: Awaited<ReturnType<typeof retrieveRelatedPapers>> = []
    if (type === 'papers') {
      try {
        retrieved = await retrieveRelatedPapers(retrievalQuery, { limit: 8, timeoutMs: 12_000 })
      } catch {
        retrieved = []
      }
    }
    const retrievedBlock = formatRetrievedForPrompt(retrieved)

    switch (type) {
      case 'directions':
        systemPrompt = '你是一位通信领域的资深研究员，擅长推荐研究方向。请用中文回答，结构化输出。' + NO_FABRICATION_GUARD
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
- **难度评估**: 1-5 星（用数字标注，如 3/5）

### 方向 2: [标题]
...`
        break
      case 'papers':
        systemPrompt =
          '你是一位通信领域的文献专家。请用中文回答，结构化输出。' +
          (retrieved.length > 0
            ? '下面是本次**真实检索**到的候选文献清单（来自 Crossref，含真实 DOI）。' +
              '你只能从这份清单里挑选推荐，**不得**推荐清单之外的任何论文，' +
              '也**不得**修改清单里给出的标题、作者、年份、期刊或 DOI —— ' +
              '这些字段必须逐字照抄。你的工作是判断相关性并解释理由，不是回忆文献。'
            : NO_FABRICATION_GUARD)
        userPrompt = retrieved.length > 0
          ? `请从下面的候选文献中挑选 5 篇最值得阅读的，按相关度从高到低排列。

${context}

候选文献（真实检索结果，共 ${retrieved.length} 篇）:
${retrievedBlock}

请按以下格式输出：

## 推荐论文

### 论文 1: [照抄候选文献的标题]
- **作者**: [照抄]
- **年份**: [照抄]
- **期刊/会议**: [照抄]
- **DOI**: [照抄]
- **为什么推荐**: ...
- **优先级**: 高/中/低

### 论文 2: [照抄候选文献的标题]
...`
          : `基于以下信息，推荐 5 篇应该阅读的相关论文。

${context}

请按以下格式输出：

## 推荐论文

### 论文 1: [标题]
- **作者**: ...
- **年份**: ...
- **期刊/会议**: ...
- **为什么推荐**: ...
- **优先级**: 高/中/低
${NO_FABRICATION_GUARD.includes('需自行核实') ? '\n注意：本次未能连接文献数据库，以下内容基于模型知识，作者/年份/期刊请务必自行核实。' : ''}

### 论文 2: [标题]
...`
        break
      case 'methods':
        systemPrompt = '你是一位通信 AI 方法专家，擅长推荐技术方法。请用中文回答，结构化输出。' + NO_FABRICATION_GUARD
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
      return llmFailureResponse(e, 'AI 推荐失败')
    }

    // 把「这次是真实检索还是纯生成」如实回传，并在有检索时附带原始清单，
    // 用户可以直接点 DOI 去核实（不再只能相信模型的一面之词）。
    return NextResponse.json({
      success: true,
      content,
      type,
      source: retrieved.length > 0 ? 'crossref' : 'model-knowledge',
      retrieved,
    })
  } catch (e) {
    console.error('AI related papers error', e)
    return NextResponse.json({ error: 'AI failed: ' + (e as Error).message }, { status: 500 })
  }
}
