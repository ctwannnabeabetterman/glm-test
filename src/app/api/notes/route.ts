import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const notes = await db.note.findMany({ orderBy: [{ updatedAt: 'desc' }] })
    return NextResponse.json(notes)
  } catch (e) {
    console.error('GET notes error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const note = await db.note.create({
      data: {
        title: body.title,
        content: body.content || '',
        tags: body.tags || '',
        links: body.links || '[]',
        category: body.category || 'literature',
      },
    })
    return NextResponse.json(note, { status: 201 })
  } catch (e) {
    console.error('POST notes error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
