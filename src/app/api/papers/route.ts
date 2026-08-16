import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/papers - list all papers
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const category = searchParams.get('category')
    const priority = searchParams.get('priority')

    const where: Record<string, unknown> = {}
    if (status) where.status = status
    if (category) where.category = category
    if (priority) where.priority = priority

    const papers = await db.paper.findMany({
      where,
      orderBy: [{ dateAdded: 'desc' }],
    })
    return NextResponse.json(papers)
  } catch (e) {
    console.error('GET papers error', e)
    return NextResponse.json({ error: 'Failed to fetch papers' }, { status: 500 })
  }
}

// POST /api/papers - create paper
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const paper = await db.paper.create({
      data: {
        title: body.title,
        authors: body.authors || '',
        venue: body.venue || '',
        year: body.year ? Number(body.year) : 2024,
        citations: body.citations ? Number(body.citations) : 0,
        relevance: body.relevance ? Number(body.relevance) : 5,
        novelty: body.novelty ? Number(body.novelty) : 5,
        priority: body.priority || 'medium',
        status: body.status || 'unread',
        codeUrl: body.codeUrl || '',
        pdfUrl: body.pdfUrl || '',
        tags: body.tags || '',
        category: body.category || '',
        notes: body.notes || '',
      },
    })
    return NextResponse.json(paper, { status: 201 })
  } catch (e) {
    console.error('POST papers error', e)
    return NextResponse.json({ error: 'Failed to create paper' }, { status: 500 })
  }
}
