import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/reading-activity - get reading activity for heatmap (last 12 weeks)
export async function GET() {
  try {
    const papers = await db.paper.findMany({
      where: {
        OR: [
          { status: 'read' },
          { status: 'reading' },
        ],
      },
      select: {
        id: true,
        title: true,
        status: true,
        dateAdded: true,
        dateRead: true,
        priority: true,
      },
    })

    // Build activity data for last 84 days (12 weeks)
    const days: Array<{ date: string; count: number; papers: Array<{ title: string; status: string }> }> = []
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    for (let i = 83; i >= 0; i--) {
      const date = new Date(today)
      date.setDate(date.getDate() - i)
      const dateStr = date.toISOString().slice(0, 10)
      const dayPapers = papers.filter((p) => {
        const readDate = p.dateRead ? new Date(p.dateRead) : null
        const addedDate = new Date(p.dateAdded)
        return (readDate && readDate.toISOString().slice(0, 10) === dateStr) ||
               (p.status === 'reading' && addedDate.toISOString().slice(0, 10) === dateStr)
      })
      days.push({
        date: dateStr,
        count: dayPapers.length,
        papers: dayPapers.map((p) => ({ title: p.title, status: p.status })),
      })
    }

    // Calculate stats
    const totalRead = papers.filter((p) => p.status === 'read').length
    const totalReading = papers.filter((p) => p.status === 'reading').length
    const activeDays = days.filter((d) => d.count > 0).length
    const currentStreak = calculateCurrentStreak(days)
    const longestStreak = calculateLongestStreak(days)

    return NextResponse.json({
      days,
      stats: {
        totalRead,
        totalReading,
        activeDays,
        currentStreak,
        longestStreak,
        totalPapers: papers.length,
      },
    })
  } catch (e) {
    console.error('Reading activity error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

function calculateCurrentStreak(days: Array<{ count: number }>): number {
  let streak = 0
  for (let i = days.length - 1; i >= 0; i--) {
    if (days[i].count > 0) {
      streak++
    } else {
      break
    }
  }
  return streak
}

function calculateLongestStreak(days: Array<{ count: number }>): number {
  let longest = 0
  let current = 0
  for (const d of days) {
    if (d.count > 0) {
      current++
      longest = Math.max(longest, current)
    } else {
      current = 0
    }
  }
  return longest
}
