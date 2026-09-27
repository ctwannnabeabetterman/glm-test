import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/graph - get knowledge graph data (nodes + edges)
// Nodes: papers, topics, notes
// Edges: topic->paper (by tag matching), note->paper (by tag matching), paper->paper (same category)
export async function GET() {
  try {
    const [paperRows, topicRows, noteRows] = await Promise.all([
      db.paper.findMany({ take: 101, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, year: true, venue: true, relevance: true, novelty: true, authors: true, tags: true, category: true } }),
      db.topic.findMany({ take: 21, orderBy: { updatedAt: 'desc' }, select: { id: true, name: true, totalScore: true, direction: true } }),
      db.note.findMany({ take: 61, orderBy: { updatedAt: 'desc' }, select: { id: true, title: true, category: true, content: true, tags: true } }),
    ])
    const truncated = paperRows.length > 100 || topicRows.length > 20 || noteRows.length > 60
    const papers = paperRows.slice(0, 100)
    const topics = topicRows.slice(0, 20)
    const notes = noteRows.slice(0, 60)

    type Node = {
      id: string
      label: string
      type: 'paper' | 'topic' | 'note'
      weight: number
      meta?: string
    }
    type Edge = {
      source: string
      target: string
      type: string
      weight: number
    }

    const nodes: Node[] = []
    const edges: Edge[] = []

    // Add paper nodes
    for (const p of papers) {
      nodes.push({
        id: `paper-${p.id}`,
        label: p.title.length > 40 ? p.title.slice(0, 38) + '..' : p.title,
        type: 'paper',
        weight: p.relevance + p.novelty,
        meta: `${p.year} · ${p.venue}`,
      })
    }

    // Add topic nodes
    for (const t of topics) {
      nodes.push({
        id: `topic-${t.id}`,
        label: t.name,
        type: 'topic',
        weight: t.totalScore * 2,
        meta: t.direction,
      })
    }

    // Add note nodes
    for (const n of notes) {
      nodes.push({
        id: `note-${n.id}`,
        label: n.title.length > 30 ? n.title.slice(0, 28) + '..' : n.title,
        type: 'note',
        weight: 8,
        meta: n.category,
      })
    }

    // Build edges: topic -> paper (by tag matching)
    for (const t of topics) {
      const topicWords = t.name.toLowerCase().split(/[\s,，、]+/).filter((w) => w.length > 2)
      for (const p of papers) {
        const paperText = `${p.title} ${p.tags} ${p.authors}`.toLowerCase()
        // Check if any topic word matches paper
        const matches = topicWords.some((w) => paperText.includes(w))
        if (matches) {
          edges.push({
            source: `topic-${t.id}`,
            target: `paper-${p.id}`,
            type: 'topic-paper',
            weight: 1,
          })
        }
      }
    }

    // Build edges: note -> paper (by tag matching)
    for (const n of notes) {
      const noteText = `${n.title} ${n.content} ${n.tags}`.toLowerCase()
      for (const p of papers) {
        const paperText = `${p.title} ${p.authors}`.toLowerCase()
        // Check if paper title words appear in note
        const titleWords = p.title.toLowerCase().split(/\s+/).filter((w) => w.length > 4)
        const matches = titleWords.some((w) => noteText.includes(w))
        if (matches) {
          edges.push({
            source: `note-${n.id}`,
            target: `paper-${p.id}`,
            type: 'note-paper',
            weight: 1,
          })
        }
      }
    }

    // 限定每篇论文的相似邻居，避免同分类时输出 N² 条边压垮布局计算。
    const paperTags = papers.map((paper) => new Set((paper.tags || '').split(',').map((tag) => tag.trim().toLowerCase()).filter(Boolean)))
    for (let i = 0; i < papers.length; i++) {
      let neighbors = 0
      for (let j = i + 1; j < papers.length && neighbors < 5; j++) {
        const sharedTags = [...paperTags[i]].filter((tag) => paperTags[j].has(tag))
        if (sharedTags.length) {
          edges.push({ source: `paper-${papers[i].id}`, target: `paper-${papers[j].id}`, type: 'shared-tag', weight: sharedTags.length })
          neighbors++
        } else if (papers[i].category && papers[i].category === papers[j].category) {
          edges.push({ source: `paper-${papers[i].id}`, target: `paper-${papers[j].id}`, type: 'same-category', weight: 0.5 })
          neighbors++
        }
      }
    }

    return NextResponse.json({
      nodes,
      edges,
      stats: {
        truncated,
        totalNodes: nodes.length,
        totalEdges: edges.length,
        papers: papers.length,
        topics: topics.length,
        notes: notes.length,
      },
    })
  } catch (e) {
    console.error('Graph error', e)
    return NextResponse.json({ error: 'Failed to build graph' }, { status: 500 })
  }
}
