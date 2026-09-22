import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

export async function GET() {
  try {
    const keywords = await db.keyword.findMany({ orderBy: [{ dimension: 'asc' }] })
    return NextResponse.json(keywords)
  } catch (e) {
    console.error('GET keywords error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const keyword = await db.keyword.create({
      data: {
        text: body.text,
        dimension: body.dimension,
      },
    })
    void recordActivity({ module: 'search', action: 'create', title: `加了关键词「${keyword.text}」`, refId: keyword.id })
    return NextResponse.json(keyword, { status: 201 })
  } catch (e) {
    console.error('POST keywords error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// DELETE batch via body
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json()
    if (body.id) {
      await db.keyword.delete({ where: { id: body.id } })
    } else if (body.dimension) {
      await db.keyword.deleteMany({ where: { dimension: body.dimension } })
    } else {
      await db.keyword.deleteMany({})
    }
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE keywords error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
