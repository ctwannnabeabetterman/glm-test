import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

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
    void recordActivity({ module: 'note', action: 'update', title: `改了笔记「${note.title}」`, refId: note.id })
    return NextResponse.json(note)
  } catch (e) {
    console.error('PUT note error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removed = await db.note.findUnique({ where: { id }, select: { title: true } })
    await db.note.delete({ where: { id } })
    void recordActivity({ module: 'note', action: 'delete', title: `删除了笔记「${removed?.title ?? id}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE note error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
