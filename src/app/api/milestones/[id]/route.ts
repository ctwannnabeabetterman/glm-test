import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isIsoDate } from '@/lib/planner/config'
import { normalizeRefType } from '@/lib/planner/linkage'
import { toLocalIsoDate } from '@/lib/planner/schedule'

function clampProgress(value: unknown): number | null {
  const n = Number(value)
  if (!Number.isFinite(n)) return null
  return Math.max(0, Math.min(100, Math.round(n)))
}

/**
 * PUT /api/milestones/[id] —— 白名单局部更新。
 *
 * 旧实现直接把请求体透传给 Prisma，任何多余字段都会让查询抛错（前端多传一个
 * UI 用的字段就 500）。改成白名单后，非法字段被忽略而不是炸掉整次保存。
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const body = await request.json()

    const existing = await db.milestone.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const patch: Record<string, unknown> = {}

    if (body.title !== undefined) patch.title = String(body.title)
    if (body.description !== undefined) patch.description = String(body.description)
    if (body.startDate !== undefined) patch.startDate = String(body.startDate)
    if (body.endDate !== undefined) patch.endDate = String(body.endDate)
    if (body.category !== undefined) patch.category = String(body.category)
    if (body.color !== undefined) patch.color = String(body.color)
    if (body.targetVenue !== undefined) patch.targetVenue = String(body.targetVenue)

    if (body.duration !== undefined) {
      const n = Number(body.duration)
      patch.duration = Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0
    }

    if (body.progress !== undefined) {
      const progress = clampProgress(body.progress)
      if (progress === null) return NextResponse.json({ error: 'progress 必须是数字' }, { status: 400 })
      patch.progress = progress
    }

    // 关联字段：必须「类型 + 实体」成对存在，半截关联一律整对置空。
    // 只碰 autoProgress 时不重算关联（避免把历史遗留行顺手改掉）。
    const touchesRef = body.refType !== undefined || body.refId !== undefined
    if (touchesRef) {
      const rawType = body.refType !== undefined ? normalizeRefType(body.refType) : normalizeRefType(existing.refType)
      const rawId =
        body.refId !== undefined ? String(body.refId).trim() : String(existing.refId || '').trim()
      const hasLink = Boolean(rawType && rawId)
      patch.refType = hasLink ? rawType : ''
      patch.refId = hasLink ? rawId : ''
      if (body.autoProgress !== undefined) patch.autoProgress = hasLink && body.autoProgress === true
      else if (!hasLink) patch.autoProgress = false
    } else if (body.autoProgress !== undefined) {
      patch.autoProgress = body.autoProgress === true
    }

    if (body.actualEndDate !== undefined) {
      patch.actualEndDate = isIsoDate(body.actualEndDate) ? body.actualEndDate : ''
    }

    // 进度被推到 100 时补记实际完成日（偏差报告依赖它）。
    // 只在「确实没有日期」时补，绝不覆盖用户手填的日期；反过来也不自动清空 ——
    // 把进度回调到 100 以下不会抹掉已完成的事实，需要清就显式传 actualEndDate: ''。
    const nextProgress = (patch.progress as number | undefined) ?? existing.progress
    if (nextProgress >= 100 && !isIsoDate(patch.actualEndDate as string) && !isIsoDate(existing.actualEndDate)) {
      patch.actualEndDate = toLocalIsoDate(new Date())
    }

    if (!Object.keys(patch).length) {
      return NextResponse.json({ error: '没有可更新的字段' }, { status: 400 })
    }

    const milestone = await db.milestone.update({ where: { id }, data: patch })
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
