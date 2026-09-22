import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeSections } from '@/lib/writing/draft'
import { toManuscriptDto } from '@/lib/writing/dto'
import { recordActivity } from '@/lib/activity'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const row = await db.manuscript.findUnique({ where: { id } })
    if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json(toManuscriptDto(row))
  } catch (e) {
    console.error('GET manuscript error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const data: Record<string, unknown> = {}

    if (typeof body?.title === 'string') data.title = body.title.trim() || '未命名稿件'
    if (typeof body?.venue === 'string') data.venue = body.venue
    if (body?.targetWords !== undefined) {
      const n = Number(body.targetWords)
      data.targetWords = Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0
    }
    if (typeof body?.status === 'string') data.status = body.status
    // sections 一律走归一化后再序列化：前端传来的脏数据不该进库
    if (body?.sections !== undefined) data.sections = JSON.stringify(normalizeSections(body.sections))

    if (!Object.keys(data).length) {
      return NextResponse.json({ error: 'No updatable fields provided' }, { status: 400 })
    }

    const updated = await db.manuscript.update({ where: { id }, data })
    void recordActivity({ module: 'writing', action: 'update', title: `写了稿件「${updated.title}」`, refId: updated.id })
    return NextResponse.json(toManuscriptDto(updated))
  } catch (e) {
    console.error('PUT manuscript error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removed = await db.manuscript.findUnique({ where: { id }, select: { title: true } })
    await db.manuscript.delete({ where: { id } })
    void recordActivity({ module: 'writing', action: 'delete', title: `删除了稿件「${removed?.title ?? id}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE manuscript error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
