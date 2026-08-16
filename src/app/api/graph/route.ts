import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/graph - get knowledge graph data (nodes + edges)
// Nodes: papers, topics, notes
// Edges: topic->paper (by tag matching), note->paper (by tag matching), paper->paper (same category)
export async function GET() {
  try {
    const [papers, topics, notes] = await Promise.all([
      db.paper.findMany(),
      db.topic.findMany(),
      db.note.findMany(),
    ])

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

    // Build edges: paper -> paper (same category or shared tags)
    for (let i = 0; i < papers.length; i++) {
      for (let j = i + 1; j < papers.length; j++) {
        const p1 = papers[i]
        const p2 = papers[j]
        // Same category
        if (p1.category && p1.category === p2.category) {
          edges.push({
            source: `paper-${p1.id}`,
            target: `paper-${p2.id}`,
            type: 'same-category',
            weight: 0.5,
          })
        }
        // Shared tags
        const tags1 = (p1.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        const tags2 = (p2.tags || '').split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
        const sharedTags = tags1.filter((t) => tags2.includes(t))
        if (sharedTags.length > 0) {
          edges.push({
            source: `paper-${p1.id}`,
            target: `paper-${p2.id}`,
            type: 'shared-tag',
            weight: sharedTags.length,
          })
        }
      }
    }

    return NextResponse.json({
      nodes,
      edges,
      stats: {
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
