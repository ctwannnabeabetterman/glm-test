import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const topics = await db.topic.findMany({ orderBy: [{ totalScore: 'desc' }] })
    return NextResponse.json(topics)
  } catch (e) {
    console.error('GET topics error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const topic = await db.topic.create({
      data: {
        name: body.name,
        direction: body.direction || '',
        description: body.description || '',
        scores: body.scores || '{}',
        totalScore: body.totalScore ? Number(body.totalScore) : 0,
      },
    })
    return NextResponse.json(topic, { status: 201 })
  } catch (e) {
    console.error('POST topics error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
