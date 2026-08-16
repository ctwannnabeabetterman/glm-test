import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    if (body.duration !== undefined) body.duration = Number(body.duration)
    if (body.progress !== undefined) body.progress = Number(body.progress)
    const milestone = await db.milestone.update({ where: { id }, data: body })
    return NextResponse.json(milestone)
  } catch (e) {
    console.error('PUT milestone error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.milestone.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE milestone error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
