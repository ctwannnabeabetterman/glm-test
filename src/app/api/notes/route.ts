import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const notes = await db.note.findMany({ orderBy: [{ updatedAt: 'desc' }] })
    // 结构化字段以 JSON 字符串落库，读出时解析为对象便于前端使用
    const parsed = notes.map((n) => {
      let structured: Record<string, unknown> = {}
      try {
        structured = JSON.parse(n.structured || '{}')
      } catch {
        structured = {}
      }
      return { ...n, structured }
    })
    return NextResponse.json(parsed)
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
        structured: body.structured ? JSON.stringify(body.structured) : '{}',
        lastReadAt: body.lastReadAt ? new Date(body.lastReadAt) : undefined,
      },
    })
    return NextResponse.json(note, { status: 201 })
  } catch (e) {
    console.error('POST notes error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
