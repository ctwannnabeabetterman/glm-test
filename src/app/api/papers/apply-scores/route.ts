import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { normalizePriority, normalizeScore } from '@/lib/library/reading-priority'
import { markScoredInDb } from '@/lib/library/score-provenance-server'
import { recordActivity } from '@/lib/activity'

/**
 * 把（通常是 AI 给的）分数写回论文库，并记下「这些分数是 AI 给的」。
 *
 * 为什么与 `/api/ai-paper-score` 分成两条接口：
 *  - 打分那条**只产出建议**（可能整体偏高、也可能判断离谱），
 *    让用户在界面上过一眼再决定应用哪些；
 *  - 写回这条路必须是「可审计的一步」：谁写的、什么时候写的，都要能查。
 * 合成一条接口就等于默认「模型说什么就写什么」。
 *
 * 逐条 `updateMany` 而不是一条 `update`：论文可能已被删除，
 * 那时 `update` 会抛异常，把整批（其余 19 条）一起带崩；`updateMany` 只报 `count: 0`。
 */

const MAX_ITEMS = 100

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const items: unknown[] = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : []
    if (items.length === 0) {
      return NextResponse.json({ error: '没有要应用的分数' }, { status: 400 })
    }

    // 入口处一律收敛：数值夹紧到 1-10、优先级归一 —— 不让任何脏值进库
    const cleaned: Array<{ id: string; relevance: number; novelty: number; priority: 'high' | 'medium' | 'low' }> = []
    for (const raw of items) {
      if (!raw || typeof raw !== 'object') continue
      const o = raw as Record<string, unknown>
      const id = typeof o.id === 'string' ? o.id.trim() : ''
      if (!id) continue
      cleaned.push({
        id,
        relevance: normalizeScore(o.relevance),
        novelty: normalizeScore(o.novelty),
        priority: normalizePriority(o.priority),
      })
    }
    if (cleaned.length === 0) {
      return NextResponse.json({ error: '没有有效的分数条目' }, { status: 400 })
    }

    const appliedIds: string[] = []
    const missing: string[] = []
    for (const item of cleaned) {
      const res = await db.paper.updateMany({
        where: { id: item.id },
        data: { relevance: item.relevance, novelty: item.novelty, priority: item.priority },
      })
      if (res.count > 0) appliedIds.push(item.id)
      else missing.push(item.id)
    }

    const at = new Date().toISOString()
    if (appliedIds.length) await markScoredInDb(appliedIds, at)

    void recordActivity({ module: 'paper', action: 'update', title: '把 AI 建议的分数写回了论文库' })
    return NextResponse.json({
      success: true,
      applied: appliedIds.length,
      missing,
      at,
    })
  } catch (e) {
    console.error('apply paper scores error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
