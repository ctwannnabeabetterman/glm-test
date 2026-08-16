import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'

// GET /api/reading-goals - get current weekly and monthly goals + progress
export async function GET() {
  try {
    // Get current period identifiers
    const now = new Date()
    const weekNum = getWeekNumber(now)
    const weekPeriod = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    const monthPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

    // Get or create default goals
    let weeklyGoal = await db.readingGoal.findUnique({ where: { type_period: { type: 'weekly', period: weekPeriod } } })
    if (!weeklyGoal) {
      weeklyGoal = await db.readingGoal.create({ data: { type: 'weekly', target: 3, period: weekPeriod } })
    }
    let monthlyGoal = await db.readingGoal.findUnique({ where: { type_period: { type: 'monthly', period: monthPeriod } } })
    if (!monthlyGoal) {
      monthlyGoal = await db.readingGoal.create({ data: { type: 'monthly', target: 12, period: monthPeriod } })
    }

    // Calculate progress: count papers read in the current period
    const weeklyStart = getWeekStart(now)
    const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1)

    const weeklyRead = await db.paper.count({
      where: {
        status: 'read',
        dateRead: { gte: weeklyStart },
      },
    })
    const monthlyRead = await db.paper.count({
      where: {
        status: 'read',
        dateRead: { gte: monthlyStart },
      },
    })

    // Get all goals history for trend
    const allGoals = await db.readingGoal.findMany({ orderBy: [{ period: 'desc' }], take: 12 })

    return NextResponse.json({
      current: {
        weekly: { ...weeklyGoal, progress: weeklyRead, pct: Math.min(100, (weeklyRead / weeklyGoal.target) * 100) },
        monthly: { ...monthlyGoal, progress: monthlyRead, pct: Math.min(100, (monthlyRead / monthlyGoal.target) * 100) },
      },
      history: allGoals,
    })
  } catch (e) {
    console.error('Reading goals error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/reading-goals - create or update a goal
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { type, target } = body
    if (!type || !target) return NextResponse.json({ error: 'Missing fields' }, { status: 400 })

    const now = new Date()
    let period: string
    if (type === 'weekly') {
      const weekNum = getWeekNumber(now)
      period = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`
    } else {
      period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    }

    const goal = await db.readingGoal.upsert({
      where: { type_period: { type, period } },
      update: { target: Number(target) },
      create: { type, target: Number(target), period },
    })

    return NextResponse.json(goal, { status: 201 })
  } catch (e) {
    console.error('Create goal error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

function getWeekNumber(d: Date): number {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()))
  const dayNum = date.getUTCDay() || 7
  date.setUTCDate(date.getUTCDate() + 4 - dayNum)
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
  return Math.ceil((((date.getTime() - yearStart.getTime()) / 86400000) + 1) / 7)
}

function getWeekStart(d: Date): Date {
  const date = new Date(d)
  const day = date.getDay() || 7
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - (day - 1))
  return date
}
