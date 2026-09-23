import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'
import { pickWritableNote } from '@/lib/notes/payload'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = (await request.json()) as Record<string, unknown>
    // 白名单 + 类型转换统一走 lib/notes/payload —— 原来是 `{ ...body }` 直通，
    // `id`/`createdAt`/`updatedAt` 都能被前端覆盖且不报错（与 v1.3.12 修掉的
    // `PUT /api/papers/[id]` 同一个病）。转换里含 structured 字符串化与
    // lastReadAt → Date，别再散落回这个文件。
    const data = pickWritableNote(body)
    if (Object.keys(data).length === 0) {
      // 一个可写字段都没给：直接读一次返回，避免 Prisma 收到空 data 抛错
      const current = await db.note.findUnique({ where: { id } })
      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json(current)
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
