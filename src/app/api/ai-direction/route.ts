import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { chatComplete } from '@/lib/llm'

/** POST /api/ai-direction —— 方向探索：基于本地论文/课题库检查重复度与创新空间 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const candidate = typeof body.candidate === 'string' ? body.candidate.trim() : ''
    if (!candidate) return NextResponse.json({ error: '请输入候选研究方向' }, { status: 400 })

    const [papers, topics] = await Promise.all([
      db.paper.findMany({ take: 80, orderBy: [{ year: 'desc' }], select: { title: true, authors: true, venue: true, year: true, tags: true, category: true } }),
      db.topic.findMany({ select: { name: true, direction: true, description: true, totalScore: true } }),
    ])
    const context = JSON.stringify({ papers, topics }, null, 2)
    const content = await chatComplete([
      {
        role: 'system',
        content: '你是通信与智能网络领域的科研选题导师。必须基于提供的本地数据回答，不能假装查阅未提供的论文。请用中文、结构化、审慎地评估候选方向。',
      },
      {
        role: 'user',
        content: `候选研究方向：\n${candidate}\n\n本地论文与课题库：\n${context}\n\n请严格按以下结构回答：\n## 1. 重复度检查\n- 与本地课题/论文的相似项：\n- 重复风险：低/中/高（说明证据）\n## 2. 创新性拆解\n分别判断问题新、方法新、场景新、组合新，并指出最值得形成贡献的一项。\n## 3. 可落地的研究问题\n给出 2-3 个可验证、边界清晰的问题。\n## 4. 建议实验与对照\n给出基线、数据/仿真、指标和消融。\n## 5. 写作时的贡献表述\n给出 2-3 条避免夸大、可以被实验支撑的 contribution 草案。\n## 6. 结论\n给出：建议继续 / 缩小范围后继续 / 暂缓，并说明下一步。`,
      },
    ], { timeoutMs: 180_000, maxTokens: 5000 })
    return NextResponse.json({ success: true, candidate, content })
  } catch (e) {
    console.error('AI direction error', e)
    return NextResponse.json({ error: '方向探索失败: ' + (e as Error).message }, { status: 500 })
  }
}
