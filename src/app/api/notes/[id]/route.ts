import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const data: Record<string, unknown> = { ...body }
    // 前端以对象提交 structured，落库为 JSON 字符串
    if (body.structured !== undefined) {
      data.structured = typeof body.structured === 'string' ? body.structured : JSON.stringify(body.structured)
    }
    if (body.lastReadAt !== undefined) {
      data.lastReadAt = body.lastReadAt ? new Date(body.lastReadAt) : null
    }
    const note = await db.note.update({ where: { id }, data })
    return NextResponse.json(note)
  } catch (e) {
    console.error('PUT note error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.note.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE note error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
