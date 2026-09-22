import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { recordActivity } from '@/lib/activity'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    if (body.seed !== undefined) body.seed = Number(body.seed)
    const experiment = await db.experiment.update({ where: { id }, data: body })
    void recordActivity({ module: 'experiment', action: 'update', title: `更新了实验记录「${experiment.name}」`, refId: experiment.id })
    return NextResponse.json(experiment)
  } catch (e) {
    console.error('PUT experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const removedExperiment = await db.experiment.findUnique({ where: { id }, select: { name: true } })
    await db.experiment.delete({ where: { id } })
    void recordActivity({ module: 'experiment', action: 'delete', title: `删除了实验记录「${removedExperiment?.name ?? id}」`, refId: id })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
