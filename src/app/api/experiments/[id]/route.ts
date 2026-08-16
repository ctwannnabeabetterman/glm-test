import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    if (body.seed !== undefined) body.seed = Number(body.seed)
    const experiment = await db.experiment.update({ where: { id }, data: body })
    return NextResponse.json(experiment)
  } catch (e) {
    console.error('PUT experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.experiment.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE experiment error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
