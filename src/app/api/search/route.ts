import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/search?q=query - global search across papers, topics, notes, experiments
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const q = searchParams.get('q')?.toLowerCase().trim() || ''

    if (!q || q.length < 1) {
      return NextResponse.json({ results: [], total: 0 })
    }

    const results: Array<{
      id: string
      type: 'paper' | 'topic' | 'note' | 'experiment'
      title: string
      subtitle: string
      meta: string
      tags?: string
    }> = []

    // Search papers
    const papers = await db.paper.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { authors: { contains: q } },
          { venue: { contains: q } },
          { tags: { contains: q } },
          { notes: { contains: q } },
        ],
      },
      take: 10,
    })
    for (const p of papers) {
      results.push({
        id: p.id,
        type: 'paper',
        title: p.title,
        subtitle: `${p.authors || 'Unknown'} · ${p.venue || 'N/A'} · ${p.year}`,
        meta: `论文 · ${p.status === 'read' ? '已读' : p.status === 'reading' ? '阅读中' : '未读'}`,
        tags: p.tags,
      })
    }

    // Search topics
    const topics = await db.topic.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { description: { contains: q } },
          { direction: { contains: q } },
        ],
      },
      take: 5,
    })
    for (const t of topics) {
      results.push({
        id: t.id,
        type: 'topic',
        title: t.name,
        subtitle: t.description || t.direction || '',
        meta: `课题 · 评分 ${t.totalScore.toFixed(1)}`,
      })
    }

    // Search notes
    const notes = await db.note.findMany({
      where: {
        OR: [
          { title: { contains: q } },
          { content: { contains: q } },
          { tags: { contains: q } },
        ],
      },
      take: 10,
    })
    for (const n of notes) {
      results.push({
        id: n.id,
        type: 'note',
        title: n.title,
        subtitle: n.content.replace(/[#*`\[\]]/g, '').slice(0, 80),
        meta: `笔记 · ${n.category}`,
        tags: n.tags,
      })
    }

    // Search experiments
    const experiments = await db.experiment.findMany({
      where: {
        OR: [
          { name: { contains: q } },
          { topic: { contains: q } },
          { notes: { contains: q } },
        ],
      },
      take: 5,
    })
    for (const e of experiments) {
      results.push({
        id: e.id,
        type: 'experiment',
        title: e.name,
        subtitle: e.topic || '',
        meta: `实验 · ${e.status}`,
      })
    }

    return NextResponse.json({ results, total: results.length })
  } catch (e) {
    console.error('Search error', e)
    return NextResponse.json({ error: 'Search failed' }, { status: 500 })
  }
}
