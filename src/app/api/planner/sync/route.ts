import { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { isIsoDate } from '@/lib/planner/config'
import { deriveProgress, syncedProgress, type MilestoneLike } from '@/lib/planner/linkage'
import { loadRefSnapshots, refKey, refLabel } from '@/lib/planner/server'
import { toLocalIsoDate } from '@/lib/planner/schedule'

interface Change {
  id: string
  title: string
  from: number
  to: number
  refLabel: string
}

/**
 * POST /api/planner/sync —— 按关联的实验/稿件状态推进里程碑进度。
 *
 * 为什么是显式 POST 而不是在 GET 里顺手算完写回去：
 * 隐藏写入会让「甘特图自己变了」变得无法解释。这里做成用户可见的一次动作，
 * 并返回具体改了哪几条，谁在什么时候动了进度一目了然。
 *
 * 两条硬规则（避免自动同步变成数据事故）：
 *  1. 只处理 autoProgress=true 的里程碑 —— 手工填的进度不会被悄悄覆盖
 *  2. 只推进、不回退 —— 实验被改回 running 也不会把里程碑从 100 拉下来
 */
export async function POST() {
  try {
    const linked = await db.milestone.findMany({ where: { refType: { not: '' } } })

    if (!linked.length) {
      return NextResponse.json({ success: true, changed: 0, changes: [], suggestions: [] })
    }

    const snapshots = await loadRefSnapshots(linked.map((m) => ({ type: m.refType, id: m.refId })))
    const today = toLocalIsoDate(new Date())

    const changes: Change[] = []
    const suggestions: Change[] = []

    for (const row of linked) {
      const snapshot = snapshots.get(refKey(row.refType, row.refId)) ?? null
      const label = refLabel(snapshot)
      const milestone = row as unknown as MilestoneLike

      if (!row.autoProgress) {
        // 只提示不写入：关联仍作为参考展示，推进与否由用户决定
        const derived = deriveProgress(snapshot)
        if (derived !== null && derived > row.progress) {
          suggestions.push({ id: row.id, title: row.title, from: row.progress, to: derived, refLabel: label })
        }
        continue
      }

      const next = syncedProgress(milestone, snapshot)
      if (next === null || next === row.progress) continue

      const data: { progress: number; actualEndDate?: string } = { progress: next }
      // 到 100 时补记实际完成日，否则偏差报告会缺一半数据
      if (next >= 100 && !isIsoDate(row.actualEndDate)) data.actualEndDate = today

      await db.milestone.update({ where: { id: row.id }, data })
      changes.push({ id: row.id, title: row.title, from: row.progress, to: next, refLabel: label })
    }

    return NextResponse.json({
      success: true,
      changed: changes.length,
      changes,
      suggestions,
    })
  } catch (e) {
    console.error('POST planner sync error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
