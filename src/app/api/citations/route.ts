import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/citations - get all citations with paper details
export async function GET() {
  try {
    const citations = await db.citation.findMany({
      orderBy: [{ createdAt: 'desc' }],
    })

    // Get all papers for lookup
    const papers = await db.paper.findMany()
    const paperMap = new Map(papers.map((p) => [p.id, p]))

    const enrichedCitations = citations.map((c) => ({
      ...c,
      citingPaper: paperMap.get(c.citingPaperId),
      citedPaper: paperMap.get(c.citedPaperId),
    })).filter((c) => c.citingPaper && c.citedPaper)

    // Calculate citation stats per paper
    const citingCount: Record<string, number> = {} // how many papers this paper cites
    const citedCount: Record<string, number> = {} // how many papers cite this paper
    for (const c of citations) {
      citingCount[c.citingPaperId] = (citingCount[c.citingPaperId] || 0) + 1
      citedCount[c.citedPaperId] = (citedCount[c.citedPaperId] || 0) + 1
    }

    // Top cited papers
    const topCited = papers
      .map((p) => ({
        id: p.id,
        title: p.title,
        authors: p.authors,
        venue: p.venue,
        year: p.year,
        citedByCount: citedCount[p.id] || 0,
        citesCount: citingCount[p.id] || 0,
      }))
      .filter((p) => p.citedByCount > 0 || p.citesCount > 0)
      .sort((a, b) => b.citedByCount - a.citedByCount)
      .slice(0, 10)

    return NextResponse.json({
      citations: enrichedCitations,
      stats: {
        totalCitations: citations.length,
        papersWithCitations: topCited.length,
      },
      topCited,
    })
  } catch (e) {
    console.error('Citations error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/citations - create a citation relationship
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { citingPaperId, citedPaperId, context } = body

    if (!citingPaperId || !citedPaperId) {
      return NextResponse.json({ error: 'Missing paper IDs' }, { status: 400 })
    }
    if (citingPaperId === citedPaperId) {
      return NextResponse.json({ error: 'Cannot cite self' }, { status: 400 })
    }

    const citation = await db.citation.upsert({
      where: {
        citingPaperId_citedPaperId: { citingPaperId, citedPaperId },
      },
      update: { context: context || '' },
      create: { citingPaperId, citedPaperId, context: context || '' },
    })

    return NextResponse.json(citation, { status: 201 })
  } catch (e) {
    console.error('Create citation error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// DELETE /api/citations - delete a citation
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const id = searchParams.get('id')
    if (id) {
      await db.citation.delete({ where: { id } })
      return NextResponse.json({ success: true })
    }
    return NextResponse.json({ error: 'Missing id' }, { status: 400 })
  } catch (e) {
    console.error('Delete citation error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
