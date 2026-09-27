import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'
import { parseStringArray } from '@/lib/utils'

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
    const result = await db.$transaction(async (tx) => {
      const removed = await tx.topic.findUnique({ where: { id }, select: { name: true } })
      if (!removed) return { status: 404 as const }
      const papers = await tx.paper.findMany({ select: { topicIds: true } })
      if (papers.some((paper) => parseStringArray(paper.topicIds).includes(id))) {
        return { status: 409 as const, link: '论文所属课题' }
      }
      const notes = await tx.note.findMany({ select: { topicIds: true } })
      if (notes.some((note) => parseStringArray(note.topicIds).includes(id))) {
        return { status: 409 as const, link: '笔记所属课题' }
      }
      await tx.topic.delete({ where: { id } })
      return { status: 200 as const, name: removed.name }
    })
    if (result.status === 404) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (result.status === 409) {
      return NextResponse.json({ error: `选题仍被${result.link}使用，请先解除链接后再删除` }, { status: 409 })
    }
    void recordActivity({ module: 'topic', action: 'delete', title: `删除了选题「${result.name}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE topic error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
