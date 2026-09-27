import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/reading-sessions - get reading session history with daily aggregation
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const days = parseInt(searchParams.get('days') || '30', 10)

    // Get sessions from last N days
    const startDate = new Date()
    startDate.setDate(startDate.getDate() - days)
    startDate.setHours(0, 0, 0, 0)

    const sessions = await db.readingSession.findMany({
      where: { date: { gte: startDate } },
      orderBy: { date: 'asc' },
    })

    // Aggregate by day
    const dailyData: Array<{ date: string; totalSeconds: number; sessionCount: number; papers: Set<string> }> = []
    const dateMap: Record<string, { totalSeconds: number; sessionCount: number; papers: Set<string> }> = {}

    for (let i = days - 1; i >= 0; i--) {
      const d = new Date()
      d.setDate(d.getDate() - i)
      const dateStr = d.toISOString().slice(0, 10)
      dateMap[dateStr] = { totalSeconds: 0, sessionCount: 0, papers: new Set() }
    }

    for (const s of sessions) {
      const dateStr = s.date.toISOString().slice(0, 10)
      if (dateMap[dateStr]) {
        dateMap[dateStr].totalSeconds += s.duration
        dateMap[dateStr].sessionCount += 1
        dateMap[dateStr].papers.add(s.paperId)
      }
    }

    for (const [date, data] of Object.entries(dateMap)) {
      dailyData.push({ date, ...data, papers: data.papers })
    }

    // Calculate stats
    const totalSeconds = sessions.reduce((sum, s) => sum + s.duration, 0)
    const totalSessions = sessions.length
    const activeDays = dailyData.filter((d) => d.totalSeconds > 0).length
    const avgPerDay = activeDays > 0 ? Math.round(totalSeconds / activeDays) : 0

    // Get top papers by reading time
    const paperTimeMap: Record<string, { paperId: string; title: string; totalSeconds: number; sessions: number }> = {}
    for (const s of sessions) {
      if (!paperTimeMap[s.paperId]) {
        paperTimeMap[s.paperId] = { paperId: s.paperId, title: s.paperTitle, totalSeconds: 0, sessions: 0 }
      }
      paperTimeMap[s.paperId].totalSeconds += s.duration
      paperTimeMap[s.paperId].sessions += 1
    }
    const topPapers = Object.values(paperTimeMap).sort((a, b) => b.totalSeconds - a.totalSeconds).slice(0, 5)

    return NextResponse.json({
      dailyData: dailyData.map((d) => ({
        date: d.date,
        totalSeconds: d.totalSeconds,
        sessionCount: d.sessionCount,
        paperCount: d.papers.size,
      })),
      stats: {
        totalSeconds,
        totalSessions,
        activeDays,
        avgPerDay,
        period: days,
      },
      topPapers,
    })
  } catch (e) {
    console.error('Reading sessions error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/reading-sessions - one immutable, client-identified segment.
// Paper.readingTime is the cumulative source of truth (including pre-existing time not in sessions).
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { id, paperId, duration } = body
    if (typeof id !== 'string' || !/^[\w-]{1,128}$/.test(id) ||
        typeof paperId !== 'string' || !paperId.trim() ||
        !Number.isSafeInteger(duration) || duration <= 0 || duration > 86400) {
      return NextResponse.json({ error: 'Invalid session id, paperId or duration' }, { status: 400 })
    }

    const result = await db.$transaction(async (tx) => {
      const existing = await tx.readingSession.findUnique({ where: { id } })
      if (existing) {
        if (existing.paperId !== paperId || existing.duration !== duration) return { conflict: true as const }
        const paper = await tx.paper.findUnique({ where: { id: paperId }, select: { readingTime: true } })
        return { session: existing, totalSeconds: paper?.readingTime ?? null, created: false }
      }
      const paper = await tx.paper.findUnique({ where: { id: paperId }, select: { title: true } })
      if (!paper) return { missing: true as const }

      // A single transaction guarantees a segment cannot exist without its cumulative increment.
      const session = await tx.readingSession.create({
        data: { id, paperId, paperTitle: paper.title, duration },
      })
      const updated = await tx.paper.update({
        where: { id: paperId }, data: { readingTime: { increment: duration } },
        select: { readingTime: true },
      })
      return { session, totalSeconds: updated.readingTime, created: true }
    })
    if ('conflict' in result) return NextResponse.json({ error: 'Session id already used for different data' }, { status: 409 })
    if ('missing' in result) return NextResponse.json({ error: 'Paper not found' }, { status: 404 })
    return NextResponse.json({ ...result.session, totalSeconds: result.totalSeconds }, { status: result.created ? 201 : 200 })
  } catch (e) {
    console.error('Create reading session error', e)
    // A concurrent request with the same id can win the UNIQUE constraint. Its transaction
    // committed once; the caller retries with the same id and reads it without incrementing.
    return NextResponse.json({ error: 'Failed to save session; retry with the same id' }, { status: 500 })
  }
}
