import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const data: Record<string, unknown> = { ...body }
    if (body.totalScore !== undefined) data.totalScore = Number(body.totalScore)
    const topic = await db.topic.update({ where: { id }, data })
    void recordActivity({ module: 'topic', action: 'update', title: `改了选题「${topic.name}」`, refId: topic.id })
    return NextResponse.json(topic)
  } catch (e) {
    console.error('PUT topic error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removedTopic = await db.topic.findUnique({ where: { id }, select: { name: true } })
    await db.topic.delete({ where: { id } })
    void recordActivity({ module: 'topic', action: 'delete', title: `删除了选题「${removedTopic?.name ?? id}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE topic error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
