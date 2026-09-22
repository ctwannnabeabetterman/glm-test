import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { scopeByTopic } from '@/lib/methodology/topic-scope'
import { recordActivity } from '@/lib/activity'

/** 行类型显式声明（理由同 AI 路由：Prisma 的 findMany 返回递归泛型，T 推断会掉） */
type PaperRow = { id: string; title: string; tags: string; abstract: string; topicIds: string }
type NoteRow = { id: string; title: string; tags: string; content: string; topicIds: string }

/**
 * GET /api/topics —— 课题列表。
 *
 * `?withCounts=1` 时给每个课题附带「已挂多少篇论文 / 多少条笔记」。
 * 为什么要这个：AI 研究分析与 AI 打分都是**按课题域**取料的，
 * 一个没挂任何文献的课题点了分析只会得到一句「没有材料」。
 * 与其让用户点到才发现，不如在选题评估页就显示出来「这个课题有多少料」。
 */
export async function GET(request: NextRequest) {
  try {
    const withCounts = request.nextUrl.searchParams.get('withCounts') === '1'
    const topics = await db.topic.findMany({ orderBy: [{ totalScore: 'desc' }] })

    if (!withCounts) return NextResponse.json(topics)

    const [papers, notes] = await Promise.all([
      db.paper.findMany({ select: { id: true, title: true, tags: true, abstract: true, topicIds: true } }),
      db.note.findMany({ select: { id: true, title: true, tags: true, content: true, topicIds: true } }),
    ])

    // 逐个课题跑一遍筛选逻辑（与 AI 路由用的是同一个 scopeByTopic），
    // 保证「这里显示有几篇」和「AI 实际用了几篇」不会对不上。
    const enriched = topics.map((t) => {
      const scopeInput = { id: t.id, name: t.name, direction: t.direction, description: t.description }
      return {
        ...t,
        paperCount: scopeByTopic<PaperRow>(papers, scopeInput).matched.length,
        noteCount: scopeByTopic<NoteRow>(notes, scopeInput).matched.length,
      }
    })

    return NextResponse.json(enriched)
  } catch (e) {
    console.error('GET topics error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const topic = await db.topic.create({
      data: {
        name: body.name,
        direction: body.direction || '',
        description: body.description || '',
        scores: body.scores || '{}',
        totalScore: body.totalScore ? Number(body.totalScore) : 0,
      },
    })
    void recordActivity({ module: 'topic', action: 'create', title: `新建了选题「${topic.name}」`, refId: topic.id })
    return NextResponse.json(topic, { status: 201 })
  } catch (e) {
    console.error('POST topics error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
