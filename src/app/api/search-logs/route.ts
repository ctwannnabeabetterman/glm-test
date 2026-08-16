import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

export async function GET() {
  try {
    const logs = await db.searchLog.findMany({ orderBy: [{ createdAt: 'desc' }] })
    return NextResponse.json(logs)
  } catch (e) {
    console.error('GET search-logs error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const log = await db.searchLog.create({
      data: {
        database: body.database || 'IEEE Xplore',
        query: body.query,
        resultsCount: body.resultsCount ? Number(body.resultsCount) : 0,
        keptCount: body.keptCount ? Number(body.keptCount) : 0,
        notes: body.notes || '',
      },
    })
    return NextResponse.json(log, { status: 201 })
  } catch (e) {
    console.error('POST search-logs error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
