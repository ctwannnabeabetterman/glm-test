import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeTaskInput, resolveWeekStart } from '@/lib/planner/schedule'

// GET /api/weekly-tasks?week=YYYY-MM-DD —— 取某一周的任务（缺省为本周）
export async function GET(request: NextRequest) {
  try {
    const weekStart = resolveWeekStart(request.nextUrl.searchParams.get('week'))

    const tasks = await db.weeklyTask.findMany({
      where: { weekStart },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    })

    return NextResponse.json({ weekStart, tasks })
  } catch (e) {
    console.error('GET weekly-tasks error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

// POST /api/weekly-tasks —— 新建任务；order 缺省时追加到该周末尾
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const weekStart = resolveWeekStart(body?.weekStart ?? null)

    const value = normalizeTaskInput(body, weekStart)
    if (!value) return NextResponse.json({ error: '任务名不能为空' }, { status: 400 })

    if (body?.order === undefined) {
      const last = await db.weeklyTask.findFirst({
        where: { weekStart: value.weekStart },
        orderBy: { order: 'desc' },
      })
      value.order = last ? last.order + 1 : 0
    }

    const created = await db.weeklyTask.create({ data: value })
    return NextResponse.json(created, { status: 201 })
  } catch (e) {
    console.error('POST weekly-tasks error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
