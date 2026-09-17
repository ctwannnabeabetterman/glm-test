import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizeTaskPatch, resolveWeekStart } from '@/lib/planner/schedule'

// PUT /api/weekly-tasks/[id] —— 局部更新（勾选完成、改工时/优先级、跨周移动）
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()
    const patch = normalizeTaskPatch(body)

    if (body?.weekStart !== undefined && patch.weekStart === undefined) {
      // 传了周但解析不出来：按本周处理，避免把任务丢进「未归周」的空洞
      patch.weekStart = resolveWeekStart(null)
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }

    const updated = await db.weeklyTask.update({ where: { id }, data: patch })
    return NextResponse.json(updated)
  } catch (e) {
    console.error('PUT weekly-task error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    await db.weeklyTask.delete({ where: { id } })
    return NextResponse.json({ success: true })
  } catch (e) {
    console.error('DELETE weekly-task error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
