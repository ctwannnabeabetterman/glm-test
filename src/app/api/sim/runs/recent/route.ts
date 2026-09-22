import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { buildRecentActivity } from '@/lib/sim/sweep'

/**
 * GET /api/sim/runs/recent?days=7 —— 「近 N 天运行记录」的按天聚合。
 *
 * 为什么不在前端拿 `/api/sim/runs` 自己聚合：那条接口有 `take` 上限（默认 30、最多 100），
 * 扫描会一次落很多行 —— 前端聚合会**悄悄少算**（用户看到的「7 天跑了 40 次」其实是 30 次）。
 * 时间窗与分桶都在服务端做，口径与 `buildRecentActivity` 的单测一致。
 *
 * 窗口起点取「今天往前 (days-1) 天的本地 0 点」，与分桶逻辑同一套算法
 * （用 UTC 会把东八区凌晨跑的实验记到前一天）。
 */
export async function GET(request: NextRequest) {
  try {
    const raw = Number(request.nextUrl.searchParams.get('days'))
    const days = Number.isFinite(raw) && raw > 0 ? Math.min(30, Math.max(1, Math.round(raw))) : 7
    const now = new Date()
    const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - (days - 1))

    const runs = await db.simRun.findMany({
      where: { createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { createdAt: true, topology: true, algorithm: true, status: true, metrics: true, label: true },
    })

    return NextResponse.json(buildRecentActivity(runs, now, days))
  } catch (e) {
    console.error('recent sim runs error', e)
    return NextResponse.json({ error: 'Failed' }, { status: 500 })
  }
}
