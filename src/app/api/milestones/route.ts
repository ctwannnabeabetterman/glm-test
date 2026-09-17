import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { deriveProgress, normalizeRefType, type RefSnapshot } from '@/lib/planner/linkage'
import { loadRefSnapshots, refKey, refLabel } from '@/lib/planner/server'
import { sortByWeekIndex } from '@/lib/planner/schedule'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const where: Record<string, unknown> = {}
    if (type) where.type = type

    const rows = await db.milestone.findMany({ where })

    // 关联的实验/稿件批量解析一次，给前端显示「⇄ 来源」以及可推进到的进度
    const linked = rows.filter((r) => normalizeRefType(r.refType) && r.refId)
    const snapshots: Map<string, RefSnapshot> = linked.length
      ? await loadRefSnapshots(linked.map((r) => ({ type: r.refType, id: r.refId })))
      : new Map<string, RefSnapshot>()

    const enriched = rows.map((r) => {
      const snapshot = snapshots.get(refKey(r.refType, r.refId)) ?? null
      return {
        ...r,
        refLabel: refLabel(snapshot),
        derivedProgress: deriveProgress(snapshot),
      }
    })

    // 必须按**数值**周序号排序：交给 Prisma 的 orderBy 会按字符串比，
    // "10" 会排在 "2" 前面，40 周甘特图的行序会错乱。
    return NextResponse.json(sortByWeekIndex(enriched))
  } catch (e) {
    console.error('GET milestones error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    // 关联必须是「类型 + 实体」成对出现的。只给一半（例如选了类型却没选具体实验，
    // 或反过来只给了实体 id）不算关联：这样的行会被 /api/planner/sync 扫到，
    // 却永远解析不出实体，白白让同步多查一次。宁可整对置空。
    const refType = normalizeRefType(body.refType)
    const refId = refType && typeof body.refId === 'string' ? body.refId.trim() : ''
    const hasLink = Boolean(refType && refId)

    const milestone = await db.milestone.create({
      data: {
        type: body.type,
        title: body.title,
        description: body.description || '',
        startDate: body.startDate === undefined ? '' : String(body.startDate),
        endDate: body.endDate === undefined ? '' : String(body.endDate),
        duration: body.duration ? Number(body.duration) : 0,
        progress: body.progress ? Number(body.progress) : 0,
        category: body.category || '',
        color: body.color || '#10b981',
        targetVenue: body.targetVenue || '',
        refType: hasLink ? refType : '',
        refId: hasLink ? refId : '',
        autoProgress: hasLink ? body.autoProgress === true : false,
        actualEndDate: typeof body.actualEndDate === 'string' ? body.actualEndDate : '',
      },
    })
    return NextResponse.json(milestone, { status: 201 })
  } catch (e) {
    console.error('POST milestones error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
