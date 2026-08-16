import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const where: Record<string, unknown> = {}
    if (type) where.type = type

    const milestones = await db.milestone.findMany({
      where,
      orderBy: [{ startDate: 'asc' }],
    })
    return NextResponse.json(milestones)
  } catch (e) {
    console.error('GET milestones error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const milestone = await db.milestone.create({
      data: {
        type: body.type,
        title: body.title,
        description: body.description || '',
        startDate: body.startDate || '',
        endDate: body.endDate || '',
        duration: body.duration ? Number(body.duration) : 0,
        progress: body.progress ? Number(body.progress) : 0,
        category: body.category || '',
        color: body.color || '#10b981',
        targetVenue: body.targetVenue || '',
      },
    })
    return NextResponse.json(milestone, { status: 201 })
  } catch (e) {
    console.error('POST milestones error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
