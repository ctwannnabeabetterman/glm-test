import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const experiments = await db.experiment.findMany({ orderBy: [{ createdAt: 'desc' }] })
    return NextResponse.json(experiments)
  } catch (e) {
    console.error('GET experiments error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const experiment = await db.experiment.create({
      data: {
        name: body.name,
        topic: body.topic || '',
        status: body.status || 'planned',
        config: body.config || '{}',
        metrics: body.metrics || '{}',
        baselines: body.baselines || '[]',
        ablations: body.ablations || '[]',
        notes: body.notes || '',
        seed: body.seed ? Number(body.seed) : 42,
      },
    })
    return NextResponse.json(experiment, { status: 201 })
  } catch (e) {
    console.error('POST experiments error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
