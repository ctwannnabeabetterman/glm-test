import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const paper = await db.paper.findUnique({ where: { id } })
    if (!paper) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(paper)
  } catch (e) {
    console.error('GET paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const data: Record<string, unknown> = { ...body }
    // Auto set dateRead when status becomes 'read'
    if (body.status === 'read') {
      data.dateRead = new Date()
    } else if (body.status && body.status !== 'read') {
      data.dateRead = null
    }
    // Convert numeric fields
    if (body.year !== undefined) data.year = Number(body.year)
    if (body.citations !== undefined) data.citations = Number(body.citations)
    if (body.relevance !== undefined) data.relevance = Number(body.relevance)
    if (body.novelty !== undefined) data.novelty = Number(body.novelty)

    const paper = await db.paper.update({ where: { id }, data })
    return NextResponse.json(paper)
  } catch (e) {
    console.error('PUT paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.paper.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE paper error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
